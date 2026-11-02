import type {
  GscCannibalItem,
  GscCountry,
  GscDeadPageItem,
  GscLowCtrItem,
  GscMissingPageItem,
  GscNearPageOneItem,
  GscOpportunitiesDTO,
  GscPageType,
  GscTotals,
  GscThresholds,
  GscTrendRow,
} from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../../db/client';
import { gscUrlInspections } from '../../db/schema';
import { conceptWords, matchConcept, queryTokens } from '../concepts';
import { inspectionProblems } from '../searchConsole/inspections';
import { addDays } from '../searchConsole/sync';
import { candidateOffers, uncoveredConcepts, type UncoveredConcept } from './candidates';
import { internalPath, siteSnapshot, type PageInfo } from './siteSnapshot';
import { sitemaps, sitemapUrls } from './sitemap';
import { termForText } from './termIndex';

/**
 * Optimeringsmuligheder ud fra Search Console-data (admin "SEO" og
 * `npm run seo:report`). Pejlemærket er sidens egne tal – fx vores egen
 * median-CTR for samme placering – ikke generiske benchmarks.
 *
 * Funktionerne øverst er rene (data ind, liste ud) og testes med fixtures;
 * `opportunitiesForSite` nederst henter data og kalder dem.
 */

/* ------------------------------------------------------------------ */
/* Tærskler – justér her                                              */
/* ------------------------------------------------------------------ */

/** Perioden, der analyseres (og sammenlignes med perioden før). */
export const PERIOD_DAYS = 28;
/** 4.1: mindst så mange visninger, før en lav klikrate tæller. */
export const MIN_IMPRESSIONS_CTR = 50;
/** 4.1: "klart under" = under denne andel af vores egen median for samme placering. */
export const LOW_CTR_FACTOR = 0.6;
/** 4.1: en median kræver mindst så mange sider eller søgeord i intervallet. */
export const MIN_ROWS_FOR_MEDIAN = 3;
/** 4.2: placering 8–20 … */
export const NEAR_MIN_POSITION = 8;
export const NEAR_MAX_POSITION = 20;
/** … med mindst så mange visninger. */
export const MIN_IMPRESSIONS_NEAR = 30;
/** 4.3: søgeord med mindst så mange visninger … */
export const MIN_IMPRESSIONS_MISSING = 5;
/** … om en varetype med mindst så mange tilbud. */
export const MIN_OFFERS_MISSING = 3;
/** 4.3: hvor godt varetypen skal ramme søgeordet (4 = hele ord, 3 = forstavelse). */
export const MIN_CONCEPT_MATCH = 3;
/** 4.4: søgeord med mindst så mange visninger … */
export const CANNIBAL_MIN_IMPRESSIONS = 20;
/** … hvor hver af siderne har mindst denne andel af visningerne. */
export const CANNIBAL_MIN_SHARE = 0.1;
/** 4.5: en side skal have været i sitemapet så længe, før 0 visninger tæller. */
export const DEAD_AFTER_DAYS = 28;
/** Højst så mange punkter pr. liste. */
export const MAX_ITEMS = 25;

export const THRESHOLDS: GscThresholds = {
  PERIOD_DAYS,
  MIN_IMPRESSIONS_CTR,
  LOW_CTR_FACTOR,
  MIN_ROWS_FOR_MEDIAN,
  NEAR_MIN_POSITION,
  NEAR_MAX_POSITION,
  MIN_IMPRESSIONS_NEAR,
  MIN_IMPRESSIONS_MISSING,
  MIN_OFFERS_MISSING,
  CANNIBAL_MIN_IMPRESSIONS,
  CANNIBAL_MIN_SHARE,
  DEAD_AFTER_DAYS,
};

/* ------------------------------------------------------------------ */
/* Hjælpere                                                           */
/* ------------------------------------------------------------------ */

