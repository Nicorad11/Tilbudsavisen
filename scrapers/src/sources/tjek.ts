import type { CategoryId, RawRecord, ScrapedOffer, StoreLocationInput } from '@tilbudsradar/shared';
import { FOOD_CATEGORIES, discountPct } from '@tilbudsradar/shared';
import { z } from 'zod';
import { StructureChangedError } from '../errors';
import {
  categorize,
  computeUnitPrice,
  detectBrand,
  normalizeProductName,
  parseQuantity,
  unitFromSymbol,
  type ParsedQuantity,
} from '../normalize';
import type { ChainInfo, ParseContext, ScrapeContext, Scraper } from '../types';

/**
 * Tjek (tidl. eTilbudsavis) har et offentligt JSON-API med alle danske
 * tilbudsaviser. Det bruges som primær kilde, fordi data er strukturerede
 * (pris, førpris, mængde med SI-faktor, gyldighed) og det er langt mere
 * robust – og skånsomt – end at scrape kædernes egne HTML-sider.
 */
export const TJEK_API = 'https://squid-api.tjek.com/v2';
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

/* ---------- Skemaer: løse, men fanger strukturændringer ---------- */

const catalogSchema = z.object({
  id: z.string(),
  dealer_id: z.string(),
  label: z.string().nullish(),
  run_from: z.string(),
  run_till: z.string(),
  offer_count: z.number().nullish(),
});
export type TjekCatalog = z.infer<typeof catalogSchema>;

const offerSchema = z.object({
  id: z.string(),
  heading: z.string().min(1),
  description: z.string().nullish(),
  catalog_page: z.number().nullish(),
  catalog_id: z.string().nullish(),
  pricing: z.object({
    price: z.number().nullable(),
    pre_price: z.number().nullish(),
    currency: z.string().nullish(),
  }),
  quantity: z
    .object({
      unit: z
        .object({
          symbol: z.string().nullish(),
          si: z.object({ symbol: z.string().nullish(), factor: z.number().nullish() }).nullish(),
        })
        .nullish(),
      size: z.object({ from: z.number().nullish(), to: z.number().nullish() }).nullish(),
      pieces: z
        .object({ from: z.number().nullish(), to: z.number().nullish(), max: z.number().nullish() })
        .nullish(),
    })
    .nullish(),
  images: z
    .object({ thumb: z.string().nullish(), view: z.string().nullish(), zoom: z.string().nullish() })
    .nullish(),
  run_from: z.string(),
  run_till: z.string(),
  dealer_id: z.string(),
  dealer: z.object({ markets: z.array(z.object({ slug: z.string() })).nullish() }).nullish(),
});
export type TjekOffer = z.infer<typeof offerSchema>;

const storeSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  street: z.string().nullish(),
  city: z.string().nullish(),
  zip_code: z.string().nullish(),
  latitude: z.number(),
  longitude: z.number(),
  dealer_id: z.string(),
});

