import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AuthResponse,
  ListOptimizationDTO,
  OfferDetailResponse,
  PriceHistoryResponse,
  SearchResponse,
  ShoppingListDTO,
  StatsDTO,
  WatchDTO,
} from '@tilbudsradar/shared';
import { mapRemaProduct, mapTjekOffer, silentLogger } from '@tilbudsradar/scrapers';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, query, type Database } from '../src/db/client';
import { createApp } from '../src/http/app';
import { ingestOffers } from '../src/services/ingest';
import { planStores } from '../src/services/lists';
import { ScrapeManager } from '../src/services/scrapeJobs';
import { purgeOutOfScope } from '../src/services/scope';
import { checkWatchlists } from '../src/services/watch';

const fixtures = path.resolve(import.meta.dirname, '../../scrapers/test/fixtures');
const json = <T,>(name: string) => JSON.parse(readFileSync(path.join(fixtures, name), 'utf8')) as T;

let database: Database;
let app: ReturnType<typeof createApp>;

const day = 86_400_000;
const iso = (d: Date) => d.toISOString().replace('.000Z', '+0000');

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape });

  // Avistilbud fra fixtures, flyttet så de er aktive nu – for REMA og (kopieret) Netto.
  const now = Date.now();
  const raw = json<Record<string, unknown>[]>('tjek-offers.json').map((o): Record<string, unknown> => ({
    ...o,
    run_from: iso(new Date(now - day)),
    run_till: iso(new Date(now + 5 * day)),
  }));
  const rema = raw.map((o) => mapTjekOffer(o, { storeId: 'rema1000', sourceId: 'rema1000', dealerSlug: 'REMA-1000' }));
  const netto = raw.map((o) => {
    const pricing = o.pricing as { price: number } | undefined;
    if (!pricing) return null; // den bevidst ødelagte fixture-record
    return mapTjekOffer(
      { ...o, id: `n-${String(o.id)}`, pricing: { ...pricing, price: Math.round(pricing.price * 0.9 * 100) / 100 } },
      { storeId: 'netto', sourceId: 'netto', dealerSlug: 'Netto' },
    );
  });
  const offers = [...rema, ...netto].filter((o) => o !== null);
  await ingestOffers(database.db, offers);

  // Hyldepriser fra REMA's webshop.
  const products = json<{ data: unknown[] }>('rema-products.json').data;
  const baseline = products
    .map((p) => mapRemaProduct(p, { storeId: 'rema1000', sourceId: 'rema1000-webshop', departmentId: 30, now: new Date() }))
    .filter((o) => o !== null);
  await ingestOffers(database.db, baseline);

  // Historik: normalprisen på kylling har ligget på 45 kr/kg de sidste uger.
  const [kylling] = await query<{ product_id: number }>(
    database.db,
    sql`SELECT product_id FROM offers WHERE store_id = 'rema1000' AND title = 'Dansk kylling'`,
  );
  for (let i = 5; i <= 40; i += 5) {
    const d = new Date(now - i * day).toISOString().slice(0, 10);
    await database.db.execute(sql`
      INSERT INTO price_history (product_id, store_id, observed_on, price, unit_price, is_offer, source_id)
      VALUES (${kylling!.product_id}, 'rema1000', ${d}::date, 46, 45, false, 'test')`);
  }
});

afterAll(async () => {
  await database?.close();
});

async function guest() {
  const res = await request(app).post('/api/auth/guest').expect(201);
  const body = res.body as AuthResponse;
  return { token: body.accessToken, user: body.user, cookie: res.headers['set-cookie'] as unknown as string[] };
}

