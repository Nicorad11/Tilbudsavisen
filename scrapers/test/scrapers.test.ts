import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RawRecord } from '@tilbudsradar/shared';
import { describe, expect, it } from 'vitest';
import { rema1000, rema1000Chain, rema1000Webshop } from '../src/chains/rema1000';
import { extractJsonLdProducts, extractWithSelectors, parseDanishPrice } from '../src/html/extract';
import { createHtmlScraper, htmlProductToOffer } from '../src/html/htmlScraper';
import { HttpClient, type FetchLike } from '../src/http/client';
import { HostRateLimiter } from '../src/http/rateLimiter';
import { silentLogger } from '../src/log';
import { runScraper } from '../src/runner';
import { mapRemaProduct } from '../src/sources/remaWebshop';
import { mapTjekOffer, parseTjekDate } from '../src/sources/tjek';
import type { ScrapeContext, Scraper } from '../src/types';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
const json = <T = unknown>(name: string) => JSON.parse(fixture(name)) as T;

const NOW = new Date('2026-09-15T12:00:00Z');

function contextWith(routes: Record<string, () => Response>): ScrapeContext {
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return handler();
    }
    return Response.json([]);
  };
  const sleep = async () => {};
  const limiter = new HostRateLimiter({ minDelayMs: 0, maxDelayMs: 0, maxPerMinute: 1000 }, sleep);
  return {
    http: new HttpClient({ userAgent: 'TilbudsRadar/test', limiter, fetch: fetchImpl, sleep, maxRetries: 0 }),
    log: silentLogger,
    now: NOW,
    geo: { lat: 55.68, lng: 12.57 },
  };
}

