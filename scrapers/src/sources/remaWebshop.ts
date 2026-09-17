import type { CategoryId, RawRecord, ScrapedOffer } from '@tilbudsradar/shared';
import { z } from 'zod';
import { StructureChangedError } from '../errors';
import {
  categorize,
  coreName,
  detectBrand,
  normalizeProductName,
  parseQuantity,
  sentenceCase,
  unitFromSymbol,
} from '../normalize';
import type { ChainInfo, ParseContext, ScrapeContext, Scraper } from '../types';

/**
 * REMA 1000's webshop henter sine data fra et JSON-API, som robots.txt på
 * cphapp.rema1000.dk tillader. Vi bruger det til HYLDEPRISER (ikke tilbud),
 * så prishistorikken har et reelt sammenligningsgrundlag, når vi vurderer
 * om et avistilbud er en faktisk besparelse.
 */
export const REMA_API = 'https://cphapp.rema1000.dk/api/v3';
export const REMA_RAW_KIND = 'rema-product';

/** Afdelinger → fælles kategori (null = afgøres ud fra produktnavnet). */
export const REMA_DEPARTMENTS: Record<number, CategoryId | null> = {
  10: 'brod',
  20: 'frugt-gront',
  30: 'kod-fisk',
  40: null,
  50: 'frost',
  60: 'mejeri',
  70: 'mejeri',
  80: null,
  90: 'drikkevarer',
  100: 'husholdning',
  110: 'baby',
  120: 'pleje',
  130: 'snacks',
  140: 'andet',
  160: null,
};

const departmentSchema = z.object({ id: z.number(), name: z.string() });

const priceSchema = z.object({
  price: z.number(),
  price_over_max_quantity: z.number().nullish(),
  max_quantity: z.number().nullish(),
  is_advertised: z.boolean().nullish(),
  is_campaign: z.boolean().nullish(),
  starting_at: z.string(),
  ending_at: z.string(),
  deposit: z.number().nullish(),
  compare_unit: z.string().nullish(),
  compare_unit_price: z.number().nullish(),
});

const productSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  underline: z.string().nullish(),
  images: z.array(z.object({ small: z.string().nullish(), medium: z.string().nullish(), large: z.string().nullish() })).nullish(),
  prices: z.array(priceSchema).min(1),
});

const pageSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ pagination: z.object({ current_page: z.number(), last_page: z.number() }) }).optional(),
});

export class RemaWebshopClient {
  constructor(
    private readonly ctx: ScrapeContext,
    private readonly sourceId: string,
    private readonly base = REMA_API,
  ) {}

  async departments(): Promise<{ id: number; name: string }[]> {
    const body = await this.ctx.http.getJson(`${this.base}/departments`);
    const parsed = z.object({ data: z.array(departmentSchema) }).safeParse(body);
    if (!parsed.success) throw new StructureChangedError(this.sourceId, 'REMA-afdelinger har ændret format');
    return parsed.data.data;
  }

  async *products(departmentId: number): AsyncGenerator<unknown> {
    const maxPages = this.ctx.maxPages ?? 50;
    for (let page = 1; page <= maxPages; page++) {
      if (this.ctx.signal?.aborted) return;
      const body = await this.ctx.http.getJson(
        `${this.base}/departments/${departmentId}/products?per_page=100&page=${page}`,
      );
      const parsed = pageSchema.safeParse(body);
      if (!parsed.success) {
        throw new StructureChangedError(this.sourceId, `REMA-produktlisten (afdeling ${departmentId}) har ændret format`);
      }
      yield* parsed.data.data;
      const last = parsed.data.meta?.pagination.last_page ?? page;
      if (page >= last || parsed.data.data.length === 0) return;
    }
  }
}

const parseRemaDate = (value: string) => new Date(value);

export interface RemaParseOptions {
  storeId: string;
  sourceId: string;
  departmentId: number | null;
  now: Date;
}

/**
 * Omsætter et webshop-produkt til en hyldepris-observation (isBaseline).
 * Kampagnepriser springes over – de findes allerede i avisen.
 */
