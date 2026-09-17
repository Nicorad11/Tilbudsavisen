import { SCRAPERS } from '@tilbudsradar/scrapers';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/client';
import { scrapeSources, stores } from '../../db/schema';
import { addManualAlias } from '../../services/matcher';
import { bumpDataVersion } from '../../services/offers';
import type { AppContext } from '../app';
import { adminOpen, requireAdmin } from '../auth';
import { HttpError, notFound, parse } from '../errors';

/** Styring af scraping-kilder: status, feature-flags, manuel kørsel og mapping. */
export function adminRoutes({ db, scrape }: AppContext): Router {
  const r = Router();
  r.use(requireAdmin);

  r.get('/status', async (_req, res) => {
    res.json({ ...(await scrape.status()), adminOpen: adminOpen() });
  });

  /** Feature-flag pr. kæde – slår alle kædens kilder fra (fx hvis kæden beder om det). */
  r.patch('/stores/:id', async (req, res) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const [row] = await db.update(stores).set({ enabled }).where(eq(stores.id, String(req.params.id))).returning();
    if (!row) throw notFound('Kæden');
    bumpDataVersion();
    res.json(row);
  });

  r.patch('/sources/:id', async (req, res) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const [row] = await db
      .update(scrapeSources)
      .set({ enabled })
      .where(eq(scrapeSources.id, String(req.params.id)))
      .returning();
    if (!row) throw notFound('Kilden');
    res.json(row);
  });

  r.post('/scrape', async (req, res) => {
    const { sources } = parse(z.object({ sources: z.array(z.string()).optional() }), req.body ?? {});
    const unknown = sources?.filter((s) => !SCRAPERS.some((x) => x.id === s)) ?? [];
    if (unknown.length) throw new HttpError(400, `Ukendte kilder: ${unknown.join(', ')}`);
    const started = await scrape.start('manual', sources);
    res.status(202).json({ started });
  });

  r.post('/stores/sync', async (_req, res) => {
    void scrape.syncStoreLocations();
    res.status(202).json({ started: true });
  });

  /** Manuel mapping: "navn X er samme vare som produkt Y". */
  r.post('/aliases', async (req, res) => {
    const body = parse(
      z.object({ alias: z.string().trim().min(2).max(200), unit: z.enum(['stk', 'kg', 'l']), productId: z.number().int().positive() }),
      req.body,
    );
    await addManualAlias(db, body.alias, body.unit, body.productId);
    res.status(201).json({ ok: true });
  });

  /** Seneste afviste/rå records – nyttigt når en kilde har ændret struktur. */
  r.get('/sources/:id/raw', async (req, res) => {
    const rows = await query(
      db,
      sql`SELECT id, external_id, kind, last_seen_at, left(payload::text, 600) AS preview
          FROM raw_offers WHERE source_id = ${String(req.params.id)}
          ORDER BY last_seen_at DESC LIMIT 20`,
    );
    res.json(rows);
  });

  return r;
}
