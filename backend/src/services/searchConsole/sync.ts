import { and, eq, max, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { gscMetrics, gscSitemaps } from '../../db/schema';
import type { Dimension, GscClient, SearchType } from './client';

/**
 * Henter søgeresultater fra Search Console og upserter dem pr. dag.
 * Første gang hentes så langt tilbage som API'et tillader (16 måneder);
 * derefter de seneste dage igen, fordi Googles tal justeres de første dage.
 */

/** Så mange af de seneste dage hentes igen hver gang. */
export const RECENT_DAYS = 5;
/** Search Console gemmer 16 måneders data. */
export const BACKFILL_MONTHS = 16;
/** Første hentning deles i bidder af så mange dage. */
export const BACKFILL_CHUNK_DAYS = 31;
/** Foreløbige tal (dataState "all") for så mange dage. */
export const FRESH_DAYS = 5;

export type MetricKind = 'query_page' | 'total' | 'total_device' | 'page_device' | 'page' | 'total_fresh';

interface Dataset {
  kind: MetricKind;
  type: SearchType;
  dimensions: Dimension[];
}

/** Datasættene, der gemmes (dataState "final"). */
export const DATASETS: Dataset[] = [
  { kind: 'query_page', type: 'web', dimensions: ['date', 'query', 'page'] },
  // Totaler hentes for sig: rækker pr. søgeord summerer ikke til totalen, fordi sjældne søgninger anonymiseres.
  { kind: 'total', type: 'web', dimensions: ['date'] },
  { kind: 'total_device', type: 'web', dimensions: ['date', 'device'] },
  { kind: 'page_device', type: 'web', dimensions: ['date', 'page', 'device'] },
  { kind: 'query_page', type: 'image', dimensions: ['date', 'query', 'page'] },
  // Discover har hverken søgeord eller placering.
  { kind: 'page', type: 'discover', dimensions: ['date', 'page'] },
];

/** 'all' = alle lande samlet, 'dnk' = Danmark for sig. */
export const COUNTRIES = [
  { key: 'all', filter: undefined },
  { key: 'dnk', filter: 'dnk' },
] as const;

const DAY = 86_400_000;
const copenhagenDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });

/** "YYYY-MM-DD" i dansk tid. */
export const isoDay = (d: Date) => copenhagenDay.format(d);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Perioden, der skal hentes: backfill første gang, ellers de seneste dage (og huller siden sidste kørsel). */
export async function syncRange(db: Db, now = new Date()): Promise<{ start: string; end: string; backfill: boolean }> {
  const end = isoDay(now);
  const [row] = await db.select({ latest: max(gscMetrics.date) }).from(gscMetrics).where(eq(gscMetrics.kind, 'total'));
  const latest = row?.latest ?? null;
  const earliest = isoDay(new Date(now.getTime() - BACKFILL_MONTHS * 30.4 * DAY));
  if (!latest) return { start: earliest, end, backfill: true };
  const start = addDays(latest < end ? latest : end, -(RECENT_DAYS - 1));
  return { start: start < earliest ? earliest : start, end, backfill: false };
}

/** Periode i bidder (første hentning kan være 16 måneder). */
export function chunks(start: string, end: string, size = BACKFILL_CHUNK_DAYS): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  for (let s = start; s <= end; s = addDays(s, size)) {
    const e = addDays(s, size - 1);
    out.push({ start: s, end: e < end ? e : end });
  }
  return out;
}

type MetricInsert = typeof gscMetrics.$inferInsert;

/** Upsert i bidder – samme nøgle (dag, datasæt, land, søgeord, side, enhed) opdateres. */
export async function upsertMetrics(db: Db, rows: MetricInsert[], now = new Date()): Promise<number> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(gscMetrics)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [gscMetrics.date, gscMetrics.kind, gscMetrics.searchType, gscMetrics.country, gscMetrics.query, gscMetrics.page, gscMetrics.device],
        set: {
          clicks: sql`excluded.clicks`,
          impressions: sql`excluded.impressions`,
          ctr: sql`excluded.ctr`,
          position: sql`excluded.position`,
          updatedAt: now,
        },
      });
  }
  return rows.length;
}

function toRows(dataset: Dataset, country: string, raw: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]): MetricInsert[] {
  return raw.map((r) => {
    const dim = (d: Dimension) => {
      const i = dataset.dimensions.indexOf(d);
      return i >= 0 ? (r.keys[i] ?? '') : '';
    };
    return {
      date: dim('date'),
      kind: dataset.kind,
      searchType: dataset.type,
      country,
      query: dim('query'),
      page: dim('page'),
      device: dim('device'),
      clicks: Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      ctr: r.ctr,
      position: r.position,
    };
  });
}

/** Henter og upserter alle datasæt for begge "lande" i perioden. Returnerer antal rækker. */
export async function syncMetrics(db: Db, client: GscClient, range: { start: string; end: string }, now = new Date()): Promise<number> {
  let total = 0;
  for (const part of chunks(range.start, range.end)) {
    for (const dataset of DATASETS) {
      for (const country of COUNTRIES) {
        const raw = await client.searchAnalytics({
          startDate: part.start,
          endDate: part.end,
          dimensions: dataset.dimensions,
          type: dataset.type,
          dataState: 'final',
          ...(country.filter ? { country: country.filter } : {}),
        });
        total += await upsertMetrics(db, toRows(dataset, country.key, raw), now);
      }
    }
  }
  return total;
}

/** Foreløbige totaler for de seneste dage (dataState "all") – vises for sig i admin og erstattes hver gang. */
export async function syncFreshTotals(db: Db, client: GscClient, now = new Date()): Promise<number> {
  const end = isoDay(now);
  const start = addDays(end, -(FRESH_DAYS - 1));
  const rows: MetricInsert[] = [];
  for (const country of COUNTRIES) {
    const raw = await client.searchAnalytics({
      startDate: start,
      endDate: end,
      dimensions: ['date'],
      type: 'web',
      dataState: 'all',
      ...(country.filter ? { country: country.filter } : {}),
    });
    rows.push(...toRows({ kind: 'total_fresh', type: 'web', dimensions: ['date'] }, country.key, raw));
  }
  await db.delete(gscMetrics).where(eq(gscMetrics.kind, 'total_fresh'));
  return upsertMetrics(db, rows, now);
}

/** Status pr. sitemap. Sitemaps, der ikke længere er indsendt, fjernes. */
export async function syncSitemaps(db: Db, client: GscClient, now = new Date()): Promise<number> {
  const list = await client.listSitemaps();
  for (const s of list) {
    const values = {
      lastSubmitted: s.lastSubmitted ? new Date(s.lastSubmitted) : null,
      lastDownloaded: s.lastDownloaded ? new Date(s.lastDownloaded) : null,
      isPending: s.isPending,
      isIndex: s.isSitemapsIndex,
      errors: s.errors,
      warnings: s.warnings,
      submitted: s.submitted,
      fetchedAt: now,
    };
    await db.insert(gscSitemaps).values({ path: s.path, ...values }).onConflictDoUpdate({ target: gscSitemaps.path, set: values });
  }
  const paths = list.map((s) => s.path);
  await (paths.length ? db.delete(gscSitemaps).where(notInArray(gscSitemaps.path, paths)) : db.delete(gscSitemaps));
  return list.length;
}

/** Bruges i tests og admin: antal rækker for et datasæt. */
export async function countMetrics(db: Db, kind: MetricKind, country = 'all'): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gscMetrics)
    .where(and(eq(gscMetrics.kind, kind), eq(gscMetrics.country, country)));
  return row?.n ?? 0;
}
