import type { CategoryId, RawRecord, ScrapedOffer } from '@tilbudsradar/shared';
import { StructureChangedError } from '../errors';
import { categorize, computeUnitPrice, detectBrand, normalizeProductName, parseQuantity } from '../normalize';
import type { ChainInfo, ParseContext, ScrapeContext, Scraper } from '../types';
import { extractJsonLdProducts, extractWithSelectors, type HtmlProduct, type SelectorConfig } from './extract';

export const HTML_RAW_KIND = 'html-product';

/**
 * Henter en side. Standard er en almindelig HTTP-request (via den
 * ansvarlige klient). Til JavaScript-renderede sider kan `renderer: 'browser'`
 * bruges – det kræver at `playwright` er installeret (valgfrit).
 */
async function fetchPage(ctx: ScrapeContext, url: string, renderer: 'static' | 'browser'): Promise<string> {
  if (renderer === 'static') return ctx.http.getText(url);
  if (!(await ctx.http.isAllowed(url))) throw new Error(`robots.txt tillader ikke ${url}`);
  const moduleName = 'playwright';
  let pw: { chromium: { launch(): Promise<{ newPage(o?: unknown): Promise<unknown>; close(): Promise<void> }> } };
  try {
    pw = (await import(/* @vite-ignore */ moduleName)) as typeof pw;
  } catch {
    throw new Error('renderer "browser" kræver playwright: npm i -w scrapers playwright && npx playwright install chromium');
  }
  const host = new URL(url).host;
  return ctx.http.limiter.schedule(host, async () => {
    const browser = await pw.chromium.launch();
    try {
      const page = (await browser.newPage({ userAgent: ctx.http.userAgent })) as {
        goto(u: string, o: unknown): Promise<unknown>;
        content(): Promise<string>;
      };
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      return await page.content();
    } finally {
      await browser.close();
    }
  });
}

export interface HtmlScraperOptions {
  chain: ChainInfo;
  /** Sider med tilbud, fx kædens "ugens tilbud"-side. */
  urls: string[];
  strategy: 'jsonld' | { selectors: SelectorConfig };
  renderer?: 'static' | 'browser';
  /** Hvor længe tilbuddene gælder, hvis siden ikke oplyser det. */
  defaultValidDays?: number;
  defaultCategory?: CategoryId;
}

export function htmlProductToOffer(
  product: HtmlProduct,
  opts: { chain: ChainInfo; sourceId: string; pageUrl: string; now: Date; defaultValidDays: number; defaultCategory?: CategoryId },
): ScrapedOffer | null {
  if (!product.name || !(product.price > 0)) return null;
  const qty = parseQuantity(product.unitText) ?? parseQuantity(product.description) ?? parseQuantity(product.name);
  const unit = qty?.unit ?? 'stk';
  const quantity = qty ? { min: qty.min, max: qty.max } : { min: 1, max: 1 };
  const { unitPrice, unitPriceMax } = computeUnitPrice(product.price, quantity, qty?.pieces ?? 1);
  const validFrom = product.validFrom ? new Date(product.validFrom) : opts.now;
  const validTo = product.validTo
    ? new Date(product.validTo)
    : new Date(opts.now.getTime() + opts.defaultValidDays * 24 * 60 * 60 * 1000);
  const idPart = product.sku ?? product.url ?? `${product.name}|${product.price}`;
  return {
    storeId: opts.chain.id,
    sourceId: opts.sourceId,
    externalId: `html:${idPart}`,
    productName: product.name,
    normalizedProductName: normalizeProductName(
      product.name,
      qty && qty.min === qty.max ? { unit, amount: qty.min } : null,
    ),
    category: categorize(product.name, { secondary: product.description, fallback: opts.defaultCategory ?? 'andet' }),
    originalPrice: product.originalPrice,
    offerPrice: product.price,
    unit,
    validFrom: Number.isNaN(validFrom.getTime()) ? opts.now : validFrom,
    validTo: Number.isNaN(validTo.getTime()) ? opts.now : validTo,
    imageUrl: product.imageUrl,
    sourceUrl: product.url ?? opts.pageUrl,
    description: product.description,
    brand: product.brand?.toLowerCase() ?? detectBrand(product.name),
    quantity,
    pieces: qty?.pieces ?? 1,
    unitPrice,
    unitPriceMax,
  };
}

/** Generisk HTML-scraper til kæder uden API. */
export function createHtmlScraper(opts: HtmlScraperOptions): Scraper {
  const sourceId = `${opts.chain.id}-html`;
  const renderer = opts.renderer ?? 'static';
  return {
    id: sourceId,
    chain: opts.chain,
    kind: 'html',
    description: `${opts.chain.name} – HTML (${opts.strategy === 'jsonld' ? 'schema.org JSON-LD' : 'CSS-selektorer'})`,
    parses: [HTML_RAW_KIND],

    async *fetch(ctx) {
      for (const url of opts.urls) {
        const html = await fetchPage(ctx, url, renderer);
        const products =
          opts.strategy === 'jsonld'
            ? extractJsonLdProducts(html, url)
            : extractWithSelectors(html, url, opts.strategy.selectors);
        if (!products.length) {
          // Siden svarede, men vi fandt intet: sandsynligvis ændret HTML-struktur.
          throw new StructureChangedError(sourceId, `Ingen produkter fundet på ${url} – er sidens struktur ændret?`);
        }
        for (const product of products) {
          yield {
            sourceId,
            externalId: `html:${product.sku ?? product.url ?? product.name}`,
            kind: HTML_RAW_KIND,
            payload: product,
            context: { pageUrl: url },
          } satisfies RawRecord;
        }
      }
    },

    parse(raw: RawRecord, ctx: ParseContext) {
      if (raw.kind !== HTML_RAW_KIND) return [];
      const offer = htmlProductToOffer(raw.payload as HtmlProduct, {
        chain: opts.chain,
        sourceId,
        pageUrl: String(raw.context?.pageUrl ?? opts.urls[0] ?? ''),
        now: ctx.now,
        defaultValidDays: opts.defaultValidDays ?? 7,
        defaultCategory: opts.defaultCategory,
      });
      return offer ? [offer] : [];
    },
  };
}
