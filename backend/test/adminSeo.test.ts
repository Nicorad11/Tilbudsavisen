import type { AuthResponse, GscIndexingDTO, GscOpportunitiesDTO, GscOverviewDTO, GscSitemapsDTO } from '@tilbudsradar/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Rigtig administrator via ADMIN_EMAILS – skal sættes før env indlæses.
process.env.ADMIN_EMAILS = 'chef@tilbudsradar.test';

const { createDatabase } = await import('../src/db/client');
const { createApp } = await import('../src/http/app');
const { ScrapeManager } = await import('../src/services/scrapeJobs');
const { createSearchConsoleService } = await import('../src/services/searchConsole/service');
const { addDays, isoDay } = await import('../src/services/searchConsole/sync');
const { silentLogger } = await import('@tilbudsradar/scrapers');
type GscClient = import('../src/services/searchConsole/client').GscClient;

/** Admin "SEO": adgang, "ikke sat op" og data fra en falsk Search Console. */

let database: Awaited<ReturnType<typeof createDatabase>>;
let plain: ReturnType<typeof createApp>;
let withGsc: ReturnType<typeof createApp>;
let admin: { Authorization: string };
let kunde: { Authorization: string };

const today = isoDay(new Date());
const fake: GscClient = {
  async searchAnalytics(req) {
    const rows = [];
    for (let d = addDays(today, -9); d <= req.endDate && d <= today; d = addDays(d, 1)) {
      if (d < req.startDate) continue;
      const keys = req.dimensions.map((dim) =>
        dim === 'date' ? d : dim === 'query' ? 'smør tilbud' : dim === 'page' ? 'https://tilbudsradar.test/tilbud/smoer' : dim === 'device' ? 'MOBILE' : 'dnk',
      );
      rows.push({ keys, clicks: 3, impressions: 60, ctr: 0.05, position: 7.5 });
    }
    return rows;
  },
  async inspectUrl() {
    return {
      verdict: 'NEUTRAL',
      coverageState: 'Discovered - currently not indexed',
      robotsTxtState: 'ALLOWED',
      indexingState: 'INDEXING_ALLOWED',
      pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED',
      lastCrawlTime: null,
      googleCanonical: null,
      userCanonical: null,
      crawledAs: null,
    };
  },
  async listSitemaps() {
    return [{ path: 'https://tilbudsradar.test/sitemap.xml', lastSubmitted: null, lastDownloaded: null, isPending: false, isSitemapsIndex: true, errors: 0, warnings: 0, submitted: 12 }];
  },
};

async function register(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hemmelig123', acceptTerms: true }).expect(201);
  return { Authorization: `Bearer ${(res.body as AuthResponse).accessToken}` };
}

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  plain = createApp({ db: database.db, scrape, stripe: null });
  const searchConsole = createSearchConsoleService(database.db, {
    config: { enabled: true, clientEmail: 'gsc@test.iam.gserviceaccount.com', privateKey: 'x', siteUrl: 'sc-domain:tilbudsradar.test' },
    client: fake,
    log: silentLogger,
    appUrl: 'https://tilbudsradar.test',
  });
  withGsc = createApp({ db: database.db, scrape, stripe: null, searchConsole });
  admin = await register(plain, 'chef@tilbudsradar.test');
  kunde = await register(plain, 'kunde@example.dk');
});

afterAll(async () => {
  await database?.close();
});

describe('adgang', () => {
  it('kræver en administrator', async () => {
    await request(plain).get('/api/admin/seo/overview').expect(401);
    await request(plain).get('/api/admin/seo/overview').set(kunde).expect(403);
    await request(plain).post('/api/admin/seo/sync').set(kunde).expect(403);
  });
});