describe('API', () => {
  it('health', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('søger på tværs af kæder og sorterer efter pris pr. enhed', async () => {
    const res = await request(app).get('/api/search').query({ q: 'kylling' }).expect(200);
    const body = res.body as SearchResponse;
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(new Set(body.items.map((i) => i.store.id))).toEqual(new Set(['rema1000', 'netto']));
    const prices = body.items.filter((i) => i.unit === 'kg').map((i) => i.unitPrice!);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(body.items[0]!.store.id).toBe('netto'); // 10 % billigere i testdata
    expect(body.facets.stores.map((s) => s.id).sort()).toEqual(['netto', 'rema1000']);
  });

  it('finder sammensatte ord og tåler stavefejl', async () => {
    const compound = (await request(app).get('/api/search').query({ q: 'kød' })).body as SearchResponse;
    expect(compound.items.some((i) => /oksekød|kalvekød/i.test(i.title))).toBe(true);
    const typo = (await request(app).get('/api/search').query({ q: 'sodavamd' })).body as SearchResponse;
    expect(typo.items.some((i) => /sodavand/i.test(i.title))).toBe(true);
  });

  it('filtrerer på kæde og kategori', async () => {
    const res = await request(app).get('/api/search').query({ q: '', stores: 'netto', categories: 'drikkevarer' }).expect(200);
    const body = res.body as SearchResponse;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.store.id === 'netto' && i.category === 'drikkevarer')).toBe(true);
  });

  it('vurderer om et tilbud er reelt ud fra historikken', async () => {
    const res = await request(app).get('/api/search').query({ q: 'dansk kylling', stores: 'rema1000' }).expect(200);
    const offer = (res.body as SearchResponse).items.find((i) => i.title === 'Dansk kylling')!;
    expect(offer.trust.level).toBe('real'); // 34,15 kr/kg mod normalt 45 kr/kg
    expect(offer.trust.savingsPct).toBeCloseTo(24.1, 0);

    const detail = (await request(app).get(`/api/offers/${offer.id}`).expect(200)).body as OfferDetailResponse;
    expect(detail.alternatives.some((a) => a.store.id === 'netto')).toBe(true);

    const history = (await request(app).get(`/api/products/${offer.productId}/history`).expect(200))
      .body as PriceHistoryResponse;
    expect(history.points.length).toBeGreaterThanOrEqual(9);
    expect(history.avgUnitPrice90d).toBe(45);
  });

  it('dashboard-statistik', async () => {
    const res = await request(app).get('/api/stats').expect(200);
    const stats = res.body as StatsDTO;
    expect(stats.totalOffers).toBe(18);
    expect(stats.storeCount).toBe(2);
    expect(stats.realDeals).toBeGreaterThanOrEqual(1);
    expect(stats.timeline.length).toBeGreaterThan(0);
  });

  it('kræver login til lister', async () => {
    await request(app).get('/api/lists').expect(401);
  });

  it('indkøbsliste med butiks-splitting', async () => {
    const { token } = await guest();
    const auth = { Authorization: `Bearer ${token}` };
    const list = (await request(app).post('/api/lists').set(auth).send({ name: 'Weekend' }).expect(201)).body as { id: number };
    for (const text of ['kylling', 'sodavand', 'skyr']) {
      await request(app).post(`/api/lists/${list.id}/items`).set(auth).send({ text }).expect(201);
    }
    const detail = (await request(app).get(`/api/lists/${list.id}`).set(auth).expect(200)).body as ShoppingListDTO;
    expect(detail.items).toHaveLength(3);
    expect(detail.items.every((i) => i.bestOffer?.store.id === 'netto')).toBe(true);

    const plan = (await request(app).get(`/api/lists/${list.id}/optimize`).set(auth).expect(200)).body as ListOptimizationDTO;
    expect(plan.itemCount).toBe(3);
    expect(plan.bestSingle?.storeIds).toEqual(['netto']);
    expect(plan.bestSingle?.covered).toBe(3);
    // Netto er billigst på alt – en ekstra butik giver ingen besparelse.
    expect(plan.bestSplit).toBeNull();

    // En anden gæst kan ikke se listen.
    const other = await guest();
    await request(app).get(`/api/lists/${list.id}`).set({ Authorization: `Bearer ${other.token}` }).expect(404);
  });

  it('gæst kan opgradere til konto og beholde data; refresh roterer token', async () => {
    const g = await guest();
    const auth = { Authorization: `Bearer ${g.token}` };
    await request(app).post('/api/lists').set(auth).send({ name: 'Gæsteliste' }).expect(201);
    const reg = await request(app)
      .post('/api/auth/register')
      .set(auth)
      .send({ email: 'Test@Example.dk', password: 'hemmelig123' })
      .expect(201);
    const body = reg.body as AuthResponse;
    expect(body.user).toMatchObject({ id: g.user.id, email: 'test@example.dk', isGuest: false });
    const lists = await request(app).get('/api/lists').set({ Authorization: `Bearer ${body.accessToken}` }).expect(200);
    expect(lists.body).toHaveLength(1);

    await request(app).post('/api/auth/login').send({ email: 'test@example.dk', password: 'forkert-kode' }).expect(401);
    const login = await request(app).post('/api/auth/login').send({ email: 'test@example.dk', password: 'hemmelig123' }).expect(200);
    const cookie = login.headers['set-cookie'] as unknown as string[];
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    expect((refreshed.body as AuthResponse).user.email).toBe('test@example.dk');
    // Samtidige faner: genbrug lige efter rotation accepteres.
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    // Genbrug længe efter tolkes som tyveri – alle sessioner lukkes.
    await database.db.execute(sql`UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes' WHERE revoked_at IS NOT NULL`);
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    const newest = refreshed.headers['set-cookie'] as unknown as string[];
    await request(app).post('/api/auth/refresh').set('Cookie', newest).expect(401);
  });

  it('watchlist giver notifikation når prisen er under grænsen', async () => {
    const { token } = await guest();
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/watchlist').set(auth).send({ query: 'harboe sodavand', targetPrice: 5 }).expect(201);
    await request(app).post('/api/watchlist').set(auth).send({ query: 'laksefilet', targetPrice: 1 }).expect(201);
    const watches = (await request(app).get('/api/watchlist').set(auth).expect(200)).body as WatchDTO[];
    expect(watches.find((w) => w.query === 'harboe sodavand')?.triggered).toBe(true);
    expect(watches.find((w) => w.query === 'laksefilet')?.triggered).toBe(false);

    expect(await checkWatchlists(database.db, silentLogger)).toBeGreaterThanOrEqual(1);
    const notes = (await request(app).get('/api/notifications').set(auth).expect(200)).body as { message: string }[];
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message).toMatch(/Harboe sodavand/);
    // Samme tilbud udløser ikke en ny notifikation.
    await checkWatchlists(database.db, silentLogger);
    expect((await request(app).get('/api/notifications').set(auth)).body).toHaveLength(1);
  });

  it('community-vurderinger og stemmer', async () => {
    const search = (await request(app).get('/api/search').query({ q: 'skyr' })).body as SearchResponse;
    const offerId = search.items[0]!.id;
    const a = await guest();
    const b = await guest();
    const report = (
      await request(app)
        .post(`/api/offers/${offerId}/reports`)
        .set({ Authorization: `Bearer ${a.token}` })
        .send({ verdict: 'misleading', comment: 'Samme pris som sidste måned' })
        .expect(201)
    ).body as { id: number };
    await request(app).post(`/api/reports/${report.id}/vote`).set({ Authorization: `Bearer ${a.token}` }).send({ value: 1 }).expect(400);
    await request(app).post(`/api/reports/${report.id}/vote`).set({ Authorization: `Bearer ${b.token}` }).send({ value: 1 }).expect(204);

    const detail = (await request(app).get(`/api/offers/${offerId}`).set({ Authorization: `Bearer ${b.token}` }))
      .body as OfferDetailResponse;
    expect(detail.offer.community).toEqual({ real: 0, misleading: 1, score: 0 });
    expect(detail.reports[0]).toMatchObject({ upvotes: 1, myVote: 1, isMine: false, verdict: 'misleading' });
  });

  it('madplan uden API-nøgle falder tilbage til regelbaseret plan', async () => {
    const { token } = await guest();
    const res = await request(app)
      .post('/api/meal-plans')
      .set({ Authorization: `Bearer ${token}` })
      .send({ householdSize: 2, days: 3, budget: 300 })
      .expect(201);
    expect(res.body.generatedBy).toBe(process.env.ANTHROPIC_API_KEY ? 'ai' : 'regler');
    expect(res.body.recipes).toHaveLength(3);
    const linked = res.body.recipes.flatMap((r: { ingredients: { offerId: number | null }[] }) => r.ingredients).filter(
      (i: { offerId: number | null }) => i.offerId !== null,
    );
    expect(linked.length).toBeGreaterThan(0);
  });

  it('admin: slå en kæde fra skjuler dens tilbud', async () => {
    await request(app).patch('/api/admin/stores/netto').send({ enabled: false }).expect(200);
    const res = (await request(app).get('/api/search').query({ q: 'kylling' })).body as SearchResponse;
    expect(res.items.every((i) => i.store.id !== 'netto')).toBe(true);
    await request(app).patch('/api/admin/stores/netto').send({ enabled: true }).expect(200);
    const status = (await request(app).get('/api/admin/status').expect(200)).body as { sources: { id: string }[] };
    expect(status.sources.map((s) => s.id)).toContain('rema1000-webshop');
  });

  it('pausede kæder og kategorier gemmes ikke og vises ikke', async () => {
    const [first] = json<Record<string, unknown>[]>('tjek-offers.json');
    const extra = (storeId: string, id: string) =>
      mapTjekOffer({ ...first, id, run_till: iso(new Date(Date.now() + 5 * day)) }, { storeId, sourceId: storeId, dealerSlug: storeId })!;

    const power = extra('power', 'paused-power');
    const tv = { ...extra('rema1000', 'paused-tv'), category: 'elektronik' as const };
    const kept = extra('rema1000', 'purge-me');
    const stats = await ingestOffers(database.db, [power, tv, kept]);
    expect(stats.offersSaved).toBe(1);

    // Et tilbud der senere havner i en pauset kategori ryddes op ved næste sync.
    await database.db.execute(sql`UPDATE offers SET category = 'elektronik' WHERE external_id = ${kept.externalId}`);
    expect(await purgeOutOfScope(database.db)).toBe(1);
    const left = await query(database.db, sql`SELECT id FROM offers WHERE category IN ('elektronik', 'bolig-have') OR store_id = 'power'`);
    expect(left).toHaveLength(0);

    const categories = (await request(app).get('/api/categories').expect(200)).body as { id: string }[];
    expect(categories.map((c) => c.id)).not.toContain('elektronik');
    expect(categories.map((c) => c.id)).not.toContain('bolig-have');
    const stores = (await request(app).get('/api/stores').expect(200)).body as { id: string }[];
    expect(stores.map((s) => s.id)).not.toContain('power');
    expect(stores.map((s) => s.id)).not.toContain('jemogfix');
  });

  it('GDPR: sletning af konto fjerner brugerens data', async () => {
    const { token } = await guest();
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/lists').set(auth).send({ name: 'Slet mig' }).expect(201);
    const exported = await request(app).get('/api/auth/me/export').set(auth).expect(200);
    expect(exported.body.shoppingLists).toHaveLength(1);
    await request(app).delete('/api/auth/me').set(auth).expect(204);
    await request(app).get('/api/auth/me').set(auth).expect(404);
  });
});

describe('planStores', () => {
  it('finder den billigste kombination og beregner besparelsen', () => {
    const prices = new Map([
      [1, new Map([['a', 10], ['b', 20]])],
      [2, new Map([['a', 30], ['b', 12]])],
      [3, new Map([['a', 5]])],
    ]);
    const plan = planStores(prices, ['a', 'b'], 2);
    expect(plan.bestSingle).toMatchObject({ storeIds: ['a'], total: 45, covered: 3 });
    expect(plan.bestSplit).toMatchObject({ total: 27, covered: 3 });
    expect(plan.savings).toBe(18);
  });
});
