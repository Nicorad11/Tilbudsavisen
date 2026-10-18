/* ------------------------------------------------------------------ */
/* Abonnement, prøveperiode og adgang                                 */
/* ------------------------------------------------------------------ */

/** Pris og prøveperiode – vises overalt i appen og bruges af backend. */
export const PLAN = {
  /** Samlet pris pr. måned (inkl. moms, når virksomheden er momsregistreret). */
  priceDkk: 49,
  trialDays: 14,
} as const;

/**
 * Version af handelsbetingelserne. Ændres teksten i legal.ts væsentligt, skal
 * versionen bumpes, så nye accepter gemmes med den rigtige version.
 */
export const TERMS_VERSION = '2026-10-08';

/** Fortrydelsesfristen for abonnementet (forbrugeraftaleloven § 18-19). */
export const WITHDRAWAL_DAYS = 14;

/**
 * trial     = i prøveperioden
 * active    = betalt abonnement (eller administrator)
 * past_due  = betalingen fejlede – adgang i en kort henstand
 * canceled  = opsagt – adgang indtil den betalte periode udløber
 * expired   = konto uden aktiv prøveperiode eller abonnement (data er skrivebeskyttede)
 * launch    = lanceringsperiode: betaling er ikke åbnet endnu, så alle konti har fuld adgang gratis
 * free      = ikke logget ind eller gæst
 */
export type AccessStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'expired' | 'launch' | 'free';

export interface AccessDTO {
  status: AccessStatus;
  /** Må bruge de betalte funktioner lige nu. */
  hasAccess: boolean;
  isAdmin: boolean;
  trialEndsAt: string | null;
  /** Hele dage tilbage af prøveperioden (rundet op), ellers null. */
  trialDaysLeft: number | null;
  /** Prøveperioden er brugt på denne e-mail (også hvis den er udløbet). */
  trialUsed: boolean;
  /** Har et Stripe-abonnement, der ikke er afsluttet. */
  subscribed: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Næste træk på kortet – null hvis abonnementet er opsagt eller ikke findes. */
  nextPaymentAt: string | null;
  /** Ved fejlet betaling: hvornår adgangen lukker, hvis kortet ikke opdateres. */
  graceEndsAt: string | null;
  /** Sidste frist for at bruge "Fortryd aftale" på det nuværende abonnement. */
  withdrawableUntil: string | null;
}

/** De funktioner der kræver prøveperiode eller abonnement. */
export type PaidFeature = 'lists' | 'alerts' | 'receipts' | 'history' | 'community';

export const PAID_FEATURES: Record<PaidFeature, { title: string; description: string }> = {
  lists: {
    title: 'Indkøbslister og butiks-splitting',
    description: 'Saml dine varer, se ugens billigste tilbud på hver og find den billigste kombination af butikker.',
  },
  alerts: {
    title: 'Prisalarmer',
    description: 'Følg dine faste varer og få besked i appen og på e-mail, når de kommer på tilbud under din pris.',
  },
  receipts: {
    title: 'Kvitteringsscanner',
    description: 'Scan kvitteringen, se hvad du sparede, og få besked hvis kassen slog en vare forkert ind.',
  },
  history: {
    title: 'Prishistorik',
    description: 'Se hvordan prisen på en vare har udviklet sig i de enkelte kæder over tid.',
  },
  community: {
    title: 'Community-vurderinger',
    description: 'Vurdér om et tilbud er reelt, og stem på andres vurderinger.',
  },
};

/** Fejlkoder som frontend kan reagere på (fx vise betalingsmuren). */
export type ApiErrorCode =
  | 'ACCOUNT_REQUIRED'
  | 'PLAN_REQUIRED'
  | 'EMAIL_NOT_VERIFIED'
  | 'TERMS_REQUIRED'
  | 'ALREADY_SUBSCRIBED'
  | 'BILLING_UNAVAILABLE'
  | 'SCAN_QUOTA';

export interface BillingStatusDTO {
  access: AccessDTO;
  emailVerified: boolean;
  /** Stripe er konfigureret på serveren (ellers kan der ikke abonneres endnu). */
  billingEnabled: boolean;
  priceDkk: number;
  trialDays: number;
  termsVersion: string;
  /** Kvitteringsscanninger brugt denne måned og loftet. */
  receiptScans: { used: number; limit: number };
}

export interface CheckoutRequest {
  acceptTerms: true;
  termsVersion: string;
}

export interface UrlResponse {
  url: string;
}

export interface WithdrawalRequest {
  name: string;
  /** E-mail som kvitteringen for fortrydelsen sendes til. */
  email: string;
}

export interface WithdrawalResponse {
  submittedAt: string;
  /** Beløb der refunderes (kr), 0 hvis der endnu ikke er betalt. */
  refundDkk: number;
}
