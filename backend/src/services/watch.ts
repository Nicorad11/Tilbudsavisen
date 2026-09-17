import type { NotificationDTO, WatchDTO } from '@tilbudsradar/shared';
import type { Logger } from '@tilbudsradar/scrapers';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../db/client';
import { sendMail } from './mailer';
import { OFFER_SELECT, toOfferDTOs, tokenize, type OfferRow } from './offers';

/** Bedste aktive tilbud for en overvåget vare (kanonisk vare eller fritekst). */
async function bestOffersFor(db: Db, watches: { id: number; query: string; product_id: number | null }[]) {
  const result = new Map<number, OfferRow>();
  for (const w of watches) {
    const tokens = tokenize(w.query);
    if (!w.product_id && !tokens.length) continue;
    const match = w.product_id
      ? sql`o.product_id = ${w.product_id}`
      : sql`lower(o.title || ' ' || o.normalized_name) LIKE ALL (ARRAY[${sql.join(
          tokens.map((t) => sql`${`%${t}%`}`),
          sql`, `,
        )}]::text[])`;
    const [row] = await query<OfferRow>(
      db,
      sql`SELECT ${OFFER_SELECT}
          FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now() AND ${match}
          ORDER BY o.offer_price ASC
          LIMIT 1`,
    );
    if (row) result.set(w.id, row);
  }
  return result;
}

export async function listWatches(db: Db, userId: string): Promise<WatchDTO[]> {
  const watches = await query<{ id: number; query: string; product_id: number | null; target_price: number; created_at: Date }>(
    db,
    sql`SELECT id, query, product_id, target_price, created_at FROM watchlist WHERE user_id = ${userId}::uuid ORDER BY created_at DESC`,
  );
  const best = await bestOffersFor(db, watches);
  const dtos = await toOfferDTOs(db, [...best.values()]);
  const byId = new Map(dtos.map((d) => [d.id, d]));
  return watches.map((w) => {
    const offer = best.get(w.id);
    const dto = offer ? (byId.get(offer.id) ?? null) : null;
    return {
      id: w.id,
      query: w.query,
      productId: w.product_id,
      targetPrice: w.target_price,
      createdAt: new Date(w.created_at).toISOString(),
      currentBest: dto,
      triggered: Boolean(dto && dto.offerPrice <= w.target_price),
    };
  });
}

/**
 * Køres efter hver scraping: opretter én notifikation pr. (overvågning, tilbud)
 * når prisen er under brugerens grænse, og sender e-mail til registrerede brugere.
 */
export async function checkWatchlists(db: Db, log: Logger): Promise<number> {
  const watches = await query<{
    id: number;
    user_id: string;
    query: string;
    product_id: number | null;
    target_price: number;
    email: string | null;
    is_guest: boolean;
  }>(
    db,
    sql`SELECT w.id, w.user_id, w.query, w.product_id, w.target_price, u.email, u.is_guest
        FROM watchlist w JOIN users u ON u.id = w.user_id`,
  );
  if (!watches.length) return 0;
  const best = await bestOffersFor(db, watches);
  let created = 0;
  for (const w of watches) {
    const offer = best.get(w.id);
    if (!offer || offer.offer_price > w.target_price) continue;
    const price = offer.offer_price.toFixed(2).replace('.', ',');
    const message = `"${w.query}" er på tilbud: ${offer.title} til ${price} kr hos ${offer.store_name}`;
    const inserted = await query<{ id: number }>(
      db,
      sql`INSERT INTO notifications (user_id, watch_id, offer_id, message)
          VALUES (${w.user_id}::uuid, ${w.id}, ${offer.id}, ${message})
          ON CONFLICT (watch_id, offer_id) DO NOTHING
          RETURNING id`,
    );
    if (!inserted.length) continue;
    created++;
    if (w.email && !w.is_guest) {
      const sent = await sendMail(
        w.email,
        `Prisalarm: ${w.query} til ${price} kr`,
        `${message}.\n\nGyldig til ${new Date(offer.valid_to).toLocaleDateString('da-DK')}.\nSe tilbuddet: ${offer.source_url}\n\nDu får denne mail, fordi du følger "${w.query}" i TilbudsRadar.`,
      );
      if (sent) await db.execute(sql`UPDATE notifications SET emailed_at = now() WHERE id = ${inserted[0]!.id}`);
    }
  }
  if (created) log.info(`Watchlist: ${created} nye notifikationer`);
  return created;
}

export async function listNotifications(db: Db, userId: string): Promise<NotificationDTO[]> {
  const rows = await query<{ id: number; message: string; offer_id: number | null; created_at: Date; read_at: Date | null }>(
    db,
    sql`SELECT id, message, offer_id, created_at, read_at FROM notifications
        WHERE user_id = ${userId}::uuid ORDER BY created_at DESC LIMIT 50`,
  );
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    offerId: r.offer_id,
    createdAt: new Date(r.created_at).toISOString(),
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
  }));
}
