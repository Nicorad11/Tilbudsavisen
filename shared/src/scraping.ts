/** Basisenheder som alle priser normaliseres til (kr/kg, kr/l, kr/stk). */
export type BaseUnit = 'stk' | 'kg' | 'l';

export const BASE_UNITS: BaseUnit[] = ['stk', 'kg', 'l'];

/**
 * Fælles, standardiseret format som ALLE scrapere returnerer.
 * De første felter svarer 1:1 til specifikationen; resten er valgfrie
 * udvidelser som gør pris-pr-enhed og re-processering mulig.
 */
export interface ScrapedOffer {
  storeId: string;
  productName: string;
  /** Til matching, f.eks. "mælk 1l". */
  normalizedProductName: string;
  category: string;
  originalPrice: number | null;
  offerPrice: number;
  unit: BaseUnit;
  validFrom: Date;
  validTo: Date;
  imageUrl: string | null;
  sourceUrl: string;

  /** Hvilken kilde (scraper) tilbuddet kommer fra, f.eks. "rema1000". */
  sourceId: string;
  /** Kildens eget id – bruges til upsert, så samme tilbud ikke dubleres. */
  externalId: string;
  description?: string | null;
  brand?: string | null;
  /** Pakningsstørrelse i basisenheden (fx 0.4 kg). min/max ved "300-400 g". */
  quantity?: { min: number; max: number } | null;
  /** Antal pakninger prisen gælder for ("3 for 50 kr" → 3). */
  pieces?: number;
  /** Kr. pr. basisenhed baseret på gennemsnitlig pakningsstørrelse. */
  unitPrice?: number | null;
  /** Kr. pr. basisenhed ved den mindste pakning (kædernes "Max. x pr. kg"). */
  unitPriceMax?: number | null;
  maxPerCustomer?: number | null;
  /**
   * true = en almindelig hyldepris (ikke et tilbud). Bruges kun til
   * prishistorik, så vi kan afgøre om et tilbud er en reel besparelse.
   */
  isBaseline?: boolean;
}

/** Et råt datapunkt som gemmes uændret, så historik kan re-processeres. */
export interface RawRecord {
  sourceId: string;
  externalId: string;
  /** Hvilken parser der skal bruges (fx "tjek-offer", "rema-product"). */
  kind: string;
  payload: unknown;
  /** Ekstra kontekst parseren skal bruge (kæde-id, katalog-id osv.). */
  context?: Record<string, unknown>;
}

export interface StoreLocationInput {
  storeId: string;
  externalId: string;
  name: string;
  street: string | null;
  city: string | null;
  zipCode: string | null;
  latitude: number;
  longitude: number;
}
