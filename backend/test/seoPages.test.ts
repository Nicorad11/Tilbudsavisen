import path from 'node:path';
import { isoWeek, slugify, seoTermBySlug, type TermPageDTO } from '@tilbudsradar/shared';
import { silentLogger } from '@tilbudsradar/scrapers';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { offers } from '../src/db/schema';
import { createApp } from '../src/http/app';
import { configTag, publicConfig } from '../src/http/site';
import { createSsr, type Ssr, type SsrModule } from '../src/http/ssr';
import type { OfferRow } from '../src/services/offers';
import { matchTerm } from '../src/services/seo/termIndex';
import { ScrapeManager } from '../src/services/scrapeJobs';

/**
 * Datasiderne: /tilbud, /tilbud/{vare}, /butikker, /butik/{kæde},
 * /kategori/{kategori}, /ugens-bedste-tilbud og /metode.
 */

const TEMPLATE = `<!doctype html><html lang="da"><head><meta charset="UTF-8" />
    <!--seo--><title>Standard</title><!--/seo-->
  </head><body><div id="root"></div></body></html>`;

const DAY = 86_400_000;
let database: Database;
let ssr: Ssr;
let app: ReturnType<typeof createApp>;
let seq = 0;

/** Et tilbud direkte i databasen. `days` er gyldigheden relativt til i dag. */
async function offer(o: { store: string; title: string; category: string; price: number; unitPrice?: number; unit?: string; from: number; to: number; original?: number }) {
  const now = Date.now();
  await database.db.insert(offers).values({
    storeId: o.store,
    sourceId: o.store,
    externalId: `test-${++seq}`,
    title: o.title,
    normalizedName: o.title.toLowerCase(),
    category: o.category,
    offerPrice: o.price,
    originalPrice: o.original ?? null,
    unit: o.unit ?? 'kg',
    unitPrice: o.unitPrice ?? null,
    validFrom: new Date(now + o.from * DAY),
    validTo: new Date(now + o.to * DAY),
    sourceUrl: 'https://example.dk',
  });
}

/** React sætter <!-- --> mellem tekststykker i server-HTML – fjernes, så teksten kan sammenlignes. */
const render = async (url: string) => {
  const page = await ssr.render(url);
  return { status: page.status, html: page.html.replace(/<!-- -->/g, '') };
};
const h1 = (html: string) => /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
const title = (html: string) => /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';
const description = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape, stripe: null });

  // Smør: 4 aktuelle tilbud i 3 kæder → indekserbar.
  await offer({ store: 'netto', title: 'Lurpak smør', category: 'mejeri', price: 21.95, unitPrice: 87.8, from: -1, to: 5 });
  await offer({ store: 'rema1000', title: 'Kærgården', category: 'mejeri', price: 17.5, unitPrice: 70, from: -1, to: 5 });
  await offer({ store: 'lidl', title: 'MILBONA Letsaltet smør', category: 'mejeri', price: 9.95, unitPrice: 44.22, from: -2, to: 4 });
  await offer({ store: 'lidl', title: 'Smørrebrød med laks', category: 'mejeri', price: 30, unitPrice: 150, from: -2, to: 4 });
  await offer({ store: 'bilka', title: 'Lurpak smør, 250 g', category: 'mejeri', price: 19.95, unitPrice: 79.8, from: 3, to: 9 });
  // Citroner: kun ét tidligere tilbud → siden findes, men noindex.
  await offer({ store: 'lidl', title: 'Citroner', category: 'frugt-gront', price: 4, unitPrice: 4, unit: 'stk', from: -20, to: -14 });
  // Bananer: aldrig på tilbud → 404.
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('slugs og ugenumre', () => {
  it('æ, ø og å bliver ae, oe og aa', () => {
    expect(slugify('Hakket oksekød')).toBe('hakket-oksekoed');
    expect(slugify('Smør')).toBe('smoer');
    expect(slugify('Blåbær')).toBe('blaabaer');
    expect(slugify('Æbler')).toBe('aebler');
    expect(slugify('Crème fraîche')).toBe('creme-fraiche');
    expect(slugify('Mejeri & æg')).toBe('mejeri-aeg');
  });

  it('ISO-uge i dansk tid omkring årsskiftet', () => {
    expect(isoWeek(new Date('2026-12-31T12:00:00Z'))).toEqual({ week: 53, year: 2026 });
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toEqual({ week: 53, year: 2026 });
    expect(isoWeek(new Date('2027-01-04T12:00:00Z'))).toEqual({ week: 1, year: 2027 });
    expect(isoWeek(new Date('2024-12-30T12:00:00Z'))).toEqual({ week: 1, year: 2025 });
    // Søndag kl. 23.30 UTC er allerede mandag i Danmark – ny uge.
    expect(isoWeek(new Date('2027-01-03T23:30:00Z'))).toEqual({ week: 1, year: 2027 });
  });

  it('alle vare-slugs er unikke', () => {
    const slugs = ['smoer', 'kaffe', 'hakket-oksekoed'].map((s) => seoTermBySlug(s)?.label);
    expect(slugs).toEqual(['Smør', 'Kaffe', 'Hakket oksekød']);
  });
});