describe('ikke sat op', () => {
  it('GET svarer pænt med opsætningsstatus – handlingerne svarer 409', async () => {
    const res = await request(plain).get('/api/admin/seo/overview').set(admin).expect(200);
    const body = res.body as GscOverviewDTO;
    expect(body.setup).toEqual({ configured: false, reason: 'GSC_SERVICE_ACCOUNT_JSON og GSC_SITE_URL er ikke sat.', clientEmail: null, siteUrl: null });
    expect(body).toMatchObject({ period: null, current: null, lastRun: null });
    expect(((await request(plain).get('/api/admin/seo/indexing').set(admin).expect(200)).body as GscIndexingDTO).setup.configured).toBe(false);
    expect(((await request(plain).get('/api/admin/seo/opportunities').set(admin).expect(200)).body as GscOpportunitiesDTO).period).toBeNull();
    const sync = await request(plain).post('/api/admin/seo/sync').set(admin).expect(409);
    expect(sync.body.error).toMatch(/ikke sat op/);
    await request(plain).post('/api/admin/seo/inspect').set(admin).send({ url: '/tilbud/smoer' }).expect(409);
  });

  it('ugyldige filtre afvises', async () => {
    await request(plain).get('/api/admin/seo/overview?days=30').set(admin).expect(400);
    await request(plain).get('/api/admin/seo/overview?country=swe').set(admin).expect(400);
  });
});

describe('med Search Console', () => {
  it('"Hent data nu" henter data i baggrunden, og siden viser KPI\'er, sider og søgeord', async () => {
    await request(withGsc).post('/api/admin/seo/sync').set(admin).expect(202);
    for (let i = 0; i < 100; i++) {
      const s = await request(withGsc).get('/api/admin/seo/status').set(admin);
      if (!s.body.running && s.body.lastRun) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const status = (await request(withGsc).get('/api/admin/seo/status').set(admin).expect(200)).body as { lastRun: { status: string; trigger: string } };
    expect(status.lastRun).toMatchObject({ status: 'success', trigger: 'manual' });

    const o = (await request(withGsc).get('/api/admin/seo/overview?days=7&country=dnk').set(admin).expect(200)).body as GscOverviewDTO;
    expect(o.setup.configured).toBe(true);
    expect(o.period?.end).toBe(today);
    expect(o.byDay).toHaveLength(7);
    expect(o.current).toMatchObject({ clicks: 21, impressions: 420 });
    expect(o.topQueries[0]).toMatchObject({ query: 'smør tilbud', page: 'https://tilbudsradar.test/tilbud/smoer' });
    expect(o.topPages[0]?.page).toBe('https://tilbudsradar.test/tilbud/smoer');
    expect(o.images.length).toBeGreaterThan(0);

    const mobile = (await request(withGsc).get('/api/admin/seo/overview?days=7&device=MOBILE').set(admin).expect(200)).body as GscOverviewDTO;
    expect(mobile.current?.clicks).toBe(21);
    const desktop = (await request(withGsc).get('/api/admin/seo/overview?days=7&device=DESKTOP').set(admin).expect(200)).body as GscOverviewDTO;
    expect(desktop.current?.clicks).toBe(0);

    const sitemaps = (await request(withGsc).get('/api/admin/seo/sitemaps').set(admin).expect(200)).body as GscSitemapsDTO;
    expect(sitemaps.rows).toEqual([expect.objectContaining({ path: 'https://tilbudsradar.test/sitemap.xml', submitted: 12 })]);

    const ix = (await request(withGsc).get('/api/admin/seo/indexing').set(admin).expect(200)).body as GscIndexingDTO;
    expect(ix.counts.inspected).toBeGreaterThan(0);
    expect(ix.rows[0]!.problems.map((p) => p.code)).toEqual(['not_indexed']);
    expect(ix.quota.usedToday).toBe(ix.counts.inspected);

    const opp = (await request(withGsc).get('/api/admin/seo/opportunities').set(admin).expect(200)).body as GscOpportunitiesDTO;
    expect(opp.period?.end).toBe(today);
    expect(opp.trend?.total.current.clicks).toBe(30);
  });

  it('"Inspicér URL": kun vores egne sider', async () => {
    await request(withGsc).post('/api/admin/seo/inspect').set(admin).send({ url: 'https://example.com/' }).expect(400);
    const res = await request(withGsc).post('/api/admin/seo/inspect').set(admin).send({ url: '/tilbud/smoer' }).expect(200);
    expect(res.body).toMatchObject({ url: 'https://tilbudsradar.test/tilbud/smoer', path: '/tilbud/smoer', verdict: 'NEUTRAL' });
  });
});
