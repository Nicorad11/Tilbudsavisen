import path from 'node:path';
import type { InsightsDTO, OfferDetailResponse } from '@tilbudsradar/shared';
import { silentLogger } from '@tilbudsradar/scrapers';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { offers, priceHistory, products } from '../src/db/schema';
import { createApp } from '../src/http/app';
import { configTag, publicConfig } from '../src/http/site';
import { createSsr, type Ssr, type SsrModule } from '../src/http/ssr';
import { ScrapeManager } from '../src/services/scrapeJobs';

/**
 * /indsigt: hvor reelle er tilbuddene? Andel pr. kæde, rabatten i avisen mod den
 * målte besparelse og ugens største prisfald – ud fra den samme vurdering som resten.
 */

const TEMPLATE = `<!doctype html><html lang="da"><head><meta charset="UTF-8" />
    <!--seo--><title>Standard</title><!--/seo-->
  </head><body><div id="root"></div></body></html>`;

const DAY = 86_400_000;
let database: Database;
let ssr: Ssr;
let app: ReturnType<typeof createApp>;
let seq = 0;
let butterOfferId = 0;

async function product(name: string, category: string): Promise<number> {
  const [row] = await database.db.insert(products).values({ name, normalizedName: name.toLowerCase(), category, unit: 'kg' }).returning({ id: products.id });
  return row!.id;
}

/** Normalpris (hyldepris) pr. kg i en kæde de seneste uger. */
async function normalPrice(productId: number, store: string, unitPrice: number) {
  for (const daysAgo of [10, 20, 30]) {
    await database.db.insert(priceHistory).values({
      productId,
      storeId: store,
      observedOn: new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10),
      price: unitPrice / 2,
      unitPrice,
      isOffer: false,
      sourceId: 'test',
    });
  }
}

async function offer(o: { store: string; title: string; category: string; price: number; unitPrice: number; original?: number; productId?: number; from: number; to: number }) {
  const now = Date.now();
  const [row] = await database.db
    .insert(offers)
    .values({
      storeId: o.store,
      sourceId: o.store,
      externalId: `insight-${++seq}`,
      productId: o.productId ?? null,
      title: o.title,
      normalizedName: o.title.toLowerCase(),
      category: o.category,
      offerPrice: o.price,
      originalPrice: o.original ?? null,
      unit: 'kg',
      unitPrice: o.unitPrice,
      validFrom: new Date(now + o.from * DAY),
      validTo: new Date(now + o.to * DAY),
      sourceUrl: 'https://example.dk',
      // Set første gang, da avisen kom.
      firstSeenAt: new Date(now + Math.min(0, o.from) * DAY),
    })
    .returning({ id: offers.id });
  return row!.id;
}

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape, stripe: null });

  const butter = await product('smør', 'mejeri');
  const coffee = await product('kaffe', 'kolonial');
  await normalPrice(butter, 'netto', 100);
  await normalPrice(coffee, 'lidl', 50);
  // Reelt: 20 % under normalprisen – kæden skriver 33 % rabat.
  butterOfferId = await offer({ store: 'netto', title: 'Lurpak smør', category: 'mejeri', price: 20, original: 30, unitPrice: 80, productId: butter, from: -1, to: 5 });
  // Ikke billigere: 2 % under.
  await offer({ store: 'lidl', title: 'Kaffe', category: 'kolonial', price: 24.5, unitPrice: 49, productId: coffee, from: -1, to: 5 });
  // For lidt historik.
  await offer({ store: 'bilka', title: 'Citroner', category: 'frugt-gront', price: 4, unitPrice: 20, from: -1, to: 5 });
  // Sluttede for 20 dage siden: med i de sidste 30 dage, ikke de sidste 7.
  await offer({ store: 'lidl', title: 'Smør', category: 'mejeri', price: 19, unitPrice: 76, productId: butter, from: -26, to: -20 });

  (globalThis as { __TR_CONFIG__?: unknown }).__TR_CONFIG__ = publicConfig();
  const entry = path.resolve(import.meta.dirname, '../../frontend/src/entry-server.tsx');
  const module = (await import(/* @vite-ignore */ entry)) as SsrModule;
  ssr = createSsr({ db: database.db, module, template: TEMPLATE, configTag: configTag() });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('/indsigt', () => {
  it('andel reelle tilbud pr. kæde for de sidste 7 og 30 dage', async () => {
    const data = (await request(app).get('/api/seo/indsigt').expect(200)).body as InsightsDTO;
    const [week, month] = data.periods;
    expect(week!.key).toBe('week');
    expect(week!.label).toBe('De sidste 7 dage');
    // Data går kun 26 dage tilbage – perioden siger det i stedet for at påstå 30 dage.
    expect(month!.label).toMatch(/^Siden \d+\. [a-z]+$/);
    expect(week!.offers).toBe(3);
    expect(month!.offers).toBe(4);
    expect(week!.counts).toEqual({ real: 1, ok: 0, inflated: 1, unknown: 1 });
    // Andelen regnes af de vurderede tilbud – citronerne har for lidt historik.
    expect(week!.assessed).toBe(2);
    expect(week!.realShare).toBe(50);
    expect(week!.mostReal).toEqual({ slug: 'netto', name: 'Netto', count: 1 });
    const netto = week!.stores.find((s) => s.slug === 'netto')!;
    // Under 20 vurderede: ingen andel for kæden.
    expect(netto).toMatchObject({ offers: 1, assessed: 1, realShare: null, measured: 1 });
    // Under 20 målinger: intet gennemsnit og ingen sammenligning med avisens rabat.
    expect(netto.avgSavingsPct).toBeNull();
    expect(netto.claimed).toBeNull();
    expect(data.headline).toEqual({ value: '50 %', text: 'af de vurderede tilbud de sidste 7 dage var reelle' });
  });

  it('ugens største prisfald: reelle tilbud målt mod normalprisen, med link til varen', async () => {
    const data = (await request(app).get('/api/seo/indsigt').expect(200)).body as InsightsDTO;
    expect(data.drops).toHaveLength(1);
    expect(data.drops[0]).toMatchObject({ title: 'Lurpak smør', unitPrice: 80, normalUnitPrice: 100, savingsPct: 20, term: { href: '/tilbud/smoer', label: 'Smør' } });
  });

  it('vurderingen siger, hvad besparelsen er målt mod', async () => {
    const res = (await request(app).get(`/api/offers/${butterOfferId}`).expect(200)).body as OfferDetailResponse;
    expect(res.offer.trust).toMatchObject({ level: 'real', basis: 'store', savingsPct: 20 });
  });

  it('server-renderet med tal og metode – noindex med for få tilbud til at sige noget sikkert', async () => {
    const page = await ssr.render('/indsigt');
    expect(page.status).toBe(200);
    expect(page.html).toMatch(/<h1\b[^>]*>Hvor reelle er tilbuddene\?<\/h1>/);
    expect(page.html).toContain('<meta name="robots" content="noindex,follow" />');
    expect(page.html).toContain('<meta property="og:image" content="https://tilbudsradar.test/og/indsigt.png" />');
    expect(page.html).toContain('Andel reelle tilbud pr. kæde');
    expect(page.html).toContain('href="/metode"');
    const sitemap = (await request(app).get('/sitemap-pages.xml').expect(200)).text;
    expect(sitemap).not.toContain('/indsigt');
  });

  it('eget delingsbillede', async () => {
    const res = await request(app).get('/og/indsigt.png').buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    const png = res.body as Buffer;
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  }, 30_000);
});