describe('matchning af varer', () => {
  const row = (title: string, category = 'mejeri') => ({ id: ++seq, title, brand: null, normalized_name: title.toLowerCase(), category }) as unknown as OfferRow;

  it('Lurpak og Kærgården er smør – smørrebrød og smørbar fra andre mærker er ikke', () => {
    const smoer = seoTermBySlug('smoer')!;
    const rows = [row('Lurpak smørbar'), row('Kærgården'), row('Arla smør'), row('Smørrebrød med laks'), row('Becel smørbar'), row('Lurpak smør', 'snacks')];
    expect(matchTerm(smoer, rows).map((r) => r.title)).toEqual(['Lurpak smørbar', 'Kærgården', 'Arla smør']);
  });

  it('kræver hele ord: "ost" rammer ikke "tørkost" eller "flødeost"', () => {
    const ost = seoTermBySlug('ost')!;
    const rows = [row('IAMS tørkost'), row('Riberhus skiveost'), row('Puck ost'), row('Arla flødeost')];
    expect(matchTerm(ost, rows).map((r) => r.title)).toEqual(['Riberhus skiveost', 'Puck ost']);
  });
});

describe('server-renderede datasider', () => {
  beforeAll(async () => {
    (globalThis as { __TR_CONFIG__?: unknown }).__TR_CONFIG__ = publicConfig();
    const entry = path.resolve(import.meta.dirname, '../../frontend/src/entry-server.tsx');
    const module = (await import(/* @vite-ignore */ entry)) as SsrModule;
    ssr = createSsr({ db: database.db, module, template: TEMPLATE, configTag: configTag() });
  }, 120_000);

  const week = isoWeek(new Date()).week;

  it('/tilbud/smoer: indekserbar med H1, data-resumé, tabel, spørgsmål og svar', async () => {
    const page = await render('/tilbud/smoer');
    expect(page.status).toBe(200);
    expect(h1(page.html)).toBe(`Smør på tilbud i uge ${week}`);
    expect(page.html).toContain('<link rel="canonical" href="https://tilbudsradar.test/tilbud/smoer" />');
    expect(page.html).toContain('<meta name="robots" content="max-image-preview:large, max-snippet:-1" />');
    expect(page.html).toContain('Lige nu er der 4 tilbud på smør i 4 kæder.');
    expect(page.html).toContain('Billigst pr. kg er MILBONA Letsaltet smør hos Lidl: 44,22 kr/kg.');
    expect(page.html).toContain('<table');
    expect(page.html).not.toContain('Smørrebrød med laks');
    expect(page.html).toContain('Hvor er smør billigst i denne uge?');
    expect(page.html).toMatch(/<a [^>]*href="\/metode"/);
    expect(page.html).toMatch(/<a [^>]*href="\/butik\/lidl"/);
    expect(page.html).toContain('href="/app/alarmer?vare=sm%C3%B8r"');
    // Titel og beskrivelse holder længden.
    expect(title(page.html).length).toBeLessThanOrEqual(60);
    expect(description(page.html).length).toBeLessThanOrEqual(160);
    // Data til hydrering med samme nøgle som frontenden.
    const state = /<script id="tr-state" type="application\/json">([\s\S]*?)<\/script>/.exec(page.html)![1]!;
    expect((JSON.parse(state) as { queries: { queryKey: unknown[] }[] }).queries[0]!.queryKey).toEqual(['seo', 'tilbud', 'smoer']);
  });

  it('/tilbud/citroner: under grænsen – 200 med noindex og "sidst på tilbud"', async () => {
    const page = await render('/tilbud/citroner');
    expect(page.status).toBe(200);
    expect(page.html).toContain('<meta name="robots" content="noindex,follow" />');
    expect(page.html).toContain(`Citroner er ikke på tilbud i uge ${week}.`);
    expect(page.html).toContain('Sidst var det Citroner hos Lidl til 4,00 kr');
  });

  it('vare uden data og ukendt vare: 404', async () => {
    expect((await render('/tilbud/bananer')).status).toBe(404);
    const unknown = await render('/tilbud/findes-ikke');
    expect(unknown.status).toBe(404);
    expect(unknown.html).toContain('<meta name="robots" content="noindex,follow" />');
  });

  it('/tilbud: alle varer med data, A–Å', async () => {
    const page = await render('/tilbud');
    expect(page.status).toBe(200);
    expect(h1(page.html)).toBe('Dagligvarer på tilbud A–Å');
    expect(page.html).toMatch(/<a [^>]*href="\/tilbud\/smoer"/);
    expect(page.html).toMatch(/<a [^>]*href="\/tilbud\/citroner"/);
    expect(page.html).not.toMatch(/href="\/tilbud\/bananer"/);
  });

  it('kæder: /butikker og /butik/{kæde} – med uafhængighedserklæring', async () => {
    const hub = await render('/butikker');
    expect(hub.status).toBe(200);
    expect(hub.html).toMatch(/<a [^>]*href="\/butik\/rema-1000"/);
    const lidl = await render('/butik/lidl');
    expect(lidl.status).toBe(200);
    expect(h1(lidl.html)).toBe(`Lidl tilbud i uge ${week}`);
    expect(lidl.html).toContain('Tilbudsradar er ikke tilknyttet Lidl.');
    // Færre end 10 tilbud: siden findes, men er ikke i indekset.
    expect(lidl.html).toContain('<meta name="robots" content="noindex,follow" />');
    expect((await render('/butik/coop')).status).toBe(404);
  });

  it('kategori: synlige kategorier – ikke pausede eller "andet"', async () => {
    const page = await render('/kategori/mejeri-aeg');
    expect(page.status).toBe(200);
    expect(h1(page.html)).toBe(`Mejeri & æg på tilbud i uge ${week}`);
    expect((await render('/kategori/elektronik')).status).toBe(404);
    expect((await render('/kategori/andet')).status).toBe(404);
  });

  it('/ugens-bedste-tilbud og /metode', async () => {
    const weekly = await render('/ugens-bedste-tilbud');
    expect(weekly.status).toBe(200);
    expect(h1(weekly.html)).toBe('Ugens bedste tilbud');
    const method = await render('/metode');
    expect(method.status).toBe(200);
    expect(method.html).toContain('mindst 10 % under gennemsnittet');
    expect(method.html).toContain('<meta name="robots" content="max-image-preview:large, max-snippet:-1" />');
  });
});

describe('API til navigation i browseren', () => {
  it('samme indhold som JSON – og 404 for ukendte sider', async () => {
    const res = await request(app).get('/api/seo/tilbud/smoer').expect(200);
    const page = res.body as TermPageDTO;
    expect(page.kind).toBe('term');
    expect(page.offers.map((o) => o.title)).toEqual(['MILBONA Letsaltet smør', 'Kærgården', 'Lurpak smør, 250 g', 'Lurpak smør']);
    await request(app).get('/api/seo/tilbud/bananer').expect(404);
    await request(app).get('/api/seo/tilbud/../admin').expect(404);
    await request(app).get('/api/seo/butik/ukendt').expect(404);
  });
});