/** Tjek bruger "+0000" uden kolon – det accepteres ikke af alle parsere. */
export function parseTjekDate(value: string): Date {
  return new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

function expectArray(value: unknown, sourceId: string, what: string): unknown[] {
  if (!Array.isArray(value)) {
    const hint = value && typeof value === 'object' && 'message' in value ? ` (${String((value as { message: unknown }).message)})` : '';
    throw new StructureChangedError(sourceId, `Forventede en liste af ${what} fra Tjek-API'et${hint}`);
  }
  return value;
}

/* ---------- Klient ---------- */

export class TjekClient {
  constructor(
    private readonly ctx: ScrapeContext,
    private readonly sourceId: string,
    private readonly base = TJEK_API,
  ) {}

  async catalogs(dealerId: string): Promise<TjekCatalog[]> {
    const url = `${this.base}/catalogs?dealer_ids=${encodeURIComponent(dealerId)}&limit=${PAGE_SIZE}`;
    const data = expectArray(await this.ctx.http.getJson(url), this.sourceId, 'aviser');
    const result: TjekCatalog[] = [];
    for (const item of data) {
      const parsed = catalogSchema.safeParse(item);
      if (parsed.success) result.push(parsed.data);
      else this.ctx.log.warn('Ukendt katalogformat – springes over', { issues: parsed.error.issues.slice(0, 3) });
    }
    if (data.length && !result.length) {
      throw new StructureChangedError(this.sourceId, 'Ingen aviser kunne læses – Tjek-API-formatet er ændret');
    }
    return result;
  }

  async *offers(catalogId: string): AsyncGenerator<unknown> {
    const maxPages = this.ctx.maxPages ?? MAX_PAGES;
    for (let page = 0; page < maxPages; page++) {
      if (this.ctx.signal?.aborted) return;
      const url = `${this.base}/offers?catalog_ids=${encodeURIComponent(catalogId)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const data = expectArray(await this.ctx.http.getJson(url), this.sourceId, 'tilbud');
      yield* data;
      if (data.length < PAGE_SIZE) return;
    }
  }

  async *stores(dealerId: string): AsyncGenerator<z.infer<typeof storeSchema>> {
    for (let page = 0; page < 40; page++) {
      if (this.ctx.signal?.aborted) return;
      const url = `${this.base}/stores?dealer_ids=${encodeURIComponent(dealerId)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const data = expectArray(await this.ctx.http.getJson(url), this.sourceId, 'butikker');
      for (const item of data) {
        const parsed = storeSchema.safeParse(item);
        if (parsed.success) yield parsed.data;
      }
      if (data.length < PAGE_SIZE) return;
    }
  }
}

/* ---------- Parsing ---------- */

export function tjekQuantity(offer: TjekOffer): ParsedQuantity | null {
  const q = offer.quantity;
  const from = q?.size?.from ?? 0;
  const to = q?.size?.to ?? from;
  const symbol = q?.unit?.symbol;
  const si = q?.unit?.si;
  const pieces = Math.max(1, q?.pieces?.from ?? 1);
  if (symbol && from > 0) {
    const def = unitFromSymbol(si?.symbol ?? symbol) ?? unitFromSymbol(symbol);
    if (def) {
      const factor = si?.factor ?? unitFromSymbol(symbol)?.factor ?? 1;
      const a = from * factor;
      const b = (to > 0 ? to : from) * factor;
      return { unit: def.unit, min: Math.min(a, b), max: Math.max(a, b), pieces };
    }
  }
  const parsed = parseQuantity(offer.description) ?? parseQuantity(offer.heading);
  return parsed ? { ...parsed, pieces: Math.max(parsed.pieces, pieces) } : null;
}

export interface TjekParseOptions {
  storeId: string;
  sourceId: string;
  dealerSlug: string;
  catalogId?: string | null;
  catalogLabel?: string | null;
  defaultCategory?: CategoryId;
  /** Byggemarked/elektronik: madkategorier er næsten altid fejlklassificering. */
  nonFoodChain?: boolean;
}

const NON_FOOD_CATALOG = /non-?food|elektronik|bolig|have|tekstil|tøj|legetøj|halloween|prosonic|ud af huset/i;

export function mapTjekOffer(input: unknown, opts: TjekParseOptions): ScrapedOffer | null {
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) return null;
  const o = parsed.data;
  const price = o.pricing.price;
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  if (o.pricing.currency && o.pricing.currency !== 'DKK') return null;

  const validFrom = parseTjekDate(o.run_from);
  const validTo = parseTjekDate(o.run_till);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) return null;

  const qty = tjekQuantity(o);
  const unit = qty?.unit ?? 'stk';
  const quantity = qty ? { min: qty.min, max: qty.max } : { min: 1, max: 1 };
  const pieces = qty?.pieces ?? 1;
  const { unitPrice, unitPriceMax } = computeUnitPrice(price, quantity, pieces);

  const prePrice = o.pricing.pre_price ?? null;
  const originalPrice = prePrice && discountPct(price, prePrice) !== null ? prePrice : null;

  const nonFood = Boolean(opts.catalogLabel && NON_FOOD_CATALOG.test(opts.catalogLabel));
  let category = categorize(o.heading, { secondary: o.description, fallback: opts.defaultCategory ?? 'andet' });
  if (opts.nonFoodChain && FOOD_CATEGORIES.includes(category)) category = opts.defaultCategory ?? 'andet';
  else if (nonFood && FOOD_CATEGORIES.includes(category) && category !== 'snacks') category = 'andet';

  const slug = o.dealer?.markets?.[0]?.slug ?? opts.dealerSlug;
  const catalogId = o.catalog_id ?? opts.catalogId ?? '';
  const sourceUrl =
    `https://etilbudsavis.dk/${encodeURIComponent(slug)}` +
    (catalogId ? `?publication=${encodeURIComponent(catalogId)}${o.catalog_page ? `&page=${o.catalog_page}` : ''}` : '');

  return {
    storeId: opts.storeId,
    sourceId: opts.sourceId,
    externalId: `tjek:${o.id}`,
    productName: o.heading.trim(),
    normalizedProductName: normalizeProductName(
      o.heading,
      qty && qty.min === qty.max ? { unit, amount: qty.min } : null,
    ),
    category,
    originalPrice,
    offerPrice: price,
    unit,
    validFrom,
    validTo,
    imageUrl: o.images?.zoom ?? o.images?.view ?? o.images?.thumb ?? null,
    sourceUrl,
    description: o.description?.trim() || null,
    brand: detectBrand(o.heading),
    quantity,
    pieces,
    unitPrice,
    unitPriceMax,
    maxPerCustomer: o.quantity?.pieces?.max ?? null,
  };
}

