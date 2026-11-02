import type {
  GscCountry,
  GscDay,
  GscDevice,
  GscIndexingDTO,
  GscInspectionRow,
  GscOverviewDTO,
  GscRunStatus,
  GscSetupStatus,
  GscSitemapsDTO,
  GscTotals,
} from '@tilbudsradar/shared';
import { desc, sql } from 'drizzle-orm';
import { query, type Db } from '../../db/client';
import { gscSitemaps, gscSyncRuns, gscUrlInspections } from '../../db/schema';
import { latestDataDate, pageMetrics, pathOf, periodsFrom, queryMetrics, siteTotals, type Metric } from '../seo/opportunities';
import { inspectionProblems } from './inspections';
import { INSPECT_PER_DAY } from './quota';
import { addDays } from './sync';

/** Svarene til admin-siden "SEO" ud fra de gemte Search Console-data. */

const TOP = 50;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function lastRun(db: Db): Promise<GscRunStatus | null> {
  const [r] = await db.select().from(gscSyncRuns).orderBy(desc(gscSyncRuns.id)).limit(1);
  if (!r) return null;
  return {
    startedAt: r.startedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    trigger: r.trigger,
    status: r.status as GscRunStatus['status'],
    rows: r.rows,
    inspected: r.inspected,
    error: r.error,
  };
}

const withCtr = <T extends Metric>(m: T): T & GscTotals => ({ ...m, ctr: m.impressions ? m.clicks / m.impressions : 0 });
const byClicks = (a: Metric, b: Metric) => b.clicks - a.clicks || b.impressions - a.impressions;

/** Tal pr. dag i perioden – dage uden tal kommer med som 0. */
async function daily(db: Db, country: GscCountry, device: GscDevice, start: string, end: string, kind: 'total' | 'total_fresh' = 'total'): Promise<GscDay[]> {
  const deviceKind = device === 'all' || kind === 'total_fresh';
  const rows = await query<{ day: string } & Metric>(
    db,
    sql`SELECT date::text AS day, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
          coalesce(sum(position * impressions) / nullif(sum(impressions), 0), 0)::float8 AS position
        FROM gsc_metrics
        WHERE kind = ${deviceKind ? kind : 'total_device'} AND search_type = 'web' AND country = ${country}
          ${deviceKind ? sql`` : sql`AND device = ${device}`}
          AND date BETWEEN ${start} AND ${end}
        GROUP BY date ORDER BY date`,
  );
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: GscDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const r = map.get(d) ?? { clicks: 0, impressions: 0, position: 0 };
    out.push({ day: d, ...withCtr({ clicks: r.clicks, impressions: r.impressions, position: r.position }) });
  }
  return out;
}

