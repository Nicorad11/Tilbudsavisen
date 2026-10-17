import { createHash } from 'node:crypto';
import type { RawRecord, ScrapedOffer, StoreLocationInput } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, queryOne, type Db } from '../db/client';
import { ProductMatcher } from './matcher';
import { bumpDataVersion } from './offers';
import { isInScope } from './scope';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Kæderne scrapes parallelt, men gemmes én transaktion ad gangen. Kæder deler
 * varer (fx føtex og Bilka), og to transaktioner, der opretter de samme varer i
 * forskellig rækkefølge, giver ellers en deadlock i Postgres. Låsen gælder også
 * på tværs af flere serverinstanser og slippes automatisk ved commit/rollback.
 */
const INGEST_LOCK = sql.raw('SELECT pg_advisory_xact_lock(7240001)');

function contentHash(record: RawRecord): string {
  return createHash('sha256')
    .update(JSON.stringify(record.payload))
    .update(JSON.stringify(record.context ?? null))
    .digest('hex');
}

/** Gemmer rå records. Uændret indhold opdaterer blot last_seen_at. */
export async function saveRawBatch(db: Db, records: RawRecord[], runId: number | null): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (!records.length) return ids;
  // Samme externalId kan forekomme to gange i en batch (fx på tværs af aviser).
  const unique = new Map(records.map((r) => [`${r.sourceId}|${r.externalId}|${contentHash(r)}`, r]));
  const rows = [...unique.entries()].map(([key, r]) => {
    const hash = key.split('|').pop()!;
    return sql`(${r.sourceId}, ${r.externalId}, ${r.kind}, ${JSON.stringify(r.payload)}::jsonb, ${JSON.stringify(r.context ?? null)}::jsonb, ${hash}, ${runId})`;
  });
  const saved = await query<{ id: number; source_id: string; external_id: string }>(
    db,
    sql`INSERT INTO raw_offers (source_id, external_id, kind, payload, context, content_hash, run_id)
        VALUES ${sql.join(rows, sql`, `)}
        ON CONFLICT (source_id, external_id, content_hash)
        DO UPDATE SET last_seen_at = now(), run_id = EXCLUDED.run_id
        RETURNING id, source_id, external_id`,
  );
  for (const r of saved) ids.set(`${r.source_id}|${r.external_id}`, r.id);
  return ids;
}

export interface IngestStats {
  offersSaved: number;
  baselineSaved: number;
  productsTouched: number;
  /** Samme tilbud fra en anden avis i samme kæde (fx Lidls ugeavis og weekendavis) – gemmes kun én gang. */
  duplicatesSkipped: number;
}

/**
 * Persisterer normaliserede tilbud:
 *  - tilbud upsertes på (source_id, external_id)
 *  - hver observation skrives til price_history (laveste enhedspris pr. dag)
 *  - hyldepriser (isBaseline) skrives KUN til price_history
 */
export async function ingestOffers(
  db: Db,
  offers: ScrapedOffer[],
  rawIds: Map<string, number> = new Map(),
  observedOn: string = today(),
): Promise<IngestStats> {
  const matcher = new ProductMatcher();
  const stats: IngestStats = { offersSaved: 0, baselineSaved: 0, productsTouched: 0, duplicatesSkipped: 0 };
  const touched = new Set<number>();
  // Pausede kæder/kategorier gemmes ikke (de rå data er allerede gemt).
  offers = offers.filter(isInScope);

  for (let i = 0; i < offers.length; i += 250) {
    const chunk = offers.slice(i, i + 250);
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      await txDb.execute(INGEST_LOCK);
      for (const o of chunk) {
        const productId = await matcher.resolve(txDb, o);
        touched.add(productId);

        const duplicate = !o.isBaseline && (await findDuplicateOffer(txDb, o));
        if (duplicate) {
          stats.duplicatesSkipped++;
        } else if (!o.isBaseline) {
          await txDb.execute(sql`
            INSERT INTO offers (
              store_id, source_id, external_id, product_id, raw_offer_id, title, description, normalized_name, brand,
              category, offer_price, original_price, unit, quantity_min, quantity_max, pieces, unit_price,
              unit_price_max, valid_from, valid_to, image_url, source_url
            ) VALUES (
              ${o.storeId}, ${o.sourceId}, ${o.externalId}, ${productId}, ${rawIds.get(`${o.sourceId}|${o.externalId}`) ?? null},
              ${o.productName}, ${o.description ?? null}, ${o.normalizedProductName}, ${o.brand ?? null},
              ${o.category}, ${o.offerPrice}, ${o.originalPrice}, ${o.unit}, ${o.quantity?.min ?? null},
              ${o.quantity?.max ?? null}, ${o.pieces ?? 1}, ${o.unitPrice ?? null}, ${o.unitPriceMax ?? null},
              ${o.validFrom.toISOString()}::timestamptz, ${o.validTo.toISOString()}::timestamptz, ${o.imageUrl}, ${o.sourceUrl}
            )
            ON CONFLICT (source_id, external_id) DO UPDATE SET
              product_id = EXCLUDED.product_id,
              raw_offer_id = COALESCE(EXCLUDED.raw_offer_id, offers.raw_offer_id),
              title = EXCLUDED.title, description = EXCLUDED.description,
              normalized_name = EXCLUDED.normalized_name, brand = EXCLUDED.brand, category = EXCLUDED.category,
              offer_price = EXCLUDED.offer_price, original_price = EXCLUDED.original_price, unit = EXCLUDED.unit,
              quantity_min = EXCLUDED.quantity_min, quantity_max = EXCLUDED.quantity_max, pieces = EXCLUDED.pieces,
              unit_price = EXCLUDED.unit_price, unit_price_max = EXCLUDED.unit_price_max,
              valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to,
              image_url = EXCLUDED.image_url, source_url = EXCLUDED.source_url, last_seen_at = now()`);
          stats.offersSaved++;
        } else {
          stats.baselineSaved++;
        }

        // Et kommende tilbud er endnu ikke en observeret pris.
        const observable = o.isBaseline || o.validFrom.getTime() <= Date.now();
        if (observable) {
          await txDb.execute(sql`
            INSERT INTO price_history (product_id, store_id, observed_on, price, unit_price, is_offer, source_id)
            VALUES (${productId}, ${o.storeId}, ${observedOn}::date, ${o.offerPrice}, ${o.unitPrice ?? null}, ${!o.isBaseline}, ${o.sourceId})
            ON CONFLICT (product_id, store_id, observed_on, is_offer) DO UPDATE SET
              price = LEAST(price_history.price, EXCLUDED.price),
              unit_price = LEAST(price_history.unit_price, EXCLUDED.unit_price),
              synthetic = false`);
        }
      }
    });
  }
  stats.productsTouched = touched.size;
  bumpDataVersion();
  return stats;
}