export function mapRemaProduct(input: unknown, opts: RemaParseOptions): ScrapedOffer | null {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return null;
  const p = parsed.data;
  const now = opts.now.getTime();

  const regular =
    p.prices.find((x) => !x.is_campaign && parseRemaDate(x.starting_at).getTime() <= now && parseRemaDate(x.ending_at).getTime() > now) ??
    p.prices.find((x) => !x.is_campaign);
  if (!regular || regular.price <= 0) return null;

  const [namePart, ...rest] = (p.underline ?? '').split('/');
  const extra = rest.join('/').trim();
  const fullText = `${p.name} ${extra}`;

  // Pakningsstørrelse: udled af sammenligningsprisen når den findes (mest præcist),
  // ellers fra underteksten ("400 GR.", "1 LTR.").
  const compare = unitFromSymbol(regular.compare_unit === 'sæt' ? 'stk' : regular.compare_unit);
  const textQty = parseQuantity(namePart) ?? parseQuantity(p.underline);
  let unit = textQty?.unit ?? 'stk';
  let amount = textQty ? (textQty.min + textQty.max) / 2 : 1;
  let unitPrice: number | null = null;
  if (compare && compare.factor === 1 && regular.compare_unit_price && regular.compare_unit_price > 0) {
    unit = compare.unit;
    unitPrice = regular.compare_unit_price;
    amount = Math.round((regular.price / regular.compare_unit_price) * 10000) / 10000;
  } else if (amount > 0) {
    unitPrice = Math.round((regular.price / amount) * 100) / 100;
  }

  const forced = opts.departmentId !== null ? (REMA_DEPARTMENTS[opts.departmentId] ?? null) : null;
  const title = extra ? `${sentenceCase(p.name)} · ${sentenceCase(extra)}` : sentenceCase(p.name);
  const image = p.images?.[0];

  return {
    storeId: opts.storeId,
    sourceId: opts.sourceId,
    externalId: `rema:${p.id}`,
    productName: title,
    normalizedProductName: normalizeProductName(fullText, { unit, amount }),
    category: categorize(fullText, { forced, fallback: 'kolonial' }),
    originalPrice: null,
    offerPrice: regular.price,
    unit,
    validFrom: parseRemaDate(regular.starting_at),
    validTo: parseRemaDate(regular.ending_at),
    imageUrl: image?.large ?? image?.medium ?? image?.small ?? null,
    sourceUrl: `https://shop.rema1000.dk/varer/${p.id}`,
    description: p.underline?.trim() || null,
    brand: detectBrand(fullText) ?? (coreName(extra) ? extra.toLowerCase() : null),
    quantity: { min: amount, max: amount },
    pieces: 1,
    unitPrice,
    unitPriceMax: unitPrice,
    isBaseline: true,
  };
}

export function createRemaWebshopScraper(chain: ChainInfo): Scraper {
  const sourceId = `${chain.id}-webshop`;
  return {
    id: sourceId,
    chain,
    kind: 'webshop',
    description: `${chain.name}s webshop-API – normale hyldepriser til prishistorik`,
    parses: [REMA_RAW_KIND],

    async *fetch(ctx) {
      const client = new RemaWebshopClient(ctx, sourceId);
      const departments = await client.departments();
      if (!departments.length) throw new StructureChangedError(sourceId, 'REMA returnerede ingen afdelinger');
      for (const dep of departments) {
        for await (const product of client.products(dep.id)) {
          const id = (product as { id?: unknown })?.id;
          yield {
            sourceId,
            externalId: `rema:${String(id)}`,
            kind: REMA_RAW_KIND,
            payload: product,
            context: { departmentId: dep.id, department: dep.name },
          } satisfies RawRecord;
        }
      }
    },

    parse(raw: RawRecord, ctx: ParseContext) {
      if (raw.kind !== REMA_RAW_KIND) return [];
      const depId = raw.context?.departmentId;
      const offer = mapRemaProduct(raw.payload, {
        storeId: chain.id,
        sourceId,
        departmentId: typeof depId === 'number' ? depId : null,
        now: ctx.now,
      });
      return offer ? [offer] : [];
    },
  };
}