/* ---------- Fabrik: én scraper pr. kæde ---------- */

export interface TjekChainOptions {
  chain: ChainInfo;
  dealerId: string;
  dealerSlug: string;
  defaultCategory?: CategoryId;
  /** Hvor mange dage frem kommende aviser medtages. */
  lookaheadDays?: number;
}

export const TJEK_RAW_KIND = 'tjek-offer';

export function createTjekScraper(opts: TjekChainOptions): Scraper {
  const sourceId = opts.chain.id;
  const lookaheadMs = (opts.lookaheadDays ?? 8) * 24 * 60 * 60 * 1000;

  return {
    id: sourceId,
    chain: opts.chain,
    kind: 'api',
    description: `${opts.chain.name}s tilbudsaviser via Tjek/eTilbudsavis-API'et`,
    parses: [TJEK_RAW_KIND],
    emptyIsOk: true,

    async *fetch(ctx) {
      const client = new TjekClient(ctx, sourceId);
      const now = ctx.now.getTime();
      const catalogs = (await client.catalogs(opts.dealerId)).filter((c) => {
        const from = parseTjekDate(c.run_from).getTime();
        const till = parseTjekDate(c.run_till).getTime();
        return till > now && from <= now + lookaheadMs && (c.offer_count ?? 1) > 0;
      });
      ctx.log.info(`${catalogs.length} aktive/kommende aviser`, { catalogs: catalogs.map((c) => c.label ?? c.id) });

      const seen = new Set<string>();
      for (const catalog of catalogs) {
        for await (const offer of client.offers(catalog.id)) {
          const id = (offer as { id?: unknown })?.id;
          if (typeof id === 'string') {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          yield {
            sourceId,
            externalId: typeof id === 'string' ? `tjek:${id}` : `tjek:ukendt:${seen.size}`,
            kind: TJEK_RAW_KIND,
            payload: offer,
            context: { catalogId: catalog.id, catalogLabel: catalog.label ?? null },
          };
        }
      }
    },

    parse(raw: RawRecord, _ctx: ParseContext) {
      if (raw.kind !== TJEK_RAW_KIND) return [];
      const offer = mapTjekOffer(raw.payload, {
        storeId: opts.chain.id,
        sourceId,
        dealerSlug: opts.dealerSlug,
        catalogId: (raw.context?.catalogId as string | null | undefined) ?? null,
        catalogLabel: (raw.context?.catalogLabel as string | null | undefined) ?? null,
        defaultCategory: opts.defaultCategory,
        nonFoodChain: opts.chain.category !== 'supermarked',
      });
      return offer ? [offer] : [];
    },

    async *fetchStores(ctx) {
      const client = new TjekClient(ctx, sourceId);
      for await (const s of client.stores(opts.dealerId)) {
        yield {
          storeId: opts.chain.id,
          externalId: s.id,
          name: s.name ?? opts.chain.name,
          street: s.street ?? null,
          city: s.city ?? null,
          zipCode: s.zip_code ?? null,
          latitude: s.latitude,
          longitude: s.longitude,
        } satisfies StoreLocationInput;
      }
    },
  };
}
