import { VISIBLE_CATEGORIES } from '@tilbudsradar/shared';
import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../../db/client';
import { communityReports, communityVotes } from '../../db/schema';
import { nearbyLocations, zipToPoint, type GeoPoint } from '../../services/geo';
import {
  getOfferDetail,
  getPriceHistory,
  listStores,
  searchOffers,
  searchProducts,
  topDeals,
} from '../../services/offers';
import { getStats } from '../../services/stats';
import type { AppContext } from '../app';
import { requireAuth, userId } from '../auth';
import { HttpError, notFound, parse } from '../errors';

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));

const geoQuery = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  zip: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  radius: z.coerce.number().min(1).max(200).optional(),
};

const searchSchema = z.object({
  q: z.string().max(120).default(''),
  stores: csv,
  categories: csv,
  sort: z.enum(['unit', 'price', 'discount', 'relevance']).optional(),
  onlyReal: z.enum(['true', 'false']).optional(),
  onlyActive: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(30),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
  ...geoQuery,
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

export function offerRoutes({ db }: AppContext): Router {
  const r = Router();

  async function resolvePoint(q: { lat?: number; lng?: number; zip?: string }): Promise<GeoPoint | null> {
    if (q.lat !== undefined && q.lng !== undefined) return { lat: q.lat, lng: q.lng };
    if (q.zip) {
      const point = await zipToPoint(db, q.zip);
      if (!point) throw new HttpError(422, `Kender ingen butikker nær postnummer ${q.zip} endnu`);
      return point;
    }
    return null;
  }

  /** Søgning på tværs af butikker – sorteret efter pris pr. enhed som standard. */
  r.get('/search', async (req, res) => {
    const q = parse(searchSchema, req.query);
    const point = await resolvePoint(q);
    const sort = q.sort ?? (q.q.trim() ? 'unit' : 'discount');
    res.json(
      await searchOffers(db, {
        q: q.q.trim(),
        stores: q.stores,
        categories: q.categories,
        sort,
        point,
        radiusKm: q.radius ?? 10,
        zip: q.zip ?? null,
        onlyReal: q.onlyReal === 'true',
        onlyActive: q.onlyActive === 'true',
        limit: q.limit,
        offset: q.offset,
      }),
    );
  });

  r.get('/offers/top', async (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(12), stores: csv }), req.query);
    res.json(await topDeals(db, q.limit, q.stores));
  });

  r.get('/offers/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const detail = await getOfferDetail(db, id, req.auth?.sub ?? null);
    if (!detail) throw notFound('Tilbuddet');
    res.json(detail);
  });

  r.get('/products/search', async (req, res) => {
    const q = parse(z.object({ q: z.string().max(80).default('') }), req.query);
    res.json(await searchProducts(db, q.q));
  });

  r.get('/products/:id/history', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(180) }), req.query);
    const history = await getPriceHistory(db, id, days);
    if (!history) throw notFound('Varen');
    res.json(history);
  });

  r.get('/stats', async (_req, res) => {
    res.json(await getStats(db));
  });

  r.get('/stores', async (_req, res) => {
    res.json(await listStores(db));
  });

  r.get('/stores/nearby', async (req, res) => {
    const q = parse(z.object({ ...geoQuery, stores: csv }), req.query);
    const point = await resolvePoint(q);
    if (!point) throw new HttpError(400, 'Angiv lat/lng eller postnummer');
    res.json({ point, locations: await nearbyLocations(db, point, q.radius ?? 10, q.stores) });
  });

  r.get('/categories', (_req, res) => {
    res.json(VISIBLE_CATEGORIES);
  });

  /* ---------------- Community-verificering ---------------- */

  const reportSchema = z.object({
    verdict: z.enum(['real', 'misleading']),
    comment: z
      .string()
      .trim()
      .max(280)
      .optional()
      .transform((v) => (v ? v : null)),
  });

  r.post('/offers/:id/reports', requireAuth, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(reportSchema, req.body);
    const exists = await queryOne<{ id: number }>(db, sql`SELECT id FROM offers WHERE id = ${id}`);
    if (!exists) throw notFound('Tilbuddet');
    const [report] = await db
      .insert(communityReports)
      .values({ offerId: id, userId: userId(req), verdict: body.verdict, comment: body.comment })
      .onConflictDoUpdate({
        target: [communityReports.offerId, communityReports.userId],
        set: { verdict: body.verdict, comment: body.comment, createdAt: new Date() },
      })
      .returning();
    res.status(201).json(report);
  });

  r.delete('/reports/:id', requireAuth, async (req, res) => {
    const { id } = parse(idParam, req.params);
    await db.delete(communityReports).where(and(eq(communityReports.id, id), eq(communityReports.userId, userId(req))));
    res.status(204).end();
  });

  r.post('/reports/:id/vote', requireAuth, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { value } = parse(z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }), req.body);
    const uid = userId(req);
    const report = await queryOne<{ user_id: string }>(db, sql`SELECT user_id FROM community_reports WHERE id = ${id}`);
    if (!report) throw notFound('Vurderingen');
    if (report.user_id === uid) throw new HttpError(400, 'Du kan ikke stemme på din egen vurdering');
    if (value === 0) {
      await db.delete(communityVotes).where(and(eq(communityVotes.reportId, id), eq(communityVotes.userId, uid)));
    } else {
      await db
        .insert(communityVotes)
        .values({ reportId: id, userId: uid, value })
        .onConflictDoUpdate({ target: [communityVotes.reportId, communityVotes.userId], set: { value } });
    }
    res.status(204).end();
  });

  return r;
}