describe('Tjek-parser', () => {
  const offers = json<unknown[]>('tjek-offers.json');
  const parse = (i: number) =>
    mapTjekOffer(offers[i], { storeId: 'rema1000', sourceId: 'rema1000', dealerSlug: 'REMA-1000', catalogId: 'rnfuOoGl' });

  it('læser Tjeks datoformat med "+0000"', () => {
    expect(parseTjekDate('2026-09-12T22:00:00+0000').toISOString()).toBe('2026-09-12T22:00:00.000Z');
  });

  it('omsætter et tilbud til standardformatet', () => {
    const o = parse(0)!;
    expect(o).toMatchObject({
      storeId: 'rema1000',
      offerPrice: 29,
      originalPrice: null,
      unit: 'kg',
      unitPrice: 72.5,
      category: 'kod-fisk',
      externalId: 'tjek:0BZn4ZclArE7Nl15DE_vB',
      brand: 'rema 1000',
    });
    expect(o.normalizedProductName.endsWith(' 400g')).toBe(true);
    expect(o.validFrom.toISOString()).toBe('2026-09-12T22:00:00.000Z');
    expect(o.validTo.toISOString()).toBe('2026-09-19T21:59:59.000Z');
    expect(o.sourceUrl).toBe('https://etilbudsavis.dk/REMA-1000?publication=rnfuOoGl&page=3');
    expect(o.imageUrl).toMatch(/^https:\/\/image-transformer-api\.tjek\.com\//);
  });

  it.each([
    ['Vallø Slotsæg', 'stk', 4.17, 'slotsæg 6stk'],
    ['REMA 1000 Ribbenssteg eller nakkefilet', 'kg', 49.9, 'ribbenssteg nakkefilet 500g'],
    ['Tuborg eller Carlsberg øl', 'l', 12.12, 'øl 33cl'],
    ['Harboe sodavand', 'l', 3.33, 'sodavand 1.5l'],
  ])('beregner enhedspris for %s', (heading, unit, unitPrice, normalized) => {
    const raw = offers.find((o) => (o as { heading?: string }).heading === heading);
    const o = mapTjekOffer(raw, { storeId: 'rema1000', sourceId: 'rema1000', dealerSlug: 'REMA-1000' })!;
    expect(o.unit).toBe(unit);
    expect(o.unitPrice).toBeCloseTo(unitPrice, 2);
    expect(o.normalizedProductName).toBe(normalized);
  });

  it('bruger mindste pakning til "max pr. kg" ved intervaller', () => {
    const raw = offers.find((o) => (o as { heading?: string }).heading === 'Dansk kylling');
    const o = mapTjekOffer(raw, { storeId: 'rema1000', sourceId: 'rema1000', dealerSlug: 'REMA-1000' })!;
    expect(o.quantity).toEqual({ min: 0.75, max: 1.3 });
    expect(o.unitPriceMax).toBe(46.67); // står i avisen som "Max. 46.67 pr. kg"
    expect(o.normalizedProductName).toBe('kylling');
  });

  it('bevarer førprisen når den er højere end tilbudsprisen', () => {
    const raw = offers.find((o) => (o as { pricing?: { pre_price?: number } }).pricing?.pre_price);
    const o = mapTjekOffer(raw, { storeId: 'rema1000', sourceId: 'rema1000', dealerSlug: 'REMA-1000' })!;
    expect(o.offerPrice).toBe(39);
    expect(o.originalPrice).toBe(49.95);
  });

  it('afviser records uden pris/overskrift i stedet for at crashe', () => {
    expect(parse(offers.length - 1)).toBeNull();
    expect(mapTjekOffer(null, { storeId: 'x', sourceId: 'x', dealerSlug: 'x' })).toBeNull();
  });
});

describe('REMA-scraper (avis via Tjek) end-to-end med fixtures', () => {
  it('henter aktive aviser, paginerer og validerer', async () => {
    const requested: string[] = [];
    const ctx = contextWith({
      'https://squid-api.tjek.com/v2/catalogs': () => Response.json(json('tjek-catalogs.json')),
      'https://squid-api.tjek.com/v2/offers?catalog_ids=rnfuOoGl&': () => Response.json(json('tjek-offers.json')),
    });
    const origGet = ctx.http.getJson.bind(ctx.http);
    ctx.http.getJson = async <T,>(url: string) => {
      requested.push(url);
      return origGet<T>(url);
    };

    const saved: RawRecord[] = [];
    const result = await runScraper(rema1000, ctx, { onRawBatch: async (b) => void saved.push(...b) });

    expect(result.status).toBe('success');
    expect(result.rawCount).toBe(10);
    expect(result.offers).toHaveLength(9);
    expect(result.rejected).toBe(1);
    expect(saved).toHaveLength(10);
    // "Meget mere sæson" har 0 tilbud og springes over; 3 aviser hentes.
    expect(requested.filter((u) => u.includes('/offers?'))).toHaveLength(3);
    expect(new Set(result.offers.map((o) => o.category))).toContain('drikkevarer');
  });

  it('markerer en strukturændring når API’et svarer med noget uventet', async () => {
    const ctx = contextWith({
      'https://squid-api.tjek.com/v2/catalogs': () => Response.json({ code: 1500, message: 'Invalid' }),
    });
    const result = await runScraper(rema1000, ctx);
    expect(result.status).toBe('failed');
    expect(result.errorKind).toBe('StructureChangedError');
    expect(result.error).toMatch(/Invalid/);
  });
});

describe('REMA webshop (hyldepriser)', () => {
  const products = json<{ data: unknown[] }>('rema-products.json').data;
  const byName = (name: string) => products.find((p) => (p as { name: string }).name === name);

  it('bruger den normale pris – ikke kampagneprisen – som baseline', () => {
    const o = mapRemaProduct(byName('HK. OKSEKØD, 35% GRØNT'), {
      storeId: 'rema1000',
      sourceId: 'rema1000-webshop',
      departmentId: 30,
      now: NOW,
    })!;
    expect(o).toMatchObject({ isBaseline: true, offerPrice: 29.95, unit: 'kg', unitPrice: 74.88, category: 'kod-fisk' });
    expect(o.quantity?.min).toBeCloseTo(0.4, 3);
    expect(o.productName).toBe('Hk. oksekød, 35% grønt · Rema 1000');
    expect(o.normalizedProductName).toBe('hakket oksekød 35% grønt 400g');
  });

  it('bruger afdelingens kategori og liter som enhed', () => {
    const o = mapRemaProduct(byName('HAVREDRIK'), {
      storeId: 'rema1000',
      sourceId: 'rema1000-webshop',
      departmentId: 90,
      now: NOW,
    })!;
    expect(o).toMatchObject({ unit: 'l', unitPrice: 11.95, category: 'drikkevarer', brand: 'plantekøkkenet' });
  });

  it('webshop-scraperen gennemgår afdelinger og sider', async () => {
    const ctx = contextWith({
      'https://cphapp.rema1000.dk/api/v3/departments/30/products': () => Response.json(json('rema-products.json')),
      'https://cphapp.rema1000.dk/api/v3/departments': () =>
        Response.json({ data: [{ id: 30, name: 'Kød, fisk & fjerkræ' }] }),
    });
    const result = await runScraper(rema1000Webshop, ctx);
    expect(result.status).toBe('success');
    expect(result.offers).toHaveLength(5);
    expect(result.offers.every((o) => o.isBaseline)).toBe(true);
  });
});

describe('HTML-strategier', () => {
  it('parser danske priser', () => {
    expect(parseDanishPrice('1.299,95 kr.')).toBe(1299.95);
    expect(parseDanishPrice('12.95')).toBe(12.95);
    expect(parseDanishPrice('29,-')).toBe(29);
    expect(parseDanishPrice('1.099')).toBe(1099);
    expect(parseDanishPrice('kr 5')).toBe(5);
    expect(parseDanishPrice('gratis')).toBeNull();
  });

  it('finder produkter i schema.org JSON-LD (også i @graph/ItemList)', () => {
    const products = extractJsonLdProducts(fixture('jsonld-offers.html'), 'https://testbutik.dk/tilbud');
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      name: 'Arla Letmælk 1 liter',
      price: 9.95,
      originalPrice: 13.5,
      url: 'https://testbutik.dk/varer/letmaelk',
      imageUrl: 'https://testbutik.dk/img/letmaelk.jpg',
      brand: 'Arla',
      sku: 'TB-1001',
    });
    const offer = htmlProductToOffer(products[0]!, {
      chain: rema1000Chain,
      sourceId: 'test-html',
      pageUrl: 'https://testbutik.dk/tilbud',
      now: NOW,
      defaultValidDays: 7,
    })!;
    expect(offer).toMatchObject({ unit: 'l', unitPrice: 9.95, category: 'mejeri', brand: 'arla', normalizedProductName: 'letmælk 1l' });
    expect(offer.validTo.getUTCFullYear()).toBe(2099);
  });

  it('bruger CSS-selektorer som fallback', () => {
    const products = extractWithSelectors(fixture('selector-offers.html'), 'https://testbutik.dk/', {
      item: '.offer-card',
      name: '.offer-title',
      price: '.offer-price',
      originalPrice: '.offer-before',
      unitText: '.offer-meta',
      image: '.offer-img',
      link: '.offer-link',
      idAttribute: 'data-product-id',
    });
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      name: 'Økologiske bananer',
      price: 15,
      originalPrice: 20,
      imageUrl: 'https://testbutik.dk/img/bananer.webp',
      url: 'https://testbutik.dk/tilbud/bananer',
      sku: 'A-1',
    });
    const kaffe = htmlProductToOffer(products[1]!, {
      chain: rema1000Chain,
      sourceId: 'test-html',
      pageUrl: 'https://testbutik.dk/',
      now: NOW,
      defaultValidDays: 7,
    })!;
    expect(kaffe).toMatchObject({ offerPrice: 1099, unit: 'kg', pieces: 2, unitPrice: 1373.75 });
  });

  it('en HTML-scraper uden fund rapporterer strukturændring', async () => {
    const ctx = contextWith({
      'https://testbutik.dk/tilbud': () => new Response('<html><body>Ny side</body></html>', { headers: { 'content-type': 'text/html' } }),
    });
    const scraper = createHtmlScraper({ chain: rema1000Chain, urls: ['https://testbutik.dk/tilbud'], strategy: 'jsonld' });
    const result = await runScraper(scraper, ctx);
    expect(result.status).toBe('failed');
    expect(result.errorKind).toBe('StructureChangedError');
  });
});

describe('runner-isolation', () => {
  const base = { chain: rema1000Chain, kind: 'api' as const, description: 'test', parses: ['x'] };

  it('en scraper der kaster, stopper ikke kørslen', async () => {
    const broken: Scraper = {
      ...base,
      id: 'kaput',
      async *fetch() {
        throw new Error('Siden er nede');
      },
      parse: () => [],
    };
    const result = await runScraper(broken, contextWith({}));
    expect(result).toMatchObject({ status: 'failed', error: 'Siden er nede', offers: [] });
  });

  it('for mange ulæselige records markeres som mulig strukturændring', async () => {
    const garbage: Scraper = {
      ...base,
      id: 'skrald',
      async *fetch() {
        for (let i = 0; i < 20; i++) yield { sourceId: 'skrald', externalId: `x${i}`, kind: 'x', payload: { foo: i } };
      },
      parse: () => [],
    };
    const result = await runScraper(garbage, contextWith({}));
    expect(result.status).toBe('failed');
    expect(result.errorKind).toBe('StructureChangedError');
    expect(result.rejected).toBe(20);
  });
});
