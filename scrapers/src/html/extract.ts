import * as cheerio from 'cheerio';

/** Et produkt fundet i HTML – enten via JSON-LD eller CSS-selektorer. */
export interface HtmlProduct {
  name: string;
  description: string | null;
  price: number;
  originalPrice: number | null;
  imageUrl: string | null;
  url: string | null;
  sku: string | null;
  brand: string | null;
  validFrom: string | null;
  validTo: string | null;
  unitText: string | null;
}

type Json = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const hasType = (node: Json, type: string) => asArray(node['@type'] as string | string[]).some((t) => t === type);

/** "1.299,95 kr." → 1299.95 */
export function parseDanishPrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const token = text.replace(/\s/g, '').match(/\d[\d.,]*/)?.[0]?.replace(/[.,]+$/, '');
  if (!token) return null;
  let normalized: string;
  if (token.includes(',')) {
    normalized = token.replace(/\./g, '').replace(',', '.'); // 1.299,95
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) {
    normalized = token.replace(/\./g, ''); // 1.299
  } else {
    normalized = token; // 12.95 eller 129
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function imageOf(value: unknown): string | null {
  const first = asArray(value as unknown)[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') return str((first as Json).url) ?? str((first as Json).contentUrl);
  return null;
}

function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function productFromNode(node: Json, baseUrl: string): HtmlProduct | null {
  const name = str(node.name);
  if (!name) return null;
  const offers = asArray(node.offers as Json | Json[]);
  const offer = offers[0];
  if (!offer) return null;
  const priceRaw = offer.price ?? offer.lowPrice;
  const price = typeof priceRaw === 'number' ? priceRaw : parseDanishPrice(str(priceRaw));
  if (!price) return null;
  if (str(offer.priceCurrency) && str(offer.priceCurrency) !== 'DKK') return null;

  // Førpris angives typisk som priceSpecification med en "StrikethroughPrice".
  let originalPrice: number | null = null;
  for (const spec of asArray(offer.priceSpecification as Json | Json[])) {
    const kind = str(spec.priceType) ?? '';
    const value = typeof spec.price === 'number' ? spec.price : parseDanishPrice(str(spec.price));
    if (value && value > price && /strikethrough|listprice|msrp/i.test(kind)) originalPrice = value;
  }
  const brand = node.brand && typeof node.brand === 'object' ? str((node.brand as Json).name) : str(node.brand);
  const url = str(offer.url) ?? str(node.url);

  return {
    name,
    description: str(node.description),
    price,
    originalPrice,
    imageUrl: resolveUrl(imageOf(node.image), baseUrl),
    url: resolveUrl(url, baseUrl),
    sku: str(node.sku) ?? str(node.gtin13) ?? str(node.gtin) ?? str(node.productID),
    brand,
    validFrom: str(offer.validFrom),
    validTo: str(offer.priceValidUntil) ?? str(offer.validThrough),
    unitText: str(node.size) ?? str((node.weight as Json | undefined)?.value),
  };
}

function walk(node: unknown, visit: (n: Json) => void): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Json;
  visit(obj);
  if (obj['@graph']) walk(obj['@graph'], visit);
  if (obj.itemListElement) walk(obj.itemListElement, visit);
  if (obj.item) walk(obj.item, visit);
  if (obj.mainEntity) walk(obj.mainEntity, visit);
}

/** Finder alle schema.org Product-objekter i <script type="application/ld+json">. */
export function extractJsonLdProducts(html: string, baseUrl: string): HtmlProduct[] {
  const $ = cheerio.load(html);
  const products: HtmlProduct[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try {
      data = JSON.parse($(el).text());
    } catch {
      return;
    }
    walk(data, (n) => {
      if (hasType(n, 'Product')) {
        const p = productFromNode(n, baseUrl);
        if (p) products.push(p);
      }
    });
  });
  return products;
}

/** Konfiguration til sider uden strukturerede data. */
export interface SelectorConfig {
  item: string;
  name: string;
  price: string;
  originalPrice?: string;
  description?: string;
  image?: string;
  link?: string;
  unitText?: string;
  /** Attribut der indeholder et stabilt id (fx "data-product-id"). */
  idAttribute?: string;
}

export function extractWithSelectors(html: string, baseUrl: string, cfg: SelectorConfig): HtmlProduct[] {
  const $ = cheerio.load(html);
  const out: HtmlProduct[] = [];
  $(cfg.item).each((_, el) => {
    const $el = $(el);
    const text = (sel?: string) => (sel ? $el.find(sel).first().text().replace(/\s+/g, ' ').trim() || null : null);
    const name = text(cfg.name);
    const price = parseDanishPrice(text(cfg.price));
    if (!name || !price) return;
    const img = cfg.image ? $el.find(cfg.image).first() : null;
    const src = img?.attr('src') ?? img?.attr('data-src') ?? null;
    const href = cfg.link ? $el.find(cfg.link).first().attr('href') ?? null : null;
    const original = parseDanishPrice(text(cfg.originalPrice));
    out.push({
      name,
      description: text(cfg.description),
      price,
      originalPrice: original && original > price ? original : null,
      imageUrl: resolveUrl(src, baseUrl),
      url: resolveUrl(href, baseUrl),
      sku: cfg.idAttribute ? $el.attr(cfg.idAttribute) ?? null : null,
      brand: null,
      validFrom: null,
      validTo: null,
      unitText: text(cfg.unitText),
    });
  });
  return out;
}
