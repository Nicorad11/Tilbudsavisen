import type { Notifier, ScraperAlert } from '@tilbudsradar/scrapers';
import { silentLogger } from '@tilbudsradar/scrapers';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { gscInspectionCalls, gscMetrics, gscSitemaps, gscSyncRuns, gscUrlInspections } from '../src/db/schema';
import { GscApiError, type GscClient, type SearchAnalyticsRequest, type UrlInspection } from '../src/services/searchConsole/client';
import type { GscConfig } from '../src/services/searchConsole/config';
import { inspectionProblems, nextInspectionTargets } from '../src/services/searchConsole/inspections';
import { QuotaLimiter } from '../src/services/searchConsole/quota';
import { createSearchConsoleService, GscUnavailableError } from '../src/services/searchConsole/service';
import { addDays, BACKFILL_CHUNK_DAYS, DATASETS, RECENT_DAYS } from '../src/services/searchConsole/sync';

/** Synkronisering med Search Console: upsert, backfill, rotation, kvote og fejl. Google er en falsk klient. */

const NOW = new Date('2026-11-10T07:40:00Z');
const TODAY = '2026-11-10';
/** Ejendommen er ny: Google har kun data for de seneste 7 dage. */
const FIRST_DATA = addDays(TODAY, -6);
const config: GscConfig = { enabled: true, clientEmail: 'gsc@test.iam.gserviceaccount.com', privateKey: 'x', siteUrl: 'sc-domain:tilbudsradar.test' };
const PASS: UrlInspection = {
  verdict: 'PASS',
  coverageState: 'Submitted and indexed',
  robotsTxtState: 'ALLOWED',
  indexingState: 'INDEXING_ALLOWED',
  pageFetchState: 'SUCCESSFUL',
  lastCrawlTime: '2026-11-08T03:00:00Z',
  googleCanonical: null,
  userCanonical: null,
  crawledAs: 'MOBILE',
};

function fakeClient() {
  const state = { clicks: 5, fail: null as GscApiError | null, inspectFail: null as GscApiError | null };
  const calls = { search: [] as SearchAnalyticsRequest[], inspect: [] as string[] };
  const client: GscClient = {
    async searchAnalytics(req) {
      calls.search.push(req);
      if (state.fail) throw state.fail;
      const rows = [];
      for (let d = req.startDate > FIRST_DATA ? req.startDate : FIRST_DATA; d <= req.endDate && d <= TODAY; d = addDays(d, 1)) {
        const keys = req.dimensions.map((dim) =>
          dim === 'date' ? d : dim === 'query' ? 'smør tilbud' : dim === 'page' ? 'https://tilbudsradar.test/tilbud/smoer' : dim === 'device' ? 'MOBILE' : 'dnk',
        );
        rows.push({ keys, clicks: state.clicks, impressions: 100, ctr: state.clicks / 100, position: 6.5 });
      }
      return rows;
    },
    async inspectUrl(url) {
      calls.inspect.push(url);
      if (state.inspectFail) throw state.inspectFail;
      return PASS;
    },
    async listSitemaps() {
      return [{ path: 'https://tilbudsradar.test/sitemap.xml', lastSubmitted: '2026-11-02T10:00:00Z', lastDownloaded: '2026-11-09T10:00:00Z', isPending: false, isSitemapsIndex: true, errors: 0, warnings: 0, submitted: 12 }];
    },
  };
  return { client, state, calls };
}

function recordingNotifier() {
  const alerts: ScraperAlert[] = [];
  const notifier: Notifier = {
    async notify(a) {
      alerts.push(a);
    },
  };
  return { notifier, alerts };
}

let database: Database;

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
});
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  for (const t of [gscMetrics, gscSyncRuns, gscUrlInspections, gscInspectionCalls, gscSitemaps]) await database.db.delete(t);
});

const service = (client: GscClient, extra: { notifier?: Notifier; now?: () => Date; perRun?: number } = {}) =>
  createSearchConsoleService(database.db, { config, client, log: silentLogger, appUrl: 'https://tilbudsradar.test', now: () => NOW, ...extra });

const metricsRows = (kind: string, country = 'all') =>
  database.db.select().from(gscMetrics).where(and(eq(gscMetrics.kind, kind), eq(gscMetrics.country, country)));

