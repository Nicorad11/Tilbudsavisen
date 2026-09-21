import type { BaseUnit } from './scraping';

/* ------------------------------------------------------------------ */
/* Tilbud, butikker og søgning                                        */
/* ------------------------------------------------------------------ */

/**
 * real      = tydeligt under 90-dages gennemsnit
 * ok        = lidt under gennemsnit
 * inflated  = "førprisen" ser kunstigt opskrevet ud / ingen reel besparelse
 * unknown   = for lidt historik til at vurdere
 */
export type TrustLevel = 'real' | 'ok' | 'inflated' | 'unknown';

export interface TrustInfo {
  level: TrustLevel;
  label: string;
  /** Gennemsnitlig enhedspris de sidste 90 dage (kr/enhed). */
  avgUnitPrice90d: number | null;
  /** Faktisk besparelse i % i forhold til 90-dages gennemsnittet. */
  savingsPct: number | null;
  /** Den besparelse kæden selv reklamerer med (vs. førpris). */
  claimedSavingsPct: number | null;
  samples: number;
  explanation: string;
}

export interface CommunityScore {
  real: number;
  misleading: number;
  /** 0-100, null hvis ingen stemmer. */
  score: number | null;
}

export interface StoreRef {
  id: string;
  name: string;
  color: string;
  logoUrl: string | null;
}

export interface StoreDTO extends StoreRef {
  category: string;
  website: string | null;
  enabled: boolean;
  offerCount: number;
  locationCount: number;
}

export interface OfferDTO {
  id: number;
  productId: number | null;
  store: StoreRef;
  title: string;
  description: string | null;
  normalizedName: string;
  category: string;
  offerPrice: number;
  originalPrice: number | null;
  unit: BaseUnit;
  quantityMin: number | null;
  quantityMax: number | null;
  unitPrice: number | null;
  unitPriceMax: number | null;
  validFrom: string;
  validTo: string;
  imageUrl: string | null;
  sourceUrl: string;
  discountPct: number | null;
  trust: TrustInfo;
  community: CommunityScore;
  distanceKm?: number | null;
}

export interface Facet {
  id: string;
  label: string;
  count: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  items: OfferDTO[];
  facets: { stores: Facet[]; categories: Facet[] };
  location: { lat: number; lng: number; radiusKm: number; zip: string | null } | null;
}

export type SearchSort = 'unit' | 'price' | 'discount' | 'relevance';

export interface ProductDTO {
  id: number;
  name: string;
  normalizedName: string;
  category: string;
  unit: BaseUnit;
}

export interface PricePoint {
  date: string;
  storeId: string;
  price: number;
  unitPrice: number | null;
  isOffer: boolean;
  synthetic: boolean;
}

export interface PriceHistoryResponse {
  product: ProductDTO;
  points: PricePoint[];
  stores: StoreRef[];
  avgUnitPrice90d: number | null;
  minUnitPrice: number | null;
  maxUnitPrice: number | null;
  hasSynthetic: boolean;
}

export interface CommunityReportDTO {
  id: number;
  verdict: 'real' | 'misleading';
  comment: string | null;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  myVote: -1 | 0 | 1;
  isMine: boolean;
  author: string;
}

export interface OfferDetailResponse {
  offer: OfferDTO;
  alternatives: OfferDTO[];
  reports: CommunityReportDTO[];
}

export interface StatsDTO {
  totalOffers: number;
  realDeals: number;
  newToday: number;
  storeCount: number;
  avgDiscountPct: number | null;
  /** Ændring i gennemsnitlig enhedspris for tilbud, sidste 30 dage (%). */
  trendPct: number | null;
  /** Hvornår næste avis starter (tidligste fremtidige valid_from). */
  nextCatalogAt: string | null;
  lastScrapeAt: string | null;
  categoryCounts: Facet[];
  /** Antal aktive tilbud pr. dag de næste/sidste dage – til tidslinjen. */
  timeline: { date: string; count: number; stores: Record<string, number> }[];
  topSavings: number | null;
}

/* ------------------------------------------------------------------ */
/* Brugere & auth                                                     */
/* ------------------------------------------------------------------ */

export interface UserDTO {
  id: string;
  email: string | null;
  isGuest: boolean;
  role: 'user' | 'admin';
  preferredStoreIds: string[];
  dietPreferences: string[];
  allergies: string[];
  zipCode: string | null;
  radiusKm: number | null;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDTO;
}

/* ------------------------------------------------------------------ */
/* Indkøbslister                                                      */
/* ------------------------------------------------------------------ */

export interface ShoppingListItemDTO {
  id: number;
  text: string;
  productId: number | null;
  quantity: number;
  checked: boolean;
  bestOffer: OfferDTO | null;
}

export interface ShoppingListDTO {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: ShoppingListItemDTO[];
}

export interface ListSummaryDTO {
  id: number;
  name: string;
  itemCount: number;
  updatedAt: string;
}

export interface StorePlan {
  storeIds: string[];
  total: number;
  covered: number;
  missing: number[];
  perStore: { storeId: string; itemIds: number[]; subtotal: number }[];
}

export interface ListOptimizationDTO {
  itemCount: number;
  /** Bedste plan hvis man kun handler i én butik. */
  bestSingle: StorePlan | null;
  /** Bedste kombination af op til `maxStores` butikker. */
  bestSplit: StorePlan | null;
  savings: number | null;
  singleStores: StorePlan[];
  maxStores: number;
}

/* ------------------------------------------------------------------ */
/* Watchlist & notifikationer                                         */
/* ------------------------------------------------------------------ */

export interface WatchDTO {
  id: number;
  query: string;
  productId: number | null;
  targetPrice: number;
  createdAt: string;
  currentBest: OfferDTO | null;
  triggered: boolean;
}

export interface NotificationDTO {
  id: number;
  message: string;
  offerId: number | null;
  createdAt: string;
  readAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Scraping / kilder                                                  */
/* ------------------------------------------------------------------ */

export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'skipped';

export interface ScrapeRunDTO {
  id: number;
  sourceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  offersFound: number;
  offersSaved: number;
  baselineSaved: number;
  rejected: number;
  message: string | null;
  durationMs: number | null;
}

export interface SourceStatusDTO {
  id: string;
  storeId: string;
  storeName: string;
  storeColor: string;
  kind: 'api' | 'webshop' | 'html';
  description: string;
  enabled: boolean;
  storeEnabled: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: RunStatus | null;
  lastError: string | null;
  consecutiveFailures: number;
  activeOffers: number;
  runs: ScrapeRunDTO[];
}

export interface HostUsageDTO {
  host: string;
  lastMinute: number;
  total: number;
  limitPerMinute: number;
  cacheHits: number;
  robotsBlocked: number;
}

export interface ScrapeStatusDTO {
  running: boolean;
  current: string | null;
  queue: string[];
  hosts: HostUsageDTO[];
  schedule: string | null;
  sources: SourceStatusDTO[];
}
