import type { RawRecord, ScrapedOffer, StoreLocationInput } from '@tilbudsradar/shared';
import type { HttpClient } from './http/client';
import type { Logger } from './log';

export interface ChainInfo {
  id: string;
  name: string;
  color: string;
  category: 'supermarked' | 'byggemarked' | 'elektronik';
  website: string;
  logoUrl?: string | null;
}

export interface ScrapeContext {
  http: HttpClient;
  log: Logger;
  now: Date;
  geo: { lat: number; lng: number };
  signal?: AbortSignal;
  /** Begræns antal sider/kataloger (bruges af CLI og tests). */
  maxPages?: number;
}

export interface ParseContext {
  now: Date;
}

export type SourceKind = 'api' | 'webshop' | 'html';

/**
 * En scraper er delt i to trin, så rå data kan gemmes og re-processeres:
 *   fetch()  – henter rå records fra kilden (netværk)
 *   parse()  – omsætter én rå record til 0..n standardiserede tilbud (ren funktion)
 */
export interface Scraper {
  /** Kilde-id, fx "rema1000" eller "rema1000-webshop". */
  id: string;
  chain: ChainInfo;
  kind: SourceKind;
  description: string;
  /** Hvilke `RawRecord.kind` denne scraper kan parse. */
  parses: string[];
  /**
   * true = et tomt resultat er normalt (fx ingen aktive aviser lige nu), fordi
   * kildens svar allerede er valideret. Ellers tolkes 0 records som strukturændring.
   */
  emptyIsOk?: boolean;
  fetch(ctx: ScrapeContext): AsyncIterable<RawRecord>;
  parse(raw: RawRecord, ctx: ParseContext): ScrapedOffer[];
  fetchStores?(ctx: ScrapeContext): AsyncIterable<StoreLocationInput>;
}
