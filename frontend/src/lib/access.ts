import type { AccessDTO, BillingStatusDTO, PaidFeature, UrlResponse } from '@tilbudsradar/shared';
import { TERMS_VERSION } from '@tilbudsradar/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { track } from './analytics';
import { CONFIG } from './config';
import { useMe } from './hooks';
import { useAuth, useUi } from './store';

export const FREE_ACCESS: AccessDTO = {
  status: 'free',
  hasAccess: false,
  isAdmin: false,
  trialEndsAt: null,
  trialDaysLeft: null,
  trialUsed: false,
  subscribed: false,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  nextPaymentAt: null,
  graceEndsAt: null,
  withdrawableUntil: null,
};

/** Brugerens adgang lige nu – friskeste kilde først (/auth/me, så login-svaret). */
export function useAccess() {
  const token = useAuth((s) => s.accessToken);
  const stored = useAuth((s) => s.user);
  const me = useMe();
  const user = token ? (me.data ?? stored) : null;
  return {
    user,
    access: user?.access ?? FREE_ACCESS,
    /** Har en rigtig konto (ikke gæst). */
    isMember: Boolean(user && !user.isGuest),
    isGuest: Boolean(user?.isGuest),
  };
}

/** Kør handlingen hvis brugeren har adgang – ellers vis betalingsmuren. */
export function usePlanAction(feature: PaidFeature) {
  const { access } = useAccess();
  const open = useUi((s) => s.openPaywall);
  return (fn: () => void) => {
    if (access.hasAccess) fn();
    else open(feature);
  };
}

/**
 * Lanceringsperiode: betaling er ikke åbnet endnu, så alle med en konto har
 * fuld adgang gratis. Serverens værdi i siden bruges, til status er hentet.
 */
export function useLaunch(): boolean {
  const billing = useBillingStatus();
  return billing.data ? !billing.data.billingEnabled : !CONFIG.billingEnabled;
}

export const useBillingStatus = () => {
  const token = useAuth((s) => s.accessToken);
  return useQuery({
    queryKey: ['billing', token],
    queryFn: () => api<BillingStatusDTO>('/billing/status'),
    staleTime: 15_000,
  });
};

/** Starter Stripe Checkout (redirect). Kræver aktiv accept af den aktuelle version af betingelserne. */
export function useCheckout() {
  const toast = useUi((s) => s.showToast);
  return useMutation({
    mutationFn: () =>
      api<UrlResponse>('/billing/checkout', { method: 'POST', body: { acceptTerms: true, termsVersion: TERMS_VERSION } }),
    onSuccess: ({ url }) => {
      track('Checkout startet');
      window.location.assign(url);
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Betalingen kunne ikke startes', 'error'),
  });
}

/** Åbner Stripes kundeportal (kort, fakturaer, opsigelse). */
export function usePortal() {
  const toast = useUi((s) => s.showToast);
  return useMutation({
    mutationFn: () => api<UrlResponse>('/billing/portal', { method: 'POST' }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => toast(err instanceof Error ? err.message : 'Portalen kunne ikke åbnes', 'error'),
  });
}

export function useResendVerification() {
  const toast = useUi((s) => s.showToast);
  return useMutation({
    mutationFn: () => api<{ ok: boolean; alreadyVerified?: boolean }>('/auth/verify-email/resend', { method: 'POST' }),
    onSuccess: (r) => toast(r.alreadyVerified ? 'Din e-mail er allerede bekræftet' : 'Vi har sendt en ny mail – tjek også spam'),
    onError: (err) => toast(err instanceof Error ? err.message : 'Mailen kunne ikke sendes', 'error'),
  });
}

const longDate = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
export const formatLongDate = (iso: string | null | undefined) => (iso ? longDate.format(new Date(iso)) : '–');
