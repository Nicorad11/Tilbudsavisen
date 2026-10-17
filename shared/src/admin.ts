import type { AccessDTO, AccessStatus } from './billing';

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

/* ------------------------------------------------------------------ */
/* Kunder (admin-appen)                                               */
/* ------------------------------------------------------------------ */

/** Filtrene i kundelisten. "admin" er administratorer; resten er adgangsstatus. */
export type AdminCustomerFilter = 'all' | 'admin' | Exclude<AccessStatus, 'free'>;

export type AdminCustomerSort = 'created' | 'lastSeen' | 'email';

export interface AdminCustomerRow extends AdminUserRow {
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
}

export interface AdminCustomerPage {
  items: AdminCustomerRow[];
  /** Antal kunder der matcher søgning og filter. */
  total: number;
  page: number;
  pageSize: number;
  /** Antal kunder pr. filter (efter søgning, før filter) – til fanerne. */
  counts: Partial<Record<AdminCustomerFilter, number>>;
}

/** En handling i kundens historik. */
export interface AdminCustomerEvent {
  id: number;
  createdAt: string;
  adminEmail: string | null;
  action: AdminCustomerAction;
  details: Record<string, unknown>;
}

export type AdminCustomerAction =
  | 'trial_changed'
  | 'email_change_sent'
  | 'email_verified'
  | 'verification_sent'
  | 'password_reset_sent'
  | 'logged_out';

export interface AdminCustomerDetail {
  id: string;
  email: string;
  createdAt: string;
  lastSeenAt: string;
  emailVerifiedAt: string | null;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  zipCode: string | null;
  radiusKm: number | null;
  preferredStoreIds: string[];
  access: AccessDTO;
  /** Administrator via ADMIN_EMAILS – kan ikke ændres her. */
  isAdmin: boolean;
  /** Det er den administrator, der kigger. */
  isSelf: boolean;
  billing: {
    stripeCustomerId: string | null;
    subscriptionId: string | null;
    subscriptionStatus: string | null;
    subscriptionStartedAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    paymentFailedAt: string | null;
    /** Link til kunden i Stripe Dashboard. */
    stripeUrl: string | null;
  };
  counts: {
    lists: number;
    listItems: number;
    watches: number;
    receipts: number;
    activeSessions: number;
  };
  events: AdminCustomerEvent[];
}

/** Det en administrator kan ændre direkte. Abonnementet ændres i Stripe. */
export interface AdminCustomerUpdate {
  /** Ny slutdato for prøveperioden (ISO). En dato i fortiden afslutter den. */
  trialEndsAt?: string;
  /** Markér e-mailen som bekræftet (fx efter kontakt med kunden). */
  emailVerified?: true;
}

/** Svar fra handlinger der sender en mail til kunden. */
export interface AdminMailResult {
  ok: true;
  /** false hvis mailen ikke kunne sendes (fx SMTP ikke sat op endnu). */
  mailSent: boolean;
  message: string;
}