export async function upsertStoreLocations(db: Db, locations: StoreLocationInput[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < locations.length; i += 200) {
    const chunk = locations.slice(i, i + 200);
    const values = chunk.map(
      (l) =>
        sql`(${l.storeId}, ${l.externalId}, ${l.name}, ${l.street}, ${l.city}, ${l.zipCode}, ${l.latitude}, ${l.longitude}, now())`,
    );
    await db.execute(sql`
      INSERT INTO store_locations (store_id, external_id, name, street, city, zip_code, latitude, longitude, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (store_id, external_id) DO UPDATE SET
        name = EXCLUDED.name, street = EXCLUDED.street, city = EXCLUDED.city, zip_code = EXCLUDED.zip_code,
        latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, updated_at = now()`);
    n += chunk.length;
  }
  return n;
}

/**
 * Kæderne lægger ofte det samme tilbud i flere aviser (fx Lidls ugeavis og
 * weekendavis), hvert med sit eget id. Det er det samme tilbud, når kæde,
 * vare, pris, mængde og gyldighed er ens – så vises det kun én gang.
 */
async function findDuplicateOffer(db: Db, o: ScrapedOffer): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    db,
    sql`SELECT id FROM offers
        WHERE store_id = ${o.storeId} AND normalized_name = ${o.normalizedProductName}
          AND offer_price = ${o.offerPrice} AND unit = ${o.unit}
          AND quantity_min IS NOT DISTINCT FROM ${o.quantity?.min ?? null}::double precision
          AND quantity_max IS NOT DISTINCT FROM ${o.quantity?.max ?? null}::double precision
          AND valid_from = ${o.validFrom.toISOString()}::timestamptz AND valid_to = ${o.validTo.toISOString()}::timestamptz
          AND NOT (source_id = ${o.sourceId} AND external_id = ${o.externalId})
        LIMIT 1`,
  );
  return Boolean(row);
}

/** Dubletter: alle andre end det ældste tilbud med samme kæde, vare, pris, mængde og gyldighed. */
const DUPLICATES = sql`
  SELECT id, keep FROM (
    SELECT id, first_value(id) OVER (
      PARTITION BY store_id, normalized_name, offer_price, unit, quantity_min, quantity_max, valid_from, valid_to
      ORDER BY id
    ) AS keep
    FROM offers
  ) ranked
  WHERE id <> keep`;

/**
 * Rydder dubletter, der blev gemt før de blev sorteret fra ved indlæsningen.
 * Vurderinger og notifikationer flyttes over på det tilbud, der beholdes.
 */
export async function removeDuplicateOffers(db: Db): Promise<number> {
  let removed = 0;
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    await txDb.execute(INGEST_LOCK);
    await txDb.execute(sql`
      UPDATE community_reports c SET offer_id = d.keep
      FROM (${DUPLICATES}) d
      WHERE c.offer_id = d.id
        AND NOT EXISTS (SELECT 1 FROM community_reports c2 WHERE c2.offer_id = d.keep AND c2.user_id = c.user_id)`);
    await txDb.execute(sql`
      UPDATE notifications n SET offer_id = d.keep
      FROM (${DUPLICATES}) d
      WHERE n.offer_id = d.id
        AND NOT EXISTS (SELECT 1 FROM notifications n2 WHERE n2.offer_id = d.keep AND n2.watch_id IS NOT DISTINCT FROM n.watch_id)`);
    const deleted = await query<{ id: number }>(txDb, sql`DELETE FROM offers WHERE id IN (SELECT id FROM (${DUPLICATES}) d) RETURNING id`);
    removed = deleted.length;
  });
  if (removed) bumpDataVersion();
  return removed;
}
