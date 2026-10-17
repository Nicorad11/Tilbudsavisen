import type { AccessStatus, AdminCustomerAction, AdminCustomerFilter } from '@tilbudsradar/shared';

export const STATUS_LABEL: Record<AccessStatus, string> = {
  launch: 'Gratis (lancering)',
  trial: 'Prøveperiode',
  active: 'Abonnement',
  past_due: 'Betaling fejlet',
  canceled: 'Opsagt',
  expired: 'Udløbet',
  free: 'Gæst',
};

export const STATUS_TONE: Record<AccessStatus, 'lime' | 'ok' | 'warn' | 'bad' | 'ghost' | 'white'> = {
  launch: 'white',
  trial: 'ok',
  active: 'lime',
  past_due: 'warn',
  canceled: 'warn',
  expired: 'bad',
  free: 'ghost',
};

export const FILTER_LABEL: Record<AdminCustomerFilter, string> = {
  all: 'Alle',
  launch: 'Gratis (lancering)',
  trial: 'Prøveperiode',
  active: 'Abonnement',
  past_due: 'Betaling fejlet',
  canceled: 'Opsagt',
  expired: 'Udløbet',
  admin: 'Administratorer',
};

export const ACTION_LABEL: Record<AdminCustomerAction, string> = {
  trial_changed: 'Prøveperiode ændret',
  email_change_sent: 'Link til ny e-mail sendt',
  email_verified: 'E-mail markeret som bekræftet',
  verification_sent: 'Bekræftelsesmail sendt',
  password_reset_sent: 'Link til ny adgangskode sendt',
  logged_out: 'Logget ud på alle enheder',
};

export const dateFmt = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
export const dateTimeFmt = new Intl.DateTimeFormat('da-DK', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '–');
export const fmtDateTime = (iso: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : '–');