describe('synkronisering', () => {
  it('første gang: backfill i bidder op til 16 måneder tilbage – alle datasæt for alle lande og Danmark', async () => {
    const fake = fakeClient();
    const result = await service(fake.client).sync('cron');
    expect(result.status).toBe('success');

    // 16 måneder i bidder af 31 dage, 6 datasæt, 2 "lande".
    const first = fake.calls.search.filter((c) => c.dataState === 'final').map((c) => c.startDate).sort()[0]!;
    expect(first <= addDays(TODAY, -480)).toBe(true);
    const finalCalls = fake.calls.search.filter((c) => c.dataState === 'final');
    expect(finalCalls.every((c) => Date.parse(c.endDate) - Date.parse(c.startDate) < BACKFILL_CHUNK_DAYS * 86_400_000)).toBe(true);
    expect(new Set(finalCalls.map((c) => `${c.type}:${c.dimensions.join(',')}`)).size).toBe(DATASETS.length);
    expect(finalCalls.some((c) => c.country === 'dnk')).toBe(true);

    expect(await metricsRows('total')).toHaveLength(7);
    expect(await metricsRows('total', 'dnk')).toHaveLength(7);
    const qp = (await metricsRows('query_page')).find((r) => r.searchType === 'web');
    expect((await metricsRows('query_page')).some((r) => r.searchType === 'image')).toBe(true);
    expect(qp).toMatchObject({ query: 'smør tilbud', page: 'https://tilbudsradar.test/tilbud/smoer', clicks: 5, impressions: 100, searchType: 'web' });
    expect((await metricsRows('page')).every((r) => r.searchType === 'discover')).toBe(true);

    // Foreløbige tal og sitemaps.
    expect(fake.calls.search.some((c) => c.dataState === 'all')).toBe(true);
    expect(await metricsRows('total_fresh')).toHaveLength(5);
    expect(await database.db.select().from(gscSitemaps)).toEqual([expect.objectContaining({ path: 'https://tilbudsradar.test/sitemap.xml', submitted: 12, isIndex: true })]);

    const [run] = await database.db.select().from(gscSyncRuns);
    expect(run).toMatchObject({ status: 'success', trigger: 'cron', rangeEnd: TODAY });
  });

  it('derefter: kun de seneste 5 dage igen – upsert opdaterer tallene uden dubletter', async () => {
    const fake = fakeClient();
    const svc = service(fake.client);
    await svc.sync('cron');
    const before = (await database.db.select().from(gscMetrics)).length;

    fake.calls.search.length = 0;
    fake.state.clicks = 9; // Google har justeret tallene.
    expect((await svc.sync('manual')).status).toBe('success');
    const starts = new Set(fake.calls.search.filter((c) => c.dataState === 'final').map((c) => c.startDate));
    expect([...starts]).toEqual([addDays(TODAY, -(RECENT_DAYS - 1))]);

    expect((await database.db.select().from(gscMetrics)).length).toBe(before);
    const totals = (await metricsRows('total')).sort((a, b) => a.date.localeCompare(b.date));
    expect(totals.slice(-RECENT_DAYS).every((r) => r.clicks === 9)).toBe(true);
    expect(totals.slice(0, 7 - RECENT_DAYS).every((r) => r.clicks === 5)).toBe(true);
  });

  it('en fejl fra Google vælter intet: kørslen gemmes som fejlet, og alarm efter 2 fejl i træk', async () => {
    const fake = fakeClient();
    fake.state.fail = new GscApiError(403, 'Search Console svarede 403: User does not have sufficient permission for site.');
    const { notifier, alerts } = recordingNotifier();
    const svc = service(fake.client, { notifier });

    const first = await svc.sync('cron');
    expect(first).toMatchObject({ status: 'failed' });
    expect(first.error).toMatch(/403/);
    expect(alerts).toHaveLength(0);

    await svc.sync('cron');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: 'error', sourceId: 'search-console' });

    const runs = await database.db.select().from(gscSyncRuns);
    expect(runs.map((r) => r.status)).toEqual(['failed', 'failed']);
    // Næste kørsel prøver igen.
    fake.state.fail = null;
    expect((await svc.sync('cron')).status).toBe('success');
  });

  it('kun én kørsel ad gangen', async () => {
    const fake = fakeClient();
    const svc = service(fake.client);
    const [a, b] = await Promise.all([svc.sync('cron'), svc.sync('manual')]);
    expect([a.status, b.status].sort()).toEqual(['busy', 'success']);
  });

  it('ikke sat op: synkronisering springes over, og inspektion afvises pænt', async () => {
    const svc = createSearchConsoleService(database.db, {
      config: { enabled: false, reason: 'GSC_SITE_URL er ikke sat.', clientEmail: null, siteUrl: null },
      log: silentLogger,
    });
    expect(await svc.sync('manual')).toMatchObject({ status: 'skipped', error: 'GSC_SITE_URL er ikke sat.' });
    await expect(svc.inspect('https://tilbudsradar.test/')).rejects.toBeInstanceOf(GscUnavailableError);
    expect(svc.status()).toEqual({ configured: false, reason: 'GSC_SITE_URL er ikke sat.', clientEmail: null, siteUrl: null });
  });
});

