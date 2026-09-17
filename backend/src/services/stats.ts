import type { StatsDTO } from '@tilbudsradar/shared';
import { categoryLabel } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, queryOne, type Db } from '../db/client';
import { cached, OFFER_SELECT, toOfferDTOs, type OfferRow } from './offers';

export async function getStats(db: Db): Promise<StatsDTO> {
  return cached('stats', 5 * 60 * 1000, async () => {
    const totals = await queryOne<{ total: number; new_today: number; store_count: number; avg_discount: number | null; top: number | null }>(
      db,
      sql`SELECT count(*)::int AS total,
            count(*) FILTER (WHERE o.first_seen_at >= date_trunc('day', now()))::int AS new_today,
            count(DISTINCT o.store_id)::int AS store_count,
            avg(100 * (o.original_price - o.offer_price) / o.original_price) FILTER (WHERE o.original_price > o.offer_price)::float8 AS avg_discount,
            max(100 * (o.original_price - o.offer_price) / o.original_price) FILTER (WHERE o.original_price > o.offer_price)::float8 AS top
          FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now()`,
    );

    // "Reelle tilbud" kræver troværdighedsvurdering af alle aktive tilbud med historik.
    const active = await query<OfferRow>(
      db,
      sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now() AND o.product_id IS NOT NULL
          LIMIT 6000`,
    );
    const dtos = await toOfferDTOs(db, active);
    const realDeals = dtos.filter((d) => d.trust.level === 'real').length;
    const topSavings = Math.max(totals?.top ?? 0, ...dtos.map((d) => d.trust.savingsPct ?? 0));

    const categories = await query<{ category: string; n: number }>(
      db,
      sql`SELECT o.category, count(*)::int AS n FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now() + interval '8 days'
          GROUP BY o.category ORDER BY n DESC`,
    );

    // Ændring i enhedspris for varer observeret både for ~30 dage siden og den seneste uge.
    const trend = await queryOne<{ ratio: number | null; n: number }>(
      db,
      sql`WITH recent AS (
            SELECT product_id, store_id, avg(unit_price) AS p FROM price_history
            WHERE observed_on >= current_date - 7 AND unit_price IS NOT NULL GROUP BY 1, 2
          ), earlier AS (
            SELECT product_id, store_id, avg(unit_price) AS p FROM price_history
            WHERE observed_on BETWEEN current_date - 37 AND current_date - 23 AND unit_price IS NOT NULL GROUP BY 1, 2
          )
          SELECT avg(r.p / NULLIF(e.p, 0))::float8 AS ratio, count(*)::int AS n
          FROM recent r JOIN earlier e USING (product_id, store_id)`,
    );

    const next = await queryOne<{ next: Date | null }>(
      db,
      sql`SELECT min(valid_from) AS next FROM offers WHERE valid_from > now()`,
    );
    const lastRun = await queryOne<{ at: Date | null }>(
      db,
      sql`SELECT max(finished_at) AS at FROM scrape_runs WHERE status IN ('success', 'partial')`,
    );

    const timelineRows = await query<{ day: string; store_id: string; n: number }>(
      db,
      sql`SELECT d::date::text AS day, o.store_id, count(*)::int AS n
          FROM generate_series(current_date - 13, current_date + 7, interval '1 day') d
          JOIN offers o ON o.valid_from < d + interval '1 day' AND o.valid_to > d
          JOIN stores s ON s.id = o.store_id AND s.enabled
          GROUP BY 1, 2 ORDER BY 1`,
    );
    const timeline = new Map<string, { date: string; count: number; stores: Record<string, number> }>();
    for (const r of timelineRows) {
      const e = timeline.get(r.day) ?? { date: r.day, count: 0, stores: {} };
      e.count += r.n;
      e.stores[r.store_id] = r.n;
      timeline.set(r.day, e);
    }

    return {
      totalOffers: totals?.total ?? 0,
      realDeals,
      newToday: totals?.new_today ?? 0,
      storeCount: totals?.store_count ?? 0,
      avgDiscountPct: totals?.avg_discount == null ? null : Math.round(totals.avg_discount * 10) / 10,
      trendPct: trend?.ratio != null && trend.n >= 5 ? Math.round((trend.ratio - 1) * 1000) / 10 : null,
      nextCatalogAt: next?.next ? new Date(next.next).toISOString() : null,
      lastScrapeAt: lastRun?.at ? new Date(lastRun.at).toISOString() : null,
      categoryCounts: categories.map((c) => ({ id: c.category, label: categoryLabel(c.category), count: c.n })),
      timeline: [...timeline.values()],
      topSavings: topSavings > 0 ? Math.round(topSavings) : null,
    };
  });
}
