import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { gscInspectionCalls, gscUrlInspections } from '../../db/schema';
import type { UrlInspection } from './client';

/** En side, der ikke er crawlet i så mange dage, markeres. */
export const STALE_CRAWL_DAYS = 30;
const DAY = 86_400_000;

export type InspectionProblemCode = 'not_indexed' | 'noindex' | 'robots_blocked' | 'canonical_mismatch' | 'fetch_error' | 'stale_crawl';

export interface InspectionProblem {
  code: InspectionProblemCode;
  label: string;
}

export type InspectionRow = typeof gscUrlInspections.$inferSelect;

/**
 * Problemer for en inspiceret URL. `shouldIndex` = siden er i vores sitemap,
 * dvs. den skal i Google. Ikke-inspicerede URL'er har ingen problemer endnu.
 */
export function inspectionProblems(row: Pick<InspectionRow, keyof UrlInspection | 'inspectedAt'> & { lastCrawlTime: Date | null }, shouldIndex: boolean, now = new Date()): InspectionProblem[] {
  if (!row.inspectedAt || !row.verdict) return [];
  const problems: InspectionProblem[] = [];
  if (shouldIndex && row.verdict !== 'PASS') problems.push({ code: 'not_indexed', label: `Ikke indekseret: ${row.coverageState ?? row.verdict}` });
  if (shouldIndex && (row.indexingState === 'BLOCKED_BY_META_TAG' || row.indexingState === 'BLOCKED_BY_HTTP_HEADER')) {
    problems.push({ code: 'noindex', label: `noindex på en side, der skal indekseres (${row.indexingState})` });
  }
  if (shouldIndex && row.robotsTxtState === 'DISALLOWED') problems.push({ code: 'robots_blocked', label: 'Blokeret af robots.txt' });
  if (row.googleCanonical && row.userCanonical && row.googleCanonical !== row.userCanonical) {
    problems.push({ code: 'canonical_mismatch', label: `Google valgte en anden canonical: ${row.googleCanonical}` });
  }
  // PAGE_FETCH_STATE_UNSPECIFIED = aldrig hentet; det er "ikke indekseret", ikke en fejl ved hentning.
  if (row.pageFetchState && row.pageFetchState !== 'SUCCESSFUL' && row.pageFetchState !== 'PAGE_FETCH_STATE_UNSPECIFIED') {
    problems.push({ code: 'fetch_error', label: `Fejl ved hentning: ${row.pageFetchState}` });
  }
  if (row.lastCrawlTime && now.getTime() - row.lastCrawlTime.getTime() > STALE_CRAWL_DAYS * DAY) {
    problems.push({ code: 'stale_crawl', label: `Ikke crawlet i over ${STALE_CRAWL_DAYS} dage` });
  }
  return problems;
}

/** Sitemappets URL'er bliver kandidater; URL'er, der er faldet ud, markeres (historikken bevares). */
export async function syncInspectionTargets(db: Db, urls: string[], now = new Date()): Promise<void> {
  if (urls.length) {
    for (let i = 0; i < urls.length; i += 500) {
      await db
        .insert(gscUrlInspections)
        .values(urls.slice(i, i + 500).map((url) => ({ url, firstSeenAt: now, inSitemap: true })))
        .onConflictDoUpdate({ target: gscUrlInspections.url, set: { inSitemap: true } });
    }
    await db.update(gscUrlInspections).set({ inSitemap: false }).where(notInArray(gscUrlInspections.url, urls));
  } else {
    await db.update(gscUrlInspections).set({ inSitemap: false });
  }
}

/** De næste URL'er i rotationen: aldrig tjekkede først, derefter de ældst tjekkede. */
export async function nextInspectionTargets(db: Db, limit: number): Promise<string[]> {
  const rows = await db
    .select({ url: gscUrlInspections.url })
    .from(gscUrlInspections)
    .where(eq(gscUrlInspections.inSitemap, true))
    .orderBy(sql`${gscUrlInspections.inspectedAt} ASC NULLS FIRST`, asc(gscUrlInspections.url))
    .limit(limit);
  return rows.map((r) => r.url);
}

/** Gemmer resultatet af en inspektion (eller fejlen, så rotationen går videre). */
export async function saveInspection(db: Db, url: string, result: UrlInspection | { error: string }, now = new Date()): Promise<void> {
  const values =
    'error' in result
      ? { inspectedAt: now, error: result.error }
      : {
          inspectedAt: now,
          error: null,
          verdict: result.verdict,
          coverageState: result.coverageState,
          robotsTxtState: result.robotsTxtState,
          indexingState: result.indexingState,
          pageFetchState: result.pageFetchState,
          lastCrawlTime: result.lastCrawlTime ? new Date(result.lastCrawlTime) : null,
          googleCanonical: result.googleCanonical,
          userCanonical: result.userCanonical,
          crawledAs: result.crawledAs,
        };
  await db
    .insert(gscUrlInspections)
    .values({ url, firstSeenAt: now, inSitemap: false, ...values })
    .onConflictDoUpdate({ target: gscUrlInspections.url, set: values });
}

/** Tidspunkter for kald det seneste døgn – til kvoten. Gamle rækker ryddes op. */
export async function recentInspectionCalls(db: Db, now = new Date()): Promise<number[]> {
  await db.delete(gscInspectionCalls).where(sql`${gscInspectionCalls.calledAt} < ${new Date(now.getTime() - 2 * DAY).toISOString()}::timestamptz`);
  const rows = await db
    .select({ at: gscInspectionCalls.calledAt })
    .from(gscInspectionCalls)
    .where(gt(gscInspectionCalls.calledAt, new Date(now.getTime() - DAY)));
  return rows.map((r) => r.at.getTime());
}

export async function recordInspectionCall(db: Db, at = new Date()): Promise<void> {
  await db.insert(gscInspectionCalls).values({ calledAt: at });
}

export async function inspectionsFor(db: Db, urls: string[]): Promise<InspectionRow[]> {
  if (!urls.length) return [];
  return db.select().from(gscUrlInspections).where(and(inArray(gscUrlInspections.url, urls)));
}
