import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AuthResponse,
  ListOptimizationDTO,
  OfferDetailResponse,
  PriceHistoryResponse,
  ReceiptCheckDTO,
  ReceiptLine,
  ReceiptOverviewDTO,
  SearchResponse,
  ShoppingListDTO,
  SuggestResponse,
  StatsDTO,
  WatchDTO,
} from '@tilbudsradar/shared';
import { mapRemaProduct, mapTjekOffer, silentLogger } from '@tilbudsradar/scrapers';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, query, type Database } from '../src/db/client';
import { createApp } from '../src/http/app';
import { ingestOffers, removeDuplicateOffers } from '../src/services/ingest';
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
  app = createApp({ db: database.db, scrape, stripe: null });

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

let memberSeq = 0;
/** En ny konto – får automatisk 14 dages prøveperiode. */
async function member(email = `medlem${++memberSeq}@example.dk`) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hemmelig123', acceptTerms: true }).expect(201);
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

  it('foreslår varetyper mens man skriver, med pris og antal kæder', async () => {
    const res = (await request(app).get('/api/search/suggest').query({ q: 'kyl' }).expect(200)).body as SuggestResponse;
    const kylling = res.suggestions.find((s) => s.term === 'kylling')!;
    expect(kylling).toMatchObject({ category: 'kod-fisk', storeCount: 2, unit: 'kg' });
    // Netto er 10 % billigere i testdata: 34,15 kr/kg × 0,9.
    expect(kylling.fromUnitPrice).toBeCloseTo(30.74, 1);
    expect(res.categories[0]).toMatchObject({ id: 'kod-fisk' });

    const hakket = (await request(app).get('/api/search/suggest').query({ q: 'hakket' })).body as SuggestResponse;
    expect(hakket.suggestions.map((s) => s.term)).toEqual(expect.arrayContaining(['hakket oksekød', 'hakket grisekød']));

    const empty = (await request(app).get('/api/search/suggest').query({ q: 'k' })).body as SuggestResponse;
    expect(empty.suggestions).toEqual([]);
  });

  it('et forslag finder de tilbud det kom fra', async () => {
    // "Hakket dansk oksekød med grønt, grise- og kalvekød …" indeholder ikke ordet "grisekød".
    const res = (await request(app).get('/api/search').query({ q: 'hakket grisekød' }).expect(200)).body as SearchResponse;
    expect(res.items.some((i) => /grise- og kalvekød/.test(i.title))).toBe(true);
    // Kæderne skriver "gris", folk søger "svin".
    const svin = (await request(app).get('/api/search').query({ q: 'svin' }).expect(200)).body as SearchResponse;
    expect(svin.items.some((i) => /grise/i.test(i.title))).toBe(true);
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

    // Prishistorik er en betalt funktion – anonyme afvises, prøveperiode giver adgang.
    await request(app).get(`/api/products/${offer.productId}/history`).expect(401);
    const { token } = await member();
    const history = (
      await request(app).get(`/api/products/${offer.productId}/history`).set({ Authorization: `Bearer ${token}` }).expect(200)
    ).body as PriceHistoryResponse;
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
    const { token } = await member();
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

    // En anden bruger kan ikke se listen.
    const other = await member();
    await request(app).get(`/api/lists/${list.id}`).set({ Authorization: `Bearer ${other.token}` }).expect(404);
  });

  it('gæst kan opgradere til konto og beholde data; refresh roterer token', async () => {
    const g = await guest();
    const auth = { Authorization: `Bearer ${g.token}` };
    // Gæster får ingen prøveperiode – de skal oprette en konto.
    const denied = await request(app).post('/api/lists').set(auth).send({ name: 'Gæsteliste' }).expect(402);
    expect(denied.body.code).toBe('ACCOUNT_REQUIRED');
    // Data fra før betalingsmuren (gæstelister) bevares ved oprettelse af konto.
    await database.db.execute(sql`INSERT INTO shopping_lists (user_id, name) VALUES (${g.user.id}::uuid, 'Gæsteliste')`);
    await request(app)
      .post('/api/auth/register')
      .set(auth)
      .send({ email: 'Test@Example.dk', password: 'hemmelig123' })
      .expect(400); // betingelserne skal accepteres
    const reg = await request(app)
      .post('/api/auth/register')
      .set(auth)
      .send({ email: 'Test@Example.dk', password: 'hemmelig123', acceptTerms: true })
      .expect(201);
    const body = reg.body as AuthResponse;
    expect(body.user).toMatchObject({ id: g.user.id, email: 'test@example.dk', isGuest: false, emailVerified: false });
    expect(body.user.access).toMatchObject({ status: 'trial', hasAccess: true, trialDaysLeft: 14 });
    expect(body.user.termsVersion).toBeTruthy();
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
    // Uden cookie: ingen session, men heller ingen fejl.
    await request(app).post('/api/auth/refresh').expect(204);
  });

  it('watchlist giver notifikation når prisen er under grænsen', async () => {
    const { token } = await member();
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
    const a = await member();
    const b = await member();
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

  describe('kvitteringer', () => {
    const item = (name: string, amount: number, quantity = 1): ReceiptLine => ({
      kind: 'item',
      name,
      quantity,
      unit: 'stk',
      unitPrice: Math.round((amount / quantity) * 100) / 100,
      amount,
    });
    const discount = (amount: number, name = 'Rabat'): ReceiptLine => ({
      kind: 'discount',
      name,
      quantity: 1,
      unit: 'stk',
      unitPrice: null,
      amount: -amount,
    });
    /** Et ekstra avistilbud, der starter om `fromHours` timer. */
    const extraOffer = (storeId: string, id: string, title: string, price: number, description: string, fromHours: number) => {
      const [base] = json<Record<string, unknown>[]>('tjek-offers.json');
      return mapTjekOffer(
        {
          ...base,
          id,
          heading: title,
          description,
          pricing: { price, pre_price: null, currency: 'DKK' },
          run_from: iso(new Date(Date.now() + fromHours * 3_600_000)),
          run_till: iso(new Date(Date.now() + 7 * day)),
        },
        { storeId, sourceId: storeId, dealerSlug: storeId },
      )!;
    };

    it('kræver login', async () => {
      await request(app).get('/api/receipts').expect(401);
    });

    it('besøgsstatistik: sidevisning gemmes uden login, og admin ser overblikket', async () => {
      await request(app)
        .post('/api/analytics/pageview')
        .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')
        .send({ path: '/priser?utm_source=x', utmSource: 'instagram' })
        .expect(204);
      await request(app).post('/api/analytics/pageview').send({ path: 42 }).expect(400);
      const overview = (await request(app).get('/api/admin/overview?days=7').expect(200)).body;
      expect(overview.traffic.topPages).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/priser' })]));
      expect(overview.byDay).toHaveLength(7);
    });

    it('samme tilbud i to aviser fra samme kæde gemmes kun én gang', async () => {
      // Fx Lidls ugeavis og weekendavis: samme vare, pris og gyldighed – forskellige id'er.
      const first = extraOffer('lidl', 'ugeavis-roedbeder', 'Økologiske danske rødbeder', 9, '1 kg', -2);
      const second = { ...first, externalId: 'weekendavis-roedbeder', sourceUrl: `${first.sourceUrl}&p=2` };
      const stats = await ingestOffers(database.db, [first, second]);
      expect(stats).toMatchObject({ offersSaved: 1, duplicatesSkipped: 1 });
      // Næste scraping ændrer ikke på det.
      expect(await ingestOffers(database.db, [second, first])).toMatchObject({ offersSaved: 1, duplicatesSkipped: 1 });
      const rows = await query<{ n: number }>(
        database.db,
        sql`SELECT count(*)::int AS n FROM offers WHERE store_id = 'lidl' AND title = 'Økologiske danske rødbeder'`,
      );
      expect(rows[0]!.n).toBe(1);
    });

    it('forskellige tolkninger af mængden er stadig samme tilbud – men en anden størrelse er ikke', async () => {
      const base = extraOffer('lidl', 'croissant-ugeavis', 'TASTINO Smørcroissanter', 19.75, '6 x 60 g', -2);
      // Samme vare og pris pr. kg, men mængdeteksten er læst som 60 g i den ene avis og 360 g i den anden.
      const otherReading = { ...base, externalId: 'croissant-weekendavis', normalizedProductName: `${base.normalizedProductName} x6` };
      // Samme titel og pris, men en anden størrelse (anden kilopris) – det er en anden vare.
      const otherSize = { ...base, externalId: 'croissant-stor', unitPrice: (base.unitPrice ?? 50) * 0.75 };
      const stats = await ingestOffers(database.db, [base, otherReading, otherSize]);
      expect(stats).toMatchObject({ offersSaved: 2, duplicatesSkipped: 1 });
    });

    it('eksisterende dubletter ryddes op – vurderinger flyttes til det tilbud, der beholdes', async () => {
      const [keep] = await query<{ id: number }>(
        database.db,
        sql`SELECT id FROM offers WHERE store_id = 'lidl' AND title = 'Økologiske danske rødbeder'`,
      );
      // En dublet gemt før sorteringen fandtes (kopi af rækken med et andet eksternt id).
      const [dup] = await query<{ id: number }>(
        database.db,
        sql`INSERT INTO offers (store_id, source_id, external_id, product_id, title, description, normalized_name, brand, category,
              offer_price, original_price, unit, quantity_min, quantity_max, pieces, unit_price, unit_price_max, valid_from, valid_to,
              image_url, source_url)
            SELECT store_id, source_id, 'gammel-dublet', product_id, title, description, normalized_name, brand, category,
              offer_price, original_price, unit, quantity_min, quantity_max, pieces, unit_price, unit_price_max, valid_from, valid_to,
              image_url, source_url
            FROM offers WHERE id = ${keep!.id} RETURNING id`,
      );
      const { token } = await member();
      await request(app)
        .post(`/api/offers/${dup!.id}/reports`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ verdict: 'real' })
        .expect(201);

      expect(await removeDuplicateOffers(database.db)).toBe(1);
      const left = await query<{ id: number }>(database.db, sql`SELECT id FROM offers WHERE id IN (${keep!.id}, ${dup!.id})`);
      expect(left.map((r) => r.id)).toEqual([keep!.id]);
      const reports = await query<{ offer_id: number }>(database.db, sql`SELECT offer_id FROM community_reports WHERE offer_id = ${keep!.id}`);
      expect(reports).toHaveLength(1);
      expect(await removeDuplicateOffers(database.db)).toBe(0);
    });

    it('kæder med fælles varer kan gemmes samtidig', async () => {
      // føtex og Bilka har mange af de samme varer. Samtidige transaktioner gav deadlock i Postgres.
      const names = ['Colgate mundpleje', 'Lambi toiletpapir', 'Kims chips', 'Coca-Cola'];
      const batch = (storeId: string) => names.map((n, i) => extraOffer(storeId, `delt-${storeId}-${i}`, n, 10 + i, '1 stk.', -1));
      const [a, b] = await Promise.all([ingestOffers(database.db, batch('foetex')), ingestOffers(database.db, batch('bilka'))]);
      expect(a.offersSaved).toBe(names.length);
      expect(b.offersSaved).toBe(names.length);
      const shared = await query<{ n: number }>(
        database.db,
        sql`SELECT count(DISTINCT product_id)::int AS n FROM offers
            WHERE store_id IN ('foetex', 'bilka') AND title IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`,
      );
      expect(shared[0]!.n).toBe(names.length);
    });

    it('tjekker linjerne mod avisen, finder fejl og billigere kæder', async () => {
      const { token } = await member();
      const auth = { Authorization: `Bearer ${token}` };
      const lines: ReceiptLine[] = [
        item('HARBOE SODAVAND 1,5 L', 10, 2),
        item('SCHULSTAD BRØD', 18),
        item('VALLØ SLOTSÆG', 25),
        item('DANSK KYLLING', 35),
        item('AGURK', 8),
        item('TULIP BACON 5-PAK', 49.95),
        discount(10.95),
        { kind: 'deposit', name: 'PANT A', quantity: 1, unit: 'stk', unitPrice: null, amount: 1 },
      ];
      const body = { storeId: 'rema1000', purchasedAt: new Date().toISOString(), total: 136, lines, source: 'manual' };
      const check = (await request(app).post('/api/receipts').set(auth).send(body).expect(201)).body as ReceiptCheckDTO;

      expect(check.store?.id).toBe('rema1000');
      expect(check.totalMatches).toBe(true);
      expect(check.itemCount).toBe(6);
      const line = (re: RegExp) => check.items.find((i) => re.test(i.name))!;
      expect(line(/SODAVAND/).verdict).toBe('match');
      expect(line(/SLOTSÆG/).verdict).toBe('match');
      expect(line(/AGURK/).verdict).toBe('no_offer');
      // Avisen siger 15 kr – 18 kr er en mulig fejl.
      expect(line(/SCHULSTAD/)).toMatchObject({ verdict: 'overcharged', difference: 3 });
      expect(check.possibleErrors).toBe(1);
      expect(check.possibleRefund).toBe(3);
      // Netto havde kyllingen 10 % billigere samme dag.
      const kylling = line(/KYLLING/);
      expect(kylling.verdict).toBe('match');
      expect(kylling.cheaperElsewhere?.offer.store.id).toBe('netto');
      expect(kylling.cheaperElsewhere?.saving).toBe(3.5);
      expect(line(/BACON/).saved).toBe(10.95);
      expect(check.saved).toBeGreaterThanOrEqual(10.95);

      const overview = (await request(app).get('/api/receipts').set(auth).expect(200)).body as ReceiptOverviewDTO;
      expect(overview.receipts).toHaveLength(1);
      expect(overview.possibleRefund).toBe(3);
      expect(overview.totalSaved).toBe(check.saved);

      const again = (await request(app).get(`/api/receipts/${check.id}`).set(auth).expect(200)).body as ReceiptCheckDTO;
      expect(again.items.map((i) => i.verdict)).toEqual(check.items.map((i) => i.verdict));

      // Andre brugere kan ikke se kvitteringen.
      const other = await member();
      await request(app).get(`/api/receipts/${check.id}`).set({ Authorization: `Bearer ${other.token}` }).expect(404);

      await request(app).delete(`/api/receipts/${check.id}`).set(auth).expect(204);
      await request(app).get(`/api/receipts/${check.id}`).set(auth).expect(404);
    });

    it('app-priser: uden Lidl Plus er det ikke en fejl', async () => {
      await ingestOffers(database.db, [extraOffer('lidl', 'lidl-plus-1', 'Harboe sodavand', 5, '1,5 l. Pris med Lidl Plus', -24)]);
      const { token } = await member();
      const auth = { Authorization: `Bearer ${token}` };
      const send = (lines: ReceiptLine[]) =>
        request(app)
          .post('/api/receipts')
          .set(auth)
          .send({ storeId: 'lidl', purchasedAt: new Date().toISOString(), total: null, lines, source: 'manual' })
          .expect(201)
          .then((r) => r.body as ReceiptCheckDTO);

      const without = await send([item('Harboe sodavand 1,5 l', 14, 2)]);
      expect(without.items[0]).toMatchObject({ verdict: 'app_price', difference: 4 });
      expect(without.possibleErrors).toBe(0);
      expect(without.toCheck).toBe(1);

      const withApp = await send([item('Harboe sodavand 1,5 l', 14, 2), discount(4, 'Lidl Plus-tilbud')]);
      expect(withApp.items[0]).toMatchObject({ verdict: 'match', saved: 4 });
    });

    it('næste uges tilbud kan bekræfte en pris, men aldrig give en fejl', async () => {
      // Butikkerne starter tit ugens priser dagen før avisen – her om 20 timer.
      await ingestOffers(database.db, [extraOffer('rema1000', 'next-week-1', 'Vallø Slotsæg', 20, '6 stk.', 20)]);
      const { token } = await member();
      const auth = { Authorization: `Bearer ${token}` };
      const send = (amount: number) =>
        request(app)
          .post('/api/receipts')
          .set(auth)
          .send({
            storeId: 'rema1000',
            purchasedAt: new Date().toISOString(),
            total: null,
            lines: [item('VALLØ SLOTSÆG', amount)],
            source: 'manual',
          })
          .expect(201)
          .then((r) => r.body as ReceiptCheckDTO);

      expect((await send(20)).items[0]!.verdict).toBe('match');
      // 30 kr sammenlignes med den gældende pris (25), ikke med næste uges 20.
      expect((await send(30)).items[0]).toMatchObject({ verdict: 'overcharged', difference: 5 });
    });

    it('tolker indsat tekst fra en e-kvittering og afviser andet end billeder', async () => {
      const { token } = await member();
      const auth = { Authorization: `Bearer ${token}` };
      const text = 'NETTO\nRUGBRØD      18,00\nRABAT         5,00-\nTOTAL        13,00';
      const parsed = (await request(app).post('/api/receipts/parse-text').set(auth).send({ text }).expect(200)).body;
      expect(parsed).toMatchObject({ storeId: 'netto', total: 13, source: 'text' });
      expect(parsed.lines).toHaveLength(2);
      await request(app).post('/api/receipts/parse-text').set(auth).send({ text: '' }).expect(400);
      await request(app)
        .post('/api/receipts/scan')
        .set(auth)
        .set('Content-Type', 'image/jpeg')
        .send(Buffer.from('ikke et billede'))
        .expect(415);
    });
  });

  it('GDPR: sletning af konto fjerner brugerens data', async () => {
    const { token } = await member();
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/lists').set(auth).send({ name: 'Slet mig' }).expect(201);
    await request(app)
      .post('/api/receipts')
      .set(auth)
      .send({
        storeId: null,
        purchasedAt: null,
        total: null,
        lines: [{ kind: 'item', name: 'Agurk', quantity: 1, unit: 'stk', unitPrice: 8, amount: 8 }],
        source: 'manual',
      })
      .expect(201);
    const exported = await request(app).get('/api/auth/me/export').set(auth).expect(200);
    expect(exported.body.shoppingLists).toHaveLength(1);
    expect(exported.body.receipts).toHaveLength(1);
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
