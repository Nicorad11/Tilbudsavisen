import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { gscMetrics, gscUrlInspections } from '../src/db/schema';
import { addDays } from '../src/services/searchConsole/sync';
import type { UncoveredConcept } from '../src/services/seo/candidates';
import {
  bucketOf,
  cannibalization,
  deadPages,
  lowCtr,
  median,
  missingPages,
  nearPageOne,
  opportunitiesForSite,
  pageType,
  sumMetrics,
  trend,
  type PageMetric,
} from '../src/services/seo/opportunities';
import { parsePage, type PageInfo } from '../src/services/seo/siteSnapshot';

/** Search Console-analysen (4.1–4.6) med fixtures. */

const SITE = 'https://tilbudsradar.test';
const url = (path: string) => `${SITE}${path}`;
const page = (path: string, impressions: number, clicks: number, position: number): PageMetric => ({ page: url(path), impressions, clicks, position });
const info = (path: string, o: Partial<PageInfo> = {}): PageInfo => ({
  path,
  status: 200,
  title: `Titel for ${path}`,
  description: `Beskrivelse af ${path}`,
  robots: null,
  canonical: url(path),
  mainLinks: [],
  siteLinks: [],
  ...o,
});

describe('hjælpere', () => {
  it('median, placeringsintervaller, sidetyper og vægtet placering', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect([1, 3.4, 3.6, 6.4, 6.6, 10.4, 10.6].map(bucketOf)).toEqual(['1–3', '1–3', '4–6', '4–6', '7–10', '7–10', null]);
    expect(['/', '/tilbud/smoer', '/tilbud', '/butik/netto', '/kategori/mejeri-aeg', '/metode'].map(pageType)).toEqual(['forside', 'vare', 'øvrige', 'kæde', 'kategori', 'øvrige']);
    const s = sumMetrics([
      { clicks: 10, impressions: 100, position: 2 },
      { clicks: 0, impressions: 300, position: 10 },
    ]);
    expect(s).toEqual({ clicks: 10, impressions: 400, ctr: 0.025, position: 8 });
  });

  it('læser titel, beskrivelse og links ud af den server-renderede side', () => {
    const html = `<html><head><title>Smør &amp; ost | Tilbudsradar</title><meta name="description" content="Billigst pr. kg" />
      <meta name="robots" content="max-image-preview:large" /><link rel="canonical" href="${SITE}/tilbud/smoer" /></head>
      <body><header><a href="/tilbud">Tilbud</a></header><main><a href="/tilbud/ost?x=1">Ost</a><a href="${SITE}/butik/netto/">Netto</a>
      <a href="https://example.com/">Ude</a></main><footer><a href="/metode">Metode</a><a href="/tilbud">Tilbud</a></footer></body></html>`;
    expect(parsePage('/tilbud/smoer', 200, html, SITE)).toEqual({
      path: '/tilbud/smoer',
      status: 200,
      title: 'Smør & ost | Tilbudsradar',
      description: 'Billigst pr. kg',
      robots: 'max-image-preview:large',
      canonical: `${SITE}/tilbud/smoer`,
      mainLinks: ['/tilbud/ost', '/butik/netto'],
      siteLinks: ['/tilbud', '/metode'],
    });
  });
});

describe('4.1 lav klikrate', () => {
  it('under 60 % af vores egen median for samme placering – med nuværende titel', () => {
    const items = [
      { ...page('/a', 200, 60, 2), kind: 'page' as const, key: url('/a') },
      { ...page('/b', 200, 56, 2.5), kind: 'page' as const, key: url('/b') },
      { ...page('/c', 200, 64, 1.5), kind: 'page' as const, key: url('/c') },
      { ...page('/svag', 200, 10, 2), kind: 'page' as const, key: url('/svag') },
      // For få visninger og for dårlig placering tæller ikke.
      { ...page('/lille', 20, 0, 2), kind: 'page' as const, key: url('/lille') },
      { ...page('/langt-nede', 500, 0, 15), kind: 'page' as const, key: url('/langt-nede') },
    ];
    const result = lowCtr(items, (p) => (p === url('/svag') ? info('/svag') : undefined));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: url('/svag'), bucket: '1–3', ctr: 0.05, title: 'Titel for /svag', description: 'Beskrivelse af /svag' });
    expect(result[0]!.medianCtr).toBeCloseTo(0.29);
  });

  it('ingen median – og ingen forslag – med for få sider i intervallet', () => {
    const items = [
      { ...page('/a', 200, 60, 2), kind: 'page' as const, key: url('/a') },
      { ...page('/svag', 200, 1, 2), kind: 'page' as const, key: url('/svag') },
    ];
    expect(lowCtr(items, () => undefined)).toEqual([]);
  });
});