export async function overview(
  db: Db,
  o: { setup: GscSetupStatus; running: boolean; days: number; country: GscCountry; device: GscDevice; now?: Date },
): Promise<GscOverviewDTO> {
  const now = o.now ?? new Date();
  const base = {
    setup: o.setup,
    lastRun: await lastRun(db),
    running: o.running,
    generatedAt: now.toISOString(),
    days: o.days,
    country: o.country,
    device: o.device,
  };
  const latest = await latestDataDate(db, o.country);
  if (!latest) {
    return { ...base, period: null, current: null, previous: null, byDay: [], fresh: [], topQueries: [], topPages: [], discover: [], images: [] };
  }
  const period = periodsFrom(latest, o.days);
  const cur = { start: period.start, end: period.end };
  const device = o.device === 'all' ? undefined : o.device;

  const current = await siteTotals(db, o.country, cur, device);
  const previous = await siteTotals(db, o.country, { start: period.previousStart, end: period.previousEnd }, device);
  const byDay = await daily(db, o.country, o.device, cur.start, cur.end);
  const freshAll = await daily(db, o.country, 'all', addDays(latest, 1), addDays(latest, 5), 'total_fresh');
  const queries = await queryMetrics(db, o.country, cur);
  const pages = await pageMetrics(db, o.country, cur, device);
  const discover = await query<{ page: string } & Metric>(
    db,
    sql`SELECT page, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions, 0::float8 AS position
        FROM gsc_metrics WHERE kind = 'page' AND search_type = 'discover' AND country = ${o.country}
          AND date BETWEEN ${cur.start} AND ${cur.end} GROUP BY page`,
  );
  const images = await queryMetrics(db, o.country, cur, 'image');

  // Søgeordets side: den, der fik flest visninger for søgeordet.
  const topPage = await query<{ query: string; page: string }>(
    db,
    sql`SELECT DISTINCT ON (query) query, page FROM gsc_metrics
        WHERE kind = 'query_page' AND search_type = 'web' AND country = ${o.country} AND date BETWEEN ${cur.start} AND ${cur.end}
        GROUP BY query, page ORDER BY query, sum(impressions) DESC`,
  );
  const pageFor = new Map(topPage.map((r) => [r.query, r.page]));

  return {
    ...base,
    period,
    current,
    previous,
    byDay,
    // Kun dage uden endelige tal endnu.
    fresh: freshAll.filter((d) => d.impressions > 0 || d.clicks > 0),
    topQueries: queries.sort(byClicks).slice(0, TOP).map((q) => ({ ...withCtr(q), page: pageFor.get(q.query) ?? '' })),
    topPages: pages.sort(byClicks).slice(0, TOP).map(withCtr),
    discover: discover.sort(byClicks).slice(0, TOP).map(withCtr),
    images: images.sort(byClicks).slice(0, TOP).map(withCtr),
  };
}

export function toInspectionRow(r: typeof gscUrlInspections.$inferSelect, now = new Date()): GscInspectionRow {
  return {
    url: r.url,
    path: pathOf(r.url),
    inSitemap: r.inSitemap,
    inspectedAt: iso(r.inspectedAt),
    verdict: r.verdict,
    coverageState: r.coverageState,
    robotsTxtState: r.robotsTxtState,
    indexingState: r.indexingState,
    pageFetchState: r.pageFetchState,
    lastCrawlTime: iso(r.lastCrawlTime),
    googleCanonical: r.googleCanonical,
    userCanonical: r.userCanonical,
    crawledAs: r.crawledAs,
    error: r.error,
    problems: inspectionProblems(r, r.inSitemap, now),
  };
}

export async function indexing(db: Db, setup: GscSetupStatus, now = new Date()): Promise<GscIndexingDTO> {
  const rows = (await db.select().from(gscUrlInspections)).map((r) => toInspectionRow(r, now));
  // Problemer først, derefter ikke tjekket, så resten efter sti.
  rows.sort((a, b) => b.problems.length - a.problems.length || Number(Boolean(a.inspectedAt)) - Number(Boolean(b.inspectedAt)) || a.path.localeCompare(b.path));
  const [used] = await query<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM gsc_inspection_calls WHERE called_at > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz`);
  const inSitemap = rows.filter((r) => r.inSitemap);
  return {
    setup,
    rows,
    counts: {
      inSitemap: inSitemap.length,
      inspected: inSitemap.filter((r) => r.inspectedAt).length,
      indexed: inSitemap.filter((r) => r.verdict === 'PASS').length,
      withProblems: rows.filter((r) => r.problems.length).length,
    },
    quota: { usedToday: used?.n ?? 0, limit: INSPECT_PER_DAY },
  };
}

export async function sitemapsReport(db: Db, setup: GscSetupStatus): Promise<GscSitemapsDTO> {
  const rows = await db.select().from(gscSitemaps).orderBy(gscSitemaps.path);
  return {
    setup,
    rows: rows.map((r) => ({
      path: r.path,
      lastSubmitted: iso(r.lastSubmitted),
      lastDownloaded: iso(r.lastDownloaded),
      isPending: r.isPending,
      isIndex: r.isIndex,
      errors: r.errors,
      warnings: r.warnings,
      submitted: r.submitted,
      fetchedAt: r.fetchedAt.toISOString(),
    })),
  };
}

