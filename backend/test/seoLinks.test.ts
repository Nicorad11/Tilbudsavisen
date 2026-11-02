import path from 'node:path';
import { POPULAR_TERMS, SEO_CATEGORIES, SEO_STORES, type HomeLinksDTO, type OfferDetailResponse } from '@tilbudsradar/shared';
import { silentLogger } from '@tilbudsradar/scrapers';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { offers } from '../src/db/schema';
import { createApp } from '../src/http/app';
import { configTag, publicConfig } from '../src/http/site';
import { createSsr, type Ssr, type SsrModule } from '../src/http/ssr';
import { ScrapeManager } from '../src/services/scrapeJobs';

/**
 * Intern linking og AI-synlighed: forsidens populære varer og kæder, header og
 * footer, linket fra et tilbud til varesiden og /llms.txt.
 */

const TEMPLATE = `<!doctype html><html lang="da"><head><meta charset="UTF-8" />
    <!--seo--><title>Standard</title><!--/seo-->
  </head><body><div id="root"></div></body></html>`;

const DAY = 86_400_000;
let database: Database;
let ssr: Ssr;
let app: ReturnType<typeof createApp>;
let seq = 0;

async function offer(o: { store: string; title: string; category: string; price: number; unitPrice?: number }): Promise<number> {
  const now = Date.now();
  const [row] = await database.db
    .insert(offers)
    .values({
      storeId: o.store,
      sourceId: o.store,
      externalId: `links-${++seq}`,
      title: o.title,
      normalizedName: o.title.toLowerCase(),
      category: o.category,
      offerPrice: o.price,
      unit: 'kg',
      unitPrice: o.unitPrice ?? null,
      validFrom: new Date(now - DAY),
      validTo: new Date(now + 5 * DAY),
      sourceUrl: 'https://example.dk',
    })
    .returning({ id: offers.id });
  return row!.id;
}

let butterId = 0;
let chipsId = 0;

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape, stripe: null });
  // Smør: tre aktuelle tilbud → indekserbar. Chips: ét tilbud → for tyndt til forsiden.
  butterId = await offer({ store: 'lidl', title: 'MILBONA smør', category: 'mejeri', price: 9.95, unitPrice: 44.22 });
  await offer({ store: 'netto', title: 'Lurpak smør', category: 'mejeri', price: 21.95, unitPrice: 87.8 });
  await offer({ store: 'rema1000', title: 'Kærgården smør', category: 'mejeri', price: 17.5, unitPrice: 70 });
  chipsId = await offer({ store: 'netto', title: 'Kims chips', category: 'snacks', price: 15 });
  await offer({ store: 'netto', title: 'Toiletrens', category: 'husholdning', price: 12 });

  (globalThis as { __TR_CONFIG__?: unknown }).__TR_CONFIG__ = publicConfig();
  const entry = path.resolve(import.meta.dirname, '../../frontend/src/entry-server.tsx');
  const module = (await import(/* @vite-ignore */ entry)) as SsrModule;
  ssr = createSsr({ db: database.db, module, template: TEMPLATE, configTag: configTag() });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('forsiden', () => {
  it('populære varer: kun varer på tilbud nu med en indekserbar side – og alle fem kæder', async () => {
    const data = (await request(app).get('/api/seo/forside').expect(200)).body as HomeLinksDTO;
    expect(data.popular.map((p) => p.href)).toEqual(['/tilbud/smoer']);
    expect(data.popular[0]).toMatchObject({ label: 'Smør', detail: 'fra 44,22 kr/kg', storeName: 'Lidl' });
    expect(data.stores.map((s) => s.slug)).toEqual(SEO_STORES.map((s) => s.slug));
    expect(data.stores.find((s) => s.slug === 'netto')?.offerCount).toBe(3);
  });

  it('er server-renderet med links til varer og kæder – data følger med til hydrering', async () => {
    const page = await ssr.render('/');
    expect(page.html).toContain('Populære varer på tilbud lige nu');
    expect(page.html).toMatch(/<a [^>]*href="\/tilbud\/smoer"[^>]*>.*Smør/);
    expect(page.html).toMatch(/fra 44,22 kr\/kg(<!-- -->)? hos (<!-- -->)?Lidl/);
    for (const st of SEO_STORES) expect(page.html).toContain(`href="/butik/${st.slug}"`);
    const state = /<script id="tr-state" type="application\/json">([\s\S]*?)<\/script>/.exec(page.html)![1]!;
    expect((JSON.parse(state) as { queries: { queryKey: unknown[] }[] }).queries.map((q) => q.queryKey)).toContainEqual(['seo', 'forside']);
  });
});

describe('header og footer', () => {
  it('linker til datasiderne fra alle offentlige sider', async () => {
    const { html } = await ssr.render('/priser');
    expect(html).toMatch(/<nav [^>]*aria-label="Hovedmenu"[\s\S]*?href="\/tilbud"/);
    for (const t of POPULAR_TERMS) expect(html).toContain(`href="/tilbud/${t.slug}"`);
    for (const st of SEO_STORES) expect(html).toContain(`href="/butik/${st.slug}"`);
    for (const c of SEO_CATEGORIES) expect(html).toContain(`href="/kategori/${c.slug}"`);
    for (const p of ['/tilbud', '/ugens-bedste-tilbud', '/metode']) expect(html).toContain(`href="${p}"`);
    // Admin linkes aldrig fra den offentlige side.
    expect(html).not.toMatch(/href="[^"]*admin/);
  });
});

describe('tilbud → vareside', () => {
  it('et tilbud, der matcher en vare, peger på varesiden', async () => {
    const res = (await request(app).get(`/api/offers/${butterId}`).expect(200)).body as OfferDetailResponse;
    expect(res.seoTerm).toEqual({ slug: 'smoer', phrase: 'smør' });
  });

  it('den mest præcise vare vinder, og tilbud uden vare får null', async () => {
    const chips = (await request(app).get(`/api/offers/${chipsId}`).expect(200)).body as OfferDetailResponse;
    expect(chips.seoTerm?.slug).toBe('chips');
    const all = await database.db.select({ id: offers.id, title: offers.title }).from(offers);
    const cleaner = all.find((o) => o.title === 'Toiletrens')!;
    const none = (await request(app).get(`/api/offers/${cleaner.id}`).expect(200)).body as OfferDetailResponse;
    expect(none.seoTerm).toBeNull();
  });
});

describe('/llms.txt', () => {
  it('kort Markdown-oversigt med absolutte links til hubs, kæder, populære varer og metode', async () => {
    const res = await request(app).get('/llms.txt').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    const text = res.text;
    expect(text.startsWith('# Tilbudsradar\n\n> ')).toBe(true);
    expect(text).toContain('(https://tilbudsradar.test/tilbud)');
    expect(text).toContain('(https://tilbudsradar.test/metode)');
    expect(text).toContain('[Smør på tilbud](https://tilbudsradar.test/tilbud/smoer)');
    expect(text).toContain('[REMA 1000 tilbud](https://tilbudsradar.test/butik/rema-1000)');
    expect(text).toContain('mindst 10 % under varens gennemsnitspris');
    expect(text).not.toContain('/app');
    expect(text).not.toContain('admin');
  });
});
