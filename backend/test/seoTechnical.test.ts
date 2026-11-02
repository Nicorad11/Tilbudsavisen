import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { silentLogger } from '@tilbudsradar/scrapers';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Skal sættes, før env indlæses.
process.env.INDEXNOW_KEY = 'testnoegle-1234567890';
process.env.GOOGLE_SITE_VERIFICATION = 'google-abc123';
process.env.BING_SITE_VERIFICATION = 'bing-def456';

const { TERMS_VERSION } = await import('@tilbudsradar/shared');
const { createDatabase } = await import('../src/db/client');
const { offers, scrapeRuns } = await import('../src/db/schema');
const { createApp } = await import('../src/http/app');
const { configTag, mountSite, publicConfig } = await import('../src/http/site');
const { createSsr } = await import('../src/http/ssr');
const { ScrapeManager } = await import('../src/services/scrapeJobs');
const { createIndexNowNotifier, submitIndexNow } = await import('../src/services/seo/indexNow');

const DAY = 86_400_000;
let database: Awaited<ReturnType<typeof createDatabase>>;
let app: express.Express;
let seq = 0;

async function offer(o: { store: string; title: string; category: string; price: number; unitPrice?: number; from: number; to: number; seen: string }) {
  const now = Date.now();
  await database.db.insert(offers).values({
    storeId: o.store,
    sourceId: o.store,
    externalId: `tech-${++seq}`,
    title: o.title,
    normalizedName: o.title.toLowerCase(),
    category: o.category,
    offerPrice: o.price,
    unit: 'kg',
    unitPrice: o.unitPrice ?? null,
    validFrom: new Date(now + o.from * DAY),
    validTo: new Date(now + o.to * DAY),
    sourceUrl: 'https://example.dk',
    firstSeenAt: new Date(o.seen),
  });
}

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape, stripe: null });
  // Seneste hentning – siderne viser den som "opdateret" og bruger den som dateModified.
  await database.db.insert(scrapeRuns).values({ sourceId: 'netto', status: 'success', finishedAt: new Date('2026-11-01T08:00:00Z') });
  await offer({ store: 'netto', title: 'Lurpak smør', category: 'mejeri', price: 21.95, unitPrice: 87.8, from: -1, to: 5, seen: '2026-10-30T07:00:00Z' });
  await offer({ store: 'rema1000', title: 'Kærgården', category: 'mejeri', price: 17.5, unitPrice: 70, from: -1, to: 5, seen: '2026-11-01T07:00:00Z' });
  await offer({ store: 'lidl', title: 'MILBONA smør', category: 'mejeri', price: 9.95, unitPrice: 44.22, from: -2, to: 4, seen: '2026-10-28T07:00:00Z' });
  await offer({ store: 'lidl', title: 'Citroner', category: 'frugt-gront', price: 4, from: -20, to: -14, seen: '2026-10-10T07:00:00Z' });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

