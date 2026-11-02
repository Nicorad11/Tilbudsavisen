import type { StoreRef, TrustLevel } from './api';
import type { BaseUnit } from './scraping';
import type { SeoMeta } from './seo';

/**
 * Datasiderne (/tilbud, /butik, /kategori, /ugens-bedste-tilbud, /indsigt, /metode).
 * Serveren bygger hele indholdet – også tekster, spørgsmål og svar og meta –
 * så den server-renderede HTML og browserens visning altid er ens.
 */

/** Et tilbud, som det vises på en dataside (en slank udgave af OfferDTO). */
export interface SeoOffer {
  id: number;
  title: string;
  brand: string | null;
  store: StoreRef;
  offerPrice: number;
  originalPrice: number | null;
  discountPct: number | null;
  unit: BaseUnit;
  quantityMin: number | null;
  quantityMax: number | null;
  unitPrice: number | null;
  validFrom: string;
  validTo: string;
  imageUrl: string | null;
  trust: { level: TrustLevel; label: string; savingsPct: number | null };
}

export interface SeoLink {
  href: string;
  label: string;
  /** Kort tilføjelse, fx "fra 59,95 kr/kg". */
  detail?: string;
}

export interface SeoFaq {
  q: string;
  a: string;
}

export interface SeoPageBase {
  meta: SeoMeta;
  /** Hvornår siden blev beregnet – også "nu" for gyldighedstekster, så server og browser er enige. */
  generatedAt: string;
  /** Seneste hentning af aviserne. */
  updatedAt: string | null;
  /** ISO-uge i dansk tid. */
  week: number;
  breadcrumbs: SeoLink[];
}

export type TrustCounts = Record<TrustLevel, number>;

export interface TermPageDTO extends SeoPageBase {
  kind: 'term';
  slug: string;
  label: string;
  /** Sådan står varen midt i en sætning ("smør", "Nutella"). */
  phrase: string;
  unit: BaseUnit | null;
  indexable: boolean;
  /** 1–2 sætninger med de vigtigste tal. */
  summary: string;
  offers: SeoOffer[];
  activeCount: number;
  upcomingCount: number;
  storeNames: string[];
  trustCounts: TrustCounts;
  history: {
    /** Første dag med data i perioden (højst 90 dage tilbage). */
    since: string;
    offers: number;
    lowest: { unitPrice: number; storeName: string; week: number; year: number } | null;
    medianUnitPrice: number | null;
    byStore: { name: string; count: number }[];
    lastOfferAt: string | null;
    lastOffer: { title: string; storeName: string; offerPrice: number; unitPrice: number | null } | null;
  };
  faq: SeoFaq[];
  related: SeoLink[];
  storeLinks: SeoLink[];
}

export interface TermHubDTO extends SeoPageBase {
  kind: 'termHub';
  groups: { letter: string; terms: (SeoLink & { indexable: boolean; offerCount: number })[] }[];
  termCount: number;
}

export interface StoreSummary {
  slug: string;
  name: string;
  color: string;
  offerCount: number;
  realCount: number;
  nextCatalogAt: string | null;
}

/** Forsidens links til datasiderne: populære varer på tilbud nu og kæderne. */
export interface HomeLinksDTO {
  week: number;
  /** detail = laveste pris pr. enhed lige nu, fx "fra 44,22 kr/kg". */
  popular: (SeoLink & { storeName: string | null })[];
  stores: StoreSummary[];
}

export interface StoresHubDTO extends SeoPageBase {
  kind: 'storesHub';
  stores: StoreSummary[];
}

export interface StorePageDTO extends SeoPageBase {
  kind: 'store';
  store: StoreSummary;
  indexable: boolean;
  summary: string;
  best: SeoOffer[];
  trustCounts: TrustCounts;
  categories: (SeoLink & { count: number })[];
  /** Varer, hvor kæden har den laveste pris pr. enhed lige nu. */
  cheapestFor: SeoLink[];
}

export interface CategoryPageDTO extends SeoPageBase {
  kind: 'category';
  slug: string;
  label: string;
  indexable: boolean;
  summary: string;
  best: SeoOffer[];
  trustCounts: TrustCounts;
  stores: { name: string; slug: string; count: number }[];
  terms: SeoLink[];
}

export interface WeeklyBestDTO extends SeoPageBase {
  kind: 'weekly';
  indexable: boolean;
  summary: string;
  best: SeoOffer[];
  byStore: { store: SeoLink; offers: SeoOffer[] }[];
  trustCounts: TrustCounts;
}

export interface MethodPageDTO extends SeoPageBase {
  kind: 'method';
  offersAnalyzed: number;
  dataSince: string | null;
  thresholds: { realPct: number; okPct: number; inflatedClaimPct: number; inflatedMaxSavingsPct: number; windowDays: number };
}

/** Én kæde i en periode på /indsigt. */
export interface InsightStore {
  slug: string;
  name: string;
  color: string;
  /** Tilbud, der har gældt i perioden. */
  offers: number;
  /** Heraf vurderet – resten har for lidt prishistorik. */
  assessed: number;
  counts: TrustCounts;
  /** Andel reelle tilbud i % af kædens vurderede tilbud – null med for få vurderede. */
  realShare: number | null;
  /** Tilbud, hvor besparelsen er målt mod normalpriser (ikke kun tidligere tilbud). */
  measured: number;
  /** Gennemsnitlig målt besparelse i % – null med for få målinger. */
  avgSavingsPct: number | null;
  /** Tilbud med både en førpris fra kæden og en målt besparelse: rabatten kæden skriver vs. den målte. */
  claimed: { n: number; claimedPct: number; measuredPct: number } | null;
}

export interface InsightPeriod {
  key: 'week' | 'month';
  /** "De sidste 7 dage", "De sidste 30 dage" eller "Siden 20. oktober". */
  label: string;
  from: string;
  to: string;
  offers: number;
  /** Heraf vurderet – resten har for lidt prishistorik. */
  assessed: number;
  counts: TrustCounts;
  /** Andel reelle tilbud i % af de vurderede. */
  realShare: number;
  stores: InsightStore[];
  /** Kæden med flest reelle tilbud i perioden. */
  mostReal: { slug: string; name: string; count: number } | null;
}

/** Et af ugens største prisfald: tilbudsprisen pr. enhed mod varens normalpris. */
export interface PriceDrop {
  title: string;
  store: StoreRef;
  unit: BaseUnit;
  unitPrice: number;
  normalUnitPrice: number;
  savingsPct: number;
  validTo: string;
  /** Varesiden, hvis tilbuddet hører til en. */
  term: SeoLink | null;
}

export interface InsightsDTO extends SeoPageBase {
  kind: 'insights';
  indexable: boolean;
  /** Hovedtallet, fx { value: "26,4 %", text: "af de vurderede tilbud de sidste 7 dage var reelle" }. */
  headline: { value: string; text: string };
  summary: string;
  periods: InsightPeriod[];
  drops: PriceDrop[];
  faq: SeoFaq[];
}
