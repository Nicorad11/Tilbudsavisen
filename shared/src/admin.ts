import type { AccessStatus } from './billing';

/* ------------------------------------------------------------------ */
/* Besøgsstatistik og admin-overblik                                  */
/* ------------------------------------------------------------------ */

/**
 * Én sidevisning fra frontenden. Kun stien (uden forespørgsel), værtsnavnet
 * fra referrer og UTM-parametre – ingen cookies, ingen IP-adresse gemt.
 */
export interface PageViewRequest {
  path: string;
  /** document.referrer – serveren gemmer kun værtsnavnet. */
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** Den besøgende er logget ind med en konto. */
  member?: boolean;
}

export interface AdminUserRow {
  id: string;
  email: string;
  createdAt: string;
  lastSeenAt: string;
  emailVerified: boolean;
  status: AccessStatus;
  isAdmin: boolean;
  lists: number;
  watches: number;
}

export interface AdminDay {
  /** YYYY-MM-DD (dansk tid). */
  day: string;
  signups: number;
  visitors: number;
  pageviews: number;
}

export interface AdminCount {
  label: string;
  count: number;
}

export interface AdminOverviewDTO {
  generatedAt: string;
  days: number;
  billingEnabled: boolean;
  users: {
    total: number;
    verified: number;
    newToday: number;
    newInPeriod: number;
    active1d: number;
    active7d: number;
    active30d: number;
    byStatus: AdminCount[];
  };
  traffic: {
    visitorsToday: number;
    pageviewsToday: number;
    /** Summen af daglige unikke besøgende (en person der kommer to dage tæller to gange). */
    visitsInPeriod: number;
    pageviewsInPeriod: number;
    topPages: { path: string; pageviews: number; visits: number }[];
    sources: AdminCount[];
    devices: AdminCount[];
  };
  byDay: AdminDay[];
  latestUsers: AdminUserRow[];
  site: {
    totalOffers: number;
    lastScrapeAt: string | null;
    sources: { id: string; name: string; status: string | null; lastRunAt: string | null; failures: number; enabled: boolean }[];
  };
}