describe('URL-inspektion', () => {
  it('inspicerer sitemappets URL\'er og gemmer status', async () => {
    const fake = fakeClient();
    const result = await service(fake.client).sync('cron');
    expect(result.inspected).toBeGreaterThan(5);
    expect(fake.calls.inspect).toContain('https://tilbudsradar.test/');
    expect(fake.calls.inspect.every((u) => u.startsWith('https://tilbudsradar.test/'))).toBe(true);
    const [home] = await database.db.select().from(gscUrlInspections).where(eq(gscUrlInspections.url, 'https://tilbudsradar.test/'));
    expect(home).toMatchObject({ verdict: 'PASS', coverageState: 'Submitted and indexed', crawledAs: 'MOBILE', inSitemap: true });
    expect(home!.lastCrawlTime?.toISOString()).toBe('2026-11-08T03:00:00.000Z');
    expect(await database.db.select().from(gscInspectionCalls)).toHaveLength(result.inspected);
  });

  it('rotation: aldrig tjekkede først, derefter de ældst tjekkede', async () => {
    const t = (d: string) => new Date(`2026-11-${d}T12:00:00Z`);
    await database.db.insert(gscUrlInspections).values([
      { url: 'https://tilbudsradar.test/a', inspectedAt: t('09') },
      { url: 'https://tilbudsradar.test/b', inspectedAt: t('05') },
      { url: 'https://tilbudsradar.test/c', inspectedAt: null },
      { url: 'https://tilbudsradar.test/d', inspectedAt: t('07') },
      { url: 'https://tilbudsradar.test/gammel', inspectedAt: null, inSitemap: false },
    ]);
    expect(await nextInspectionTargets(database.db, 3)).toEqual([
      'https://tilbudsradar.test/c',
      'https://tilbudsradar.test/b',
      'https://tilbudsradar.test/d',
    ]);
  });

  it('en fejlet URL gemmes med fejlen, og rotationen går videre', async () => {
    const fake = fakeClient();
    fake.state.inspectFail = new GscApiError(500, 'Search Console svarede 500: Internal error');
    const result = await service(fake.client, { perRun: 2 }).sync('cron');
    expect(result.status).toBe('partial');
    const failed = await database.db.select().from(gscUrlInspections).where(eq(gscUrlInspections.error, 'Search Console svarede 500: Internal error'));
    expect(failed).toHaveLength(2);
    expect(failed.every((r) => r.inspectedAt !== null)).toBe(true);
  });

  it('manuel inspektion tæller med i kvoten og gemmer resultatet', async () => {
    const fake = fakeClient();
    const row = await service(fake.client).inspect('https://tilbudsradar.test/tilbud/smoer');
    expect(row).toMatchObject({ url: 'https://tilbudsradar.test/tilbud/smoer', verdict: 'PASS' });
    expect(await database.db.select().from(gscInspectionCalls)).toHaveLength(1);
  });

  it('problemer: ikke indekseret, noindex, canonical-uenighed, fetch-fejl og gammel crawl', () => {
    const base = { ...PASS, inspectedAt: NOW, lastCrawlTime: new Date('2026-11-08T03:00:00Z') };
    expect(inspectionProblems(base, true, NOW)).toEqual([]);
    const codes = (row: Partial<typeof base>, shouldIndex = true) => inspectionProblems({ ...base, ...row }, shouldIndex, NOW).map((p) => p.code);
    expect(codes({ verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed', pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED' })).toEqual(['not_indexed']);
    expect(codes({ verdict: 'FAIL', indexingState: 'BLOCKED_BY_META_TAG' })).toEqual(['not_indexed', 'noindex']);
    expect(codes({ verdict: 'NEUTRAL', indexingState: 'BLOCKED_BY_META_TAG' }, false)).toEqual([]);
    expect(codes({ googleCanonical: 'https://tilbudsradar.test/a', userCanonical: 'https://tilbudsradar.test/b' })).toEqual(['canonical_mismatch']);
    expect(codes({ verdict: 'FAIL', pageFetchState: 'SOFT_404' })).toEqual(['not_indexed', 'fetch_error']);
    expect(codes({ lastCrawlTime: new Date('2026-09-20T00:00:00Z') })).toEqual(['stale_crawl']);
    // Ikke inspiceret endnu: ingen problemer.
    expect(inspectionProblems({ ...base, inspectedAt: null }, true, NOW)).toEqual([]);
  });
});

describe('kvote', () => {
  it('pr. minut: venter, til det ældste kald i minuttet er udløbet', async () => {
    let clock = 0;
    const waits: number[] = [];
    const q = new QuotaLimiter([], {
      perMinute: 3,
      perDay: 100,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    for (let i = 0; i < 3; i++) {
      expect(await q.acquire()).toBe(true);
      clock += 1000;
    }
    expect(waits).toEqual([]);
    expect(await q.acquire()).toBe(true);
    expect(waits).toEqual([57_000]);
  });

  it('pr. døgn: stopper, når kvoten er brugt – også med kald fra tidligere kørsler', async () => {
    const now = 10 * 86_400_000;
    const previous = [now - 23 * 3_600_000, now - 3_600_000, now - 25 * 3_600_000];
    const q = new QuotaLimiter(previous, { perMinute: 100, perDay: 3, now: () => now, sleep: async () => undefined });
    expect(q.remainingToday()).toBe(1);
    expect(await q.acquire()).toBe(true);
    expect(await q.acquire()).toBe(false);
  });
});