describe('4.2 tæt på side 1', () => {
  it('placering 8–20 med de søgeord og sider, der allerede linker hertil', () => {
    const snapshot = new Map([
      ['/tilbud', info('/tilbud', { mainLinks: ['/tilbud/smoer', '/tilbud/ost'] })],
      ['/butik/netto', info('/butik/netto', { mainLinks: ['/tilbud/smoer'], siteLinks: ['/tilbud/ost'] })],
      ['/tilbud/smoer', info('/tilbud/smoer', { mainLinks: ['/tilbud/smoer'] })],
    ]);
    const result = nearPageOne(
      [page('/tilbud/smoer', 120, 2, 12), page('/tilbud/ost', 80, 1, 9), page('/top', 500, 50, 3), page('/lidt', 10, 0, 12)],
      [
        { query: 'smør tilbud', page: url('/tilbud/smoer'), impressions: 80, clicks: 1, position: 11 },
        { query: 'billigt smør', page: url('/tilbud/smoer'), impressions: 40, clicks: 1, position: 13 },
      ],
      snapshot,
    );
    expect(result.map((r) => r.page)).toEqual([url('/tilbud/smoer'), url('/tilbud/ost')]);
    expect(result[0]).toMatchObject({ topQueries: ['smør tilbud', 'billigt smør'], linkedFrom: ['/butik/netto', '/tilbud'], inFooter: false });
    expect(result[1]).toMatchObject({ linkedFrom: ['/tilbud'], inFooter: true });
  });
});

describe('4.3 manglende sider', () => {
  const concepts: UncoveredConcept[] = [
    { key: 'rodkal', label: 'rødkål', offers: 5, stores: 2, category: 'frugt-gront' },
    { key: 'flaeskesvaer', label: 'flæskesvær', offers: 2, stores: 1, category: 'snacks' },
  ];
  it('søgeord om en varetype med tilbud, men uden side – klar til whitelisten', () => {
    const result = missingPages(
      [
        { query: 'rødkål tilbud', impressions: 30, clicks: 1, position: 14 },
        { query: 'rødkål netto', impressions: 10, clicks: 0, position: 20 },
        { query: 'flæskesvær tilbud', impressions: 50, clicks: 0, position: 9 },
        { query: 'smør tilbud', impressions: 200, clicks: 5, position: 6 },
        { query: 'rødkål', impressions: 2, clicks: 0, position: 30 },
      ],
      concepts,
      (q) => q.includes('smør'),
    );
    expect(result).toEqual([
      { query: 'rødkål tilbud', impressions: 40, clicks: 1, label: 'rødkål', category: 'frugt-gront', offers: 5, stores: 2, line: "['Rødkål', ['rødkål'], ['frugt-gront']]," },
    ]);
  });
});

describe('4.4 kannibalisering', () => {
  it('samme søgeord på flere af vores sider', () => {
    const result = cannibalization([
      { query: 'smør', page: url('/tilbud/smoer'), impressions: 60, clicks: 3, position: 5 },
      { query: 'smør', page: url('/kategori/mejeri-aeg'), impressions: 30, clicks: 0, position: 9 },
      { query: 'smør', page: url('/'), impressions: 2, clicks: 0, position: 30 },
      { query: 'ost', page: url('/tilbud/ost'), impressions: 100, clicks: 4, position: 4 },
      { query: 'kaffe', page: url('/tilbud/kaffe'), impressions: 8, clicks: 0, position: 12 },
      { query: 'kaffe', page: url('/'), impressions: 8, clicks: 0, position: 15 },
    ]);
    expect(result).toEqual([
      {
        query: 'smør',
        impressions: 92,
        pages: [
          { page: url('/tilbud/smoer'), impressions: 60, clicks: 3, position: 5 },
          { page: url('/kategori/mejeri-aeg'), impressions: 30, clicks: 0, position: 9 },
        ],
      },
    ]);
  });
});