export interface Metric {
  clicks: number;
  impressions: number;
  /** Gennemsnitlig placering vægtet med visninger. */
  position: number;
}
export interface PageMetric extends Metric {
  page: string;
}
export interface QueryMetric extends Metric {
  query: string;
}
export interface QueryPageMetric extends Metric {
  query: string;
  page: string;
}

export const ctrOf = (m: Pick<Metric, 'clicks' | 'impressions'>) => (m.impressions ? m.clicks / m.impressions : 0);

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Placeringsintervallet for 4.1 – null over plads 10. */
export function bucketOf(position: number): '1–3' | '4–6' | '7–10' | null {
  if (position <= 0) return null;
  if (position < 3.5) return '1–3';
  if (position < 6.5) return '4–6';
  if (position < 10.5) return '7–10';
  return null;
}

/** Summer flere rækker: klik og visninger lægges sammen, placeringen vægtes med visninger. */
export function sumMetrics(rows: Metric[]): GscTotals {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const weighted = rows.reduce((s, r) => s + r.position * r.impressions, 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? weighted / impressions : 0 };
}

/** Sidetypen ud fra URL'en. */
export function pageType(path: string): GscPageType {
  if (path === '/') return 'forside';
  if (/^\/tilbud\/[^/]+$/.test(path)) return 'vare';
  if (/^\/butik\/[^/]+$/.test(path)) return 'kæde';
  if (/^\/kategori\/[^/]+$/.test(path)) return 'kategori';
  return 'øvrige';
}

/** Sti for en side-URL fra Google (https://tilbudsradaren.dk/tilbud/smoer → /tilbud/smoer). */
export function pathOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p.length > 1 ? p.replace(/\/+$/, '') : '/';
  } catch {
    return url;
  }
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase('da-DK') + s.slice(1);

/* ------------------------------------------------------------------ */
/* 4.1 Lav klikrate                                                   */
/* ------------------------------------------------------------------ */

export function lowCtr(
  items: (Metric & { kind: 'page' | 'query'; key: string; page: string })[],
  meta: (page: string) => Pick<PageInfo, 'title' | 'description'> | undefined,
): GscLowCtrItem[] {
  const eligible = items.filter((i) => i.impressions >= MIN_IMPRESSIONS_CTR && bucketOf(i.position));
  const medians = new Map<string, number>();
  for (const kind of ['page', 'query'] as const) {
    for (const bucket of ['1–3', '4–6', '7–10'] as const) {
      const ctrs = eligible.filter((i) => i.kind === kind && bucketOf(i.position) === bucket).map(ctrOf);
      if (ctrs.length >= MIN_ROWS_FOR_MEDIAN) medians.set(`${kind}|${bucket}`, median(ctrs));
    }
  }
  return eligible
    .flatMap((i) => {
      const bucket = bucketOf(i.position)!;
      const med = medians.get(`${i.kind}|${bucket}`);
      const ctr = ctrOf(i);
      if (!med || ctr >= med * LOW_CTR_FACTOR) return [];
      const m = meta(i.page);
      return [{ kind: i.kind, key: i.key, page: i.page, impressions: i.impressions, clicks: i.clicks, ctr, position: i.position, medianCtr: med, bucket, title: m?.title ?? null, description: m?.description ?? null }];
    })
    // Størst forventet gevinst først: tabte klik i forhold til medianen.
    .sort((a, b) => (b.medianCtr - b.ctr) * b.impressions - (a.medianCtr - a.ctr) * a.impressions)
    .slice(0, MAX_ITEMS);
}

/* ------------------------------------------------------------------ */
/* 4.2 Tæt på side 1                                                  */
/* ------------------------------------------------------------------ */

