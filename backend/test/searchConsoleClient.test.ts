import { describe, expect, it } from 'vitest';
import { createGscClient, GscApiError, redactSecrets, ROW_LIMIT } from '../src/services/searchConsole/client';
import { parseGscConfig } from '../src/services/searchConsole/config';

/** Search Console: opsætning og API-klient. Ingen rigtige kald – fetch er en mock. */

const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7testnoegle\n-----END PRIVATE KEY-----\n';
const serviceAccount = { type: 'service_account', client_email: 'gsc@tilbudsradar-test.iam.gserviceaccount.com', private_key: KEY };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

describe('opsætning', () => {
  it('slået fra uden miljøvariabler', () => {
    const c = parseGscConfig({ serviceAccountJson: null, siteUrl: null });
    expect(c.enabled).toBe(false);
  });

  it('gyldig base64-nøgle og domæne-ejendom', () => {
    const c = parseGscConfig({ serviceAccountJson: b64(serviceAccount), siteUrl: 'sc-domain:tilbudsradaren.dk' });
    expect(c).toMatchObject({ enabled: true, clientEmail: serviceAccount.client_email, siteUrl: 'sc-domain:tilbudsradaren.dk' });
  });

  it('URL-præfiks skal slutte med /', () => {
    expect(parseGscConfig({ serviceAccountJson: b64(serviceAccount), siteUrl: 'https://tilbudsradaren.dk/' }).enabled).toBe(true);
    const c = parseGscConfig({ serviceAccountJson: b64(serviceAccount), siteUrl: 'https://tilbudsradaren.dk' });
    expect(c.enabled).toBe(false);
  });

  it('ugyldig nøgle giver en grund – uden selve nøglen', () => {
    const broken = parseGscConfig({ serviceAccountJson: 'ikke-base64-json', siteUrl: 'sc-domain:tilbudsradaren.dk' });
    expect(broken.enabled).toBe(false);
    if (!broken.enabled) expect(broken.reason).toMatch(/kan ikke læses/);

    const noKey = parseGscConfig({ serviceAccountJson: b64({ ...serviceAccount, private_key: undefined }), siteUrl: 'sc-domain:tilbudsradaren.dk' });
    expect(noKey.enabled).toBe(false);
    if (!noKey.enabled) {
      expect(noKey.reason).toMatch(/private_key/);
      expect(JSON.stringify(noKey)).not.toContain('PRIVATE KEY-----');
    }

    const wrongType = parseGscConfig({ serviceAccountJson: b64({ ...serviceAccount, type: 'authorized_user' }), siteUrl: 'sc-domain:tilbudsradaren.dk' });
    expect(wrongType.enabled).toBe(false);
    expect(JSON.stringify(wrongType)).not.toContain(KEY.slice(30, 60));
  });
});