describe('4.5 døde sider', () => {
  it('0 visninger efter 28 dage i sitemapet – og sider, der ikke er indekseret', () => {
    const now = new Date('2026-12-15T12:00:00Z');
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const result = deadPages({
      paths: ['/a', '/b', '/c', '/d'],
      firstSeen: new Map([
        ['/a', daysAgo(40)],
        ['/b', daysAgo(10)],
        ['/c', daysAgo(40)],
        ['/d', daysAgo(40)],
      ]),
      impressions: new Map([['/c', 5]]),
      notIndexed: new Map([['/d', 'Ikke indekseret: Crawled - currently not indexed']]),
      now,
    });
    expect(result).toEqual([
      { path: '/a', reason: 'no_impressions', detail: 'Ingen visninger de sidste 28 dage' },
      { path: '/d', reason: 'not_indexed', detail: 'Ikke indekseret: Crawled - currently not indexed' },
    ]);
  });
});

describe('4.6 trend', () => {
  it('total og pr. sidetype mod perioden før', () => {
    const t = trend(
      { clicks: 20, impressions: 1000, ctr: 0.02, position: 9 },
      { clicks: 10, impressions: 800, ctr: 0.0125, position: 11 },
      [page('/tilbud/smoer', 300, 9, 6), page('/tilbud/ost', 100, 1, 10), page('/butik/netto', 50, 0, 20)],
      [page('/tilbud/smoer', 200, 4, 8)],
    );
    expect(t.total.current.clicks).toBe(20);
    const vare = t.byType.find((r) => r.label === 'Varesider')!;
    expect(vare.current).toEqual({ clicks: 10, impressions: 400, ctr: 0.025, position: 7 });
    expect(vare.previous.impressions).toBe(200);
    expect(t.byType.find((r) => r.label === 'Kædesider')!.current.impressions).toBe(50);
  });
});

describe('analysen for hele sitet', () => {
  let database: Database;
  beforeAll(async () => {
    database = await createDatabase({ url: null, dataDir: 'memory://' });
    await database.migrate();
  });
  afterAll(async () => {
    await database?.close();
  });

  it('ingen data: tom analyse uden fejl', async () => {
    const r = await opportunitiesForSite(database.db, { appUrl: SITE, snapshot: null });
    expect(r).toMatchObject({ period: null, trend: null, lowCtr: [], snapshotAvailable: false });
  });

  it('de seneste 28 dage med endelige tal mod de 28 før', async () => {
    const latest = '2026-12-10';
    const rows = [];
    for (let i = 0; i < 56; i++) {
      const date = addDays(latest, -i);
      const current = i < 28;
      const base = { date, searchType: 'web', country: 'all', ctr: 0, position: current ? 8 : 12 };
      rows.push({ ...base, kind: 'total', clicks: current ? 2 : 1, impressions: 100 });
      rows.push({ ...base, kind: 'page_device', page: url('/tilbud/smoer'), device: 'MOBILE', clicks: current ? 2 : 1, impressions: 100 });
      rows.push({ ...base, kind: 'query_page', query: 'smør tilbud', page: url('/tilbud/smoer'), clicks: current ? 2 : 1, impressions: 100 });
    }
    await database.db.insert(gscMetrics).values(rows);
    await database.db.insert(gscUrlInspections).values({ url: url('/'), firstSeenAt: new Date('2026-10-01T00:00:00Z'), inSitemap: true });

    const r = await opportunitiesForSite(database.db, { appUrl: SITE, snapshot: null, now: new Date('2026-12-12T08:00:00Z') });
    expect(r.period).toEqual({ start: '2026-11-13', end: '2026-12-10', previousStart: '2026-10-16', previousEnd: '2026-11-12' });
    expect(r.trend!.total.current).toMatchObject({ clicks: 56, impressions: 2800, position: 8 });
    expect(r.trend!.total.previous).toMatchObject({ clicks: 28, impressions: 2800, position: 12 });
    expect(r.trend!.byType.find((x) => x.label === 'Varesider')!.current.impressions).toBe(2800);
    // Forsiden har været i sitemapet længe uden visninger.
    expect(r.deadPages).toContainEqual({ path: '/', reason: 'no_impressions', detail: 'Ingen visninger de sidste 28 dage' });
  });
});