export function nearPageOne(pages: PageMetric[], queryPages: QueryPageMetric[], snapshot: Map<string, PageInfo> | null): GscNearPageOneItem[] {
  return pages
    .filter((p) => p.impressions >= MIN_IMPRESSIONS_NEAR && p.position >= NEAR_MIN_POSITION && p.position <= NEAR_MAX_POSITION)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_ITEMS)
    .map((p) => {
      const path = pathOf(p.page);
      const others = snapshot ? [...snapshot.values()].filter((s) => s.path !== path) : [];
      return {
        page: p.page,
        impressions: p.impressions,
        clicks: p.clicks,
        position: p.position,
        topQueries: queryPages
          .filter((q) => q.page === p.page)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 3)
          .map((q) => q.query),
        linkedFrom: others.filter((s) => s.mainLinks.includes(path)).map((s) => s.path).sort(),
        inFooter: others.some((s) => s.siteLinks.includes(path)),
      };
    });
}

/* ------------------------------------------------------------------ */
/* 4.3 Manglende sider                                                */
/* ------------------------------------------------------------------ */

/**
 * Søgeord om en varetype, vi har tilbud på, men ingen side for. Hvert ord i
 * varetypen skal stå i søgeordet ("rødkål tilbud" → rødkål). Søgeord, som en
 * vare på listen allerede dækker, tæller ikke.
 */