/* ------------------------------------------------------------------ */

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('Uventet kald');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ keys: ['2026-11-01', `søgeord ${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 4.2 }));

function client(responses: (Response | Error)[]) {
  const mock = mockFetch(responses);
  const sleeps: number[] = [];
  const c = createGscClient({
    siteUrl: 'sc-domain:tilbudsradaren.dk',
    getToken: async () => 'ya29.testtoken',
    fetchImpl: mock.fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { c, calls: mock.calls, sleeps };
}

describe('søgeresultater', () => {
  it('paginerer med startRow, indtil en side har færre end 25.000 rækker', async () => {
    const { c, calls } = client([json({ rows: rows(ROW_LIMIT) }), json({ rows: rows(3) })]);
    const result = await c.searchAnalytics({ startDate: '2026-10-01', endDate: '2026-11-01', dimensions: ['date', 'query'], type: 'web' });
    expect(result).toHaveLength(ROW_LIMIT + 3);
    expect(calls).toHaveLength(2);
    const bodies = calls.map((x) => JSON.parse(String(x.init.body)) as Record<string, unknown>);
    expect(bodies.map((b) => b.startRow)).toEqual([0, ROW_LIMIT]);
    expect(bodies[0]).toMatchObject({ rowLimit: ROW_LIMIT, dataState: 'final', type: 'web', dimensions: ['date', 'query'] });
    expect(calls[0]!.url).toBe('https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Atilbudsradaren.dk/searchAnalytics/query');
  });

  it('sender adgangstokenet og filtrerer på Danmark', async () => {
    const { c, calls } = client([json({})]);
    expect(await c.searchAnalytics({ startDate: '2026-11-01', endDate: '2026-11-01', dimensions: ['date'], type: 'web', country: 'dnk', dataState: 'all' })).toEqual([]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.testtoken');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      dataState: 'all',
      dimensionFilterGroups: [{ filters: [{ dimension: 'country', operator: 'equals', expression: 'dnk' }] }],
    });
  });

  it('prøver igen ved 429 og 5xx – og respekterer Retry-After', async () => {
    const { c, calls, sleeps } = client([json({}, 429, { 'Retry-After': '2' }), json({}, 503), json({ rows: rows(1) })]);
    expect(await c.searchAnalytics({ startDate: '2026-11-01', endDate: '2026-11-01', dimensions: ['date'], type: 'web' })).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('fejl fra Google bliver en renset GscApiError uden token', async () => {
    const { c } = client([json({ error: { code: 403, message: 'User does not have sufficient permission for site sc-domain:tilbudsradaren.dk.' } }, 403)]);
    const err = await c.searchAnalytics({ startDate: '2026-11-01', endDate: '2026-11-01', dimensions: ['date'], type: 'web' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GscApiError);
    expect((err as GscApiError).status).toBe(403);
    expect((err as GscApiError).message).toMatch(/403: User does not have sufficient permission/);
    expect((err as GscApiError).message).not.toContain('ya29');
  });
});

describe('URL-inspektion og sitemaps', () => {
  it('læser indekseringsstatus', async () => {
    const { c, calls } = client([
      json({
        inspectionResult: {
          indexStatusResult: {
            verdict: 'PASS',
            coverageState: 'Submitted and indexed',
            robotsTxtState: 'ALLOWED',
            indexingState: 'INDEXING_ALLOWED',
            pageFetchState: 'SUCCESSFUL',
            lastCrawlTime: '2026-11-01T08:00:00Z',
            googleCanonical: 'https://tilbudsradaren.dk/tilbud/smoer',
            userCanonical: 'https://tilbudsradaren.dk/tilbud/smoer',
            crawledAs: 'MOBILE',
          },
        },
      }),
    ]);
    const r = await c.inspectUrl('https://tilbudsradaren.dk/tilbud/smoer');
    expect(r).toMatchObject({ verdict: 'PASS', coverageState: 'Submitted and indexed', crawledAs: 'MOBILE', lastCrawlTime: '2026-11-01T08:00:00Z' });
    expect(calls[0]!.url).toBe('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ inspectionUrl: 'https://tilbudsradaren.dk/tilbud/smoer', siteUrl: 'sc-domain:tilbudsradaren.dk' });
  });

  it('læser sitemaps – tal kommer som tekst', async () => {
    const { c } = client([
      json({
        sitemap: [
          {
            path: 'https://tilbudsradaren.dk/sitemap.xml',
            lastSubmitted: '2026-11-02T10:00:00Z',
            lastDownloaded: '2026-11-02T10:05:00Z',
            isPending: false,
            isSitemapsIndex: true,
            warnings: '0',
            errors: '1',
            contents: [{ type: 'web', submitted: '123', indexed: '0' }],
          },
        ],
      }),
    ]);
    expect(await c.listSitemaps()).toEqual([
      {
        path: 'https://tilbudsradaren.dk/sitemap.xml',
        lastSubmitted: '2026-11-02T10:00:00Z',
        lastDownloaded: '2026-11-02T10:05:00Z',
        isPending: false,
        isSitemapsIndex: true,
        errors: 1,
        warnings: 0,
        submitted: 123,
      },
    ]);
  });

  it('fjerner nøgler og tokens fra fejltekster', () => {
    const text = redactSecrets(`invalid_grant ${KEY} token ya29.a0AfH6SMBabcdefghijklmnop`);
    expect(text).not.toContain('MIIEvQ');
    expect(text).not.toContain('ya29.a0AfH6');
    expect(text).toContain('invalid_grant');
  });
});