const urls = (xml: string) => [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((m) => ({ loc: m[1]!, lastmod: m[2]! }));

describe('robots.txt', () => {
  it('én gruppe for alle crawlere – ingen bot-specifikke grupper – og sitemap-indekset', async () => {
    const text = (await request(app).get('/robots.txt').expect(200)).text;
    expect(text.match(/^User-agent:/gm)).toEqual(['User-agent:']);
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Sitemap: https://tilbudsradar.test/sitemap.xml');
  });
});

describe('sitemaps', () => {
  it('sitemap.xml er et indeks over sitemaps med indhold', async () => {
    const xml = (await request(app).get('/sitemap.xml').expect(200)).text;
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex')).toBe(true);
    expect(xml).toContain('<loc>https://tilbudsradar.test/sitemap-pages.xml</loc>');
    expect(xml).toContain('<loc>https://tilbudsradar.test/sitemap-tilbud.xml</loc>');
    expect(xml.match(/<sitemap>/g)?.length).toBe(xml.match(/<\/sitemap>/g)?.length);
  });

  it('varer: kun indekserbare sider, med lastmod = nyeste "første gang set" blandt sidens tilbud', async () => {
    const res = await request(app).get('/sitemap-tilbud.xml').expect(200);
    expect(res.type).toBe('application/xml');
    const list = urls(res.text);
    expect(list).toEqual([{ loc: 'https://tilbudsradar.test/tilbud/smoer', lastmod: '2026-11-01' }]);
    expect(res.text).not.toContain('/tilbud/citroner');
  });

  it('faste sider: ingen /app, rigtige datoer', async () => {
    const list = urls((await request(app).get('/sitemap-pages.xml').expect(200)).text);
    const locs = list.map((u) => u.loc);
    expect(locs).toContain('https://tilbudsradar.test/');
    expect(locs).toContain('https://tilbudsradar.test/tilbud');
    expect(locs).toContain('https://tilbudsradar.test/metode');
    expect(locs.some((l) => l.includes('/app'))).toBe(false);
    expect(list.find((u) => u.loc.endsWith('/handelsbetingelser'))?.lastmod).toBe(TERMS_VERSION);
    for (const u of list) expect(u.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await request(app).get('/sitemap-findes-ikke.xml').expect(404);
  });
});

describe('kanoniske adresser', () => {
  it('afsluttende skråstreg og store bogstaver → 301 til den kanoniske sti med samme query', async () => {
    expect((await request(app).get('/Tilbud/Smoer').expect(301)).headers.location).toBe('/tilbud/smoer');
    expect((await request(app).get('/priser/').expect(301)).headers.location).toBe('/priser');
    expect((await request(app).get('/PRISER/?ref=ig&x=1').expect(301)).headers.location).toBe('/priser?ref=ig&x=1');
  });

  it('filer, /api og procent-kodede tegn røres ikke', async () => {
    expect((await request(app).get('/assets/Index-ABC.js')).status).not.toBe(301);
    expect((await request(app).get('/api/Stats')).status).not.toBe(301);
    expect((await request(app).get('/tilbud/sm%C3%B8r')).status).not.toBe(301);
  });

  it('API-svar har X-Robots-Tag: noindex', async () => {
    const res = await request(app).get('/api/stats').expect(200);
    expect(res.headers['x-robots-tag']).toBe('noindex');
  });
});

describe('strukturerede data (JSON-LD)', () => {
  const TEMPLATE = '<!doctype html><html><head><!--seo--><!--/seo--></head><body><div id="root"></div></body></html>';
  let render: (url: string) => Promise<{ status: number; html: string }>;
  beforeAll(async () => {
    (globalThis as { __TR_CONFIG__?: unknown }).__TR_CONFIG__ = publicConfig();
    const entry = path.resolve(import.meta.dirname, '../../frontend/src/entry-server.tsx');
    const module = await import(/* @vite-ignore */ entry);
    const ssr = createSsr({ db: database.db, module, template: TEMPLATE, configTag: configTag() });
    render = (url) => ssr.render(url);
  }, 120_000);

  const jsonLd = (html: string) =>
    [...html.matchAll(/<script type="application\/ld\+json" data-tr-jsonld>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);

  it('varesiden: BreadcrumbList, WebPage med dateModified og ItemList af produkter med pris i DKK', async () => {
    const { html } = await render('/tilbud/smoer');
    const data = jsonLd(html);
    expect(data.map((d) => d['@type'])).toEqual(['BreadcrumbList', 'WebPage', 'ItemList']);
    const crumbs = data[0]!.itemListElement as { name: string; item: string }[];
    expect(crumbs.map((c) => c.name)).toEqual(['Forside', 'Tilbud', 'Smør']);
    expect(crumbs[2]!.item).toBe('https://tilbudsradar.test/tilbud/smoer');
    expect(data[1]).toMatchObject({ '@type': 'WebPage', dateModified: '2026-11-01T08:00:00.000Z', inLanguage: 'da-DK' });
    const items = data[2]!.itemListElement as { item: { '@type': string; name: string; offers: Record<string, unknown> } }[];
    expect(items[0]!.item['@type']).toBe('Product');
    expect(items[0]!.item.offers).toMatchObject({ '@type': 'Offer', price: '9.95', priceCurrency: 'DKK', seller: { '@type': 'Organization', name: 'Lidl' } });
    expect(items[0]!.item.offers.priceValidUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(html).not.toContain('AggregateRating');
    expect(html).not.toContain('"Review"');
    // Delingsbilledet er sidens eget.
    expect(html).toContain('<meta property="og:image" content="https://tilbudsradar.test/og/tilbud/smoer.png" />');
  });

  it('forsiden: Organization og WebSite – ingen SearchAction', async () => {
    const data = jsonLd((await render('/')).html);
    expect(data.map((d) => d['@type'])).toEqual(['Organization', 'WebSite']);
    expect(data[1]).toMatchObject({ inLanguage: 'da-DK', url: 'https://tilbudsradar.test/' });
    expect(JSON.stringify(data)).not.toContain('SearchAction');
  });

  it('faste undersider får en brødkrumme', async () => {
    const data = jsonLd((await render('/priser')).html);
    expect(data.map((d) => d['@type'])).toEqual(['BreadcrumbList']);
  });
});

describe('IndexNow', () => {
  const okFetch = () => vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const base = { key: 'testnoegle-1234567890', appUrl: 'https://tilbudsradar.test', isProd: true, log: silentLogger };

  it('melder kun i produktion og kun med en nøgle', async () => {
    const fetchImpl = okFetch();
    expect(await submitIndexNow(['https://tilbudsradar.test/tilbud/smoer'], { ...base, isProd: false, fetchImpl })).toBe(false);
    expect(await submitIndexNow(['https://tilbudsradar.test/tilbud/smoer'], { ...base, key: null, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await submitIndexNow(['https://tilbudsradar.test/tilbud/smoer'], { ...base, fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect(JSON.parse(String(init.body))).toEqual({
      host: 'tilbudsradar.test',
      key: 'testnoegle-1234567890',
      keyLocation: 'https://tilbudsradar.test/testnoegle-1234567890.txt',
      urlList: ['https://tilbudsradar.test/tilbud/smoer'],
    });
  });

  it('fejler stille: netværksfejl og afvisning giver false, ikke en undtagelse', async () => {
    const failing = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await submitIndexNow(['https://tilbudsradar.test/'], { ...base, fetchImpl: failing })).toBe(false);
    const rejected = vi.fn(async () => new Response(null, { status: 422 })) as unknown as typeof fetch;
    expect(await submitIndexNow(['https://tilbudsradar.test/'], { ...base, fetchImpl: rejected })).toBe(false);
  });

  it('efter hentning: første gang alle sider, derefter kun ændrede', async () => {
    const fetchImpl = okFetch();
    const notify = createIndexNowNotifier(database.db, { ...base, fetchImpl });
    await notify();
    const first = JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body)) as { urlList: string[] };
    expect(first.urlList).toContain('https://tilbudsradar.test/tilbud/smoer');
    expect(first.urlList).toContain('https://tilbudsradar.test/');
    await notify();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('nøglefilen serveres på /{nøgle}.txt', async () => {
    const res = await request(app).get('/testnoegle-1234567890.txt').expect(200);
    expect(res.text).toBe('testnoegle-1234567890');
  });
});

describe('<head> på alle sider', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'tr-head-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<html><head><!--seo--><!--/seo--></head><body><div id="root"></div></body></html>');
  writeFileSync(path.join(dist, 'assets', 'inter-tight-latin-wght-normal-AbC123.woff2'), 'font');
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('bekræftelse til Google og Bing og forudindlæsning af skrifttypen', async () => {
    const site = express();
    mountSite(site, dist);
    const html = (await request(site).get('/app/sog').expect(200)).text;
    expect(html).toContain('<meta name="google-site-verification" content="google-abc123" />');
    expect(html).toContain('<meta name="msvalidate.01" content="bing-def456" />');
    expect(html).toContain('<link rel="preload" href="/assets/inter-tight-latin-wght-normal-AbC123.woff2" as="font" type="font/woff2" crossorigin />');
  });
});

describe('delingsbilleder', () => {
  it('varesiden får et PNG på 1200×630 – ukendte sider bruger standardbilledet', async () => {
    const res = await request(app).get('/og/tilbud/smoer.png').buffer(true).expect(200);
    expect(res.type).toBe('image/png');
    const png = res.body as Buffer;
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect((await request(app).get('/og/tilbud/bananer.png').expect(302)).headers.location).toBe('/og-image.png');
    expect((await request(app).get('/og/tilbud/findes-ikke.png').expect(302)).headers.location).toBe('/og-image.png');
  }, 60_000);
});