export function missingPages(queries: QueryMetric[], concepts: UncoveredConcept[], covered: (query: string) => boolean): GscMissingPageItem[] {
  const candidates = concepts.filter((c) => c.offers >= MIN_OFFERS_MISSING);
  const byConcept = new Map<string, { concept: UncoveredConcept; queries: QueryMetric[] }>();
  for (const q of queries) {
    if (q.impressions < MIN_IMPRESSIONS_MISSING || covered(q.query)) continue;
    const words = queryTokens(q.query);
    let best: { concept: UncoveredConcept; score: number } | null = null;
    for (const c of candidates) {
      const score = matchConcept(words, conceptWords(c.label));
      if (score >= MIN_CONCEPT_MATCH && (!best || score > best.score || (score === best.score && c.offers > best.concept.offers))) best = { concept: c, score };
    }
    if (!best) continue;
    const entry = byConcept.get(best.concept.key) ?? { concept: best.concept, queries: [] };
    entry.queries.push(q);
    byConcept.set(best.concept.key, entry);
  }
  return [...byConcept.values()]
    .map(({ concept, queries: qs }) => {
      const top = [...qs].sort((a, b) => b.impressions - a.impressions)[0]!;
      return {
        query: top.query,
        impressions: qs.reduce((s, q) => s + q.impressions, 0),
        clicks: qs.reduce((s, q) => s + q.clicks, 0),
        label: concept.label,
        category: concept.category,
        offers: concept.offers,
        stores: concept.stores,
        line: `['${capitalize(concept.label).replace(/'/g, "\\'")}', ['${concept.label.replace(/'/g, "\\'")}'], ['${concept.category}']],`,
      };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_ITEMS);
}

/* ------------------------------------------------------------------ */
/* 4.4 Kannibalisering                                                */
/* ------------------------------------------------------------------ */

export function cannibalization(queryPages: QueryPageMetric[]): GscCannibalItem[] {
  const byQuery = new Map<string, QueryPageMetric[]>();
  for (const r of queryPages) byQuery.set(r.query, [...(byQuery.get(r.query) ?? []), r]);
  const items: GscCannibalItem[] = [];
  for (const [query, rows] of byQuery) {
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    if (impressions < CANNIBAL_MIN_IMPRESSIONS) continue;
    const pages = rows.filter((r) => r.impressions / impressions >= CANNIBAL_MIN_SHARE).sort((a, b) => b.impressions - a.impressions);
    if (pages.length < 2) continue;
    items.push({ query, impressions, pages: pages.map((p) => ({ page: p.page, impressions: p.impressions, clicks: p.clicks, position: p.position })) });
  }
  return items.sort((a, b) => b.impressions - a.impressions).slice(0, MAX_ITEMS);
}

/* ------------------------------------------------------------------ */
/* 4.5 Døde sider                                                     */
/* ------------------------------------------------------------------ */

export function deadPages(o: {
  /** Stier i vores sitemap. */
  paths: string[];
  /** Første gang stien var i sitemapet. */
  firstSeen: Map<string, Date>;
  /** Visninger pr. sti i perioden. */
  impressions: Map<string, number>;
  /** Stier, Google ikke har indekseret – med Googles begrundelse. */
  notIndexed: Map<string, string>;
  now: Date;
}): GscDeadPageItem[] {
  const cutoff = o.now.getTime() - DEAD_AFTER_DAYS * 86_400_000;
  const items: GscDeadPageItem[] = [];
  for (const path of o.paths) {
    const reason = o.notIndexed.get(path);
    if (reason) {
      items.push({ path, reason: 'not_indexed', detail: reason });
      continue;
    }
    const seen = o.firstSeen.get(path);
    if (seen && seen.getTime() <= cutoff && !(o.impressions.get(path) ?? 0)) {
      items.push({ path, reason: 'no_impressions', detail: `Ingen visninger de sidste ${DEAD_AFTER_DAYS} dage` });
    }
  }
  return items.sort((a, b) => a.reason.localeCompare(b.reason) || a.path.localeCompare(b.path));
}

/* ------------------------------------------------------------------ */
/* 4.6 Trend                                                          */
/* ------------------------------------------------------------------ */

const TYPE_LABEL: Record<GscPageType, string> = { vare: 'Varesider', kæde: 'Kædesider', kategori: 'Kategorisider', forside: 'Forsiden', øvrige: 'Øvrige sider' };

export function trend(current: GscTotals, previous: GscTotals, currentPages: PageMetric[], previousPages: PageMetric[]): { total: GscTrendRow; byType: GscTrendRow[] } {
  const ofType = (rows: PageMetric[], type: GscPageType) => sumMetrics(rows.filter((r) => pageType(pathOf(r.page)) === type));
  return {
    total: { label: 'I alt', current, previous },
    byType: (Object.keys(TYPE_LABEL) as GscPageType[]).map((type) => ({
      label: TYPE_LABEL[type],
      current: ofType(currentPages, type),
      previous: ofType(previousPages, type),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Data fra databasen                                                 */
/* ------------------------------------------------------------------ */

interface Range {
  start: string;
  end: string;
}

const metricSelect = sql`sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
  coalesce(sum(position * impressions) / nullif(sum(impressions), 0), 0)::float8 AS position`;

export async function latestDataDate(db: Db, country: GscCountry): Promise<string | null> {
  const [row] = await query<{ d: string | null }>(db, sql`SELECT max(date)::text AS d FROM gsc_metrics WHERE kind = 'total' AND country = ${country}`);
  return row?.d ?? null;
}

export const pageMetrics = (db: Db, country: GscCountry, r: Range, device?: string) =>
  query<PageMetric>(
    db,
    sql`SELECT page, ${metricSelect} FROM gsc_metrics
        WHERE kind = 'page_device' AND search_type = 'web' AND country = ${country} AND date BETWEEN ${r.start} AND ${r.end}
        ${device ? sql`AND device = ${device}` : sql``}
        GROUP BY page`,
  );

export const queryMetrics = (db: Db, country: GscCountry, r: Range, type = 'web') =>
  query<QueryMetric>(
    db,
    sql`SELECT query, ${metricSelect} FROM gsc_metrics
        WHERE kind = 'query_page' AND search_type = ${type} AND country = ${country} AND date BETWEEN ${r.start} AND ${r.end}
        GROUP BY query`,
  );

export const queryPageMetrics = (db: Db, country: GscCountry, r: Range) =>
  query<QueryPageMetric>(
    db,
    sql`SELECT query, page, ${metricSelect} FROM gsc_metrics
        WHERE kind = 'query_page' AND search_type = 'web' AND country = ${country} AND date BETWEEN ${r.start} AND ${r.end}
        GROUP BY query, page`,
  );

export async function siteTotals(db: Db, country: GscCountry, r: Range, device?: string): Promise<GscTotals> {
  const rows = await query<Metric>(
    db,
    device
      ? sql`SELECT ${metricSelect} FROM gsc_metrics WHERE kind = 'total_device' AND search_type = 'web' AND country = ${country}
            AND device = ${device} AND date BETWEEN ${r.start} AND ${r.end}`
      : sql`SELECT ${metricSelect} FROM gsc_metrics WHERE kind = 'total' AND search_type = 'web' AND country = ${country}
            AND date BETWEEN ${r.start} AND ${r.end}`,
  );
  return sumMetrics(rows.map((x) => ({ clicks: x.clicks ?? 0, impressions: x.impressions ?? 0, position: x.position ?? 0 })));
}

/** Perioden for analysen: de seneste 28 dage med endelige tal og de 28 før. */
export function periodsFrom(latest: string, days = PERIOD_DAYS) {
  const end = latest;
  const start = addDays(end, -(days - 1));
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { start, end, previousStart, previousEnd };
}

export async function opportunitiesForSite(
  db: Db,
  o: { country?: GscCountry; now?: Date; appUrl: string; snapshot?: Map<string, PageInfo> | null },
): Promise<GscOpportunitiesDTO> {
  const country = o.country ?? 'all';
  const now = o.now ?? new Date();
  const snapshot = o.snapshot === undefined ? await siteSnapshot(db, o.appUrl) : o.snapshot;
  const base = { generatedAt: now.toISOString(), country, snapshotAvailable: Boolean(snapshot), thresholds: THRESHOLDS };
  const latest = await latestDataDate(db, country);
  if (!latest) return { ...base, period: null, lowCtr: [], nearPageOne: [], missingPages: [], cannibalization: [], deadPages: [], trend: null };

  const period = periodsFrom(latest);
  const current = { start: period.start, end: period.end };
  const previous = { start: period.previousStart, end: period.previousEnd };
  const pages = await pageMetrics(db, country, current);
  const previousPages = await pageMetrics(db, country, previous);
  const queries = await queryMetrics(db, country, current);
  const queryPages = await queryPageMetrics(db, country, current);
  const totals = await siteTotals(db, country, current);
  const previousTotals = await siteTotals(db, country, previous);

  const meta = (page: string) => snapshot?.get(pathOf(page));
  const topPage = new Map<string, QueryPageMetric>();
  for (const r of queryPages) if (!topPage.has(r.query) || topPage.get(r.query)!.impressions < r.impressions) topPage.set(r.query, r);

  const ctrItems = [
    ...pages.map((p) => ({ ...p, kind: 'page' as const, key: p.page })),
    ...queries.map((q) => ({ ...q, kind: 'query' as const, key: q.query, page: topPage.get(q.query)?.page ?? '' })),
  ];

  // Døde sider: sitemap, første gang set og indekseringsstatus.
  const paths = sitemapUrls(await sitemaps(db)).map((e) => e.path);
  const inspections = await db.select().from(gscUrlInspections);
  const firstSeen = new Map<string, Date>();
  const notIndexed = new Map<string, string>();
  for (const row of inspections) {
    const path = internalPath(row.url, o.appUrl) ?? pathOf(row.url);
    firstSeen.set(path, row.firstSeenAt);
    const problem = inspectionProblems(row, row.inSitemap, now).find((p) => p.code === 'not_indexed');
    if (problem) notIndexed.set(path, problem.label);
  }
  const impressions = new Map<string, number>();
  for (const p of pages) impressions.set(pathOf(p.page), (impressions.get(pathOf(p.page)) ?? 0) + p.impressions);

  return {
    ...base,
    period,
    lowCtr: lowCtr(ctrItems, meta),
    nearPageOne: nearPageOne(pages, queryPages, snapshot),
    missingPages: missingPages(queries, uncoveredConcepts(await candidateOffers(db)), (q) => termForText(q) !== null),
    cannibalization: cannibalization(queryPages),
    deadPages: deadPages({ paths, firstSeen, impressions, notIndexed, now }),
    trend: trend(totals, previousTotals, pages, previousPages),
  };
}
