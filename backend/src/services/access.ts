import { WITHDRAWAL_DAYS, type AccessDTO, type AccessStatus } from '@tilbudsradar/shared';
import type { users } from '../db/schema';

const DAY = 86_400_000;

export type AccessUser = Pick<
  typeof users.$inferSelect,
  | 'isGuest'
  | 'role'
  | 'email'
  | 'trialEndsAt'
  | 'subscriptionId'
  | 'subscriptionStatus'
  | 'currentPeriodEnd'
  | 'cancelAtPeriodEnd'
  | 'subscriptionStartedAt'
  | 'paymentFailedAt'
>;

/** Stripe-statusser hvor abonnementet stadig løber (og kortet trækkes). */
const RUNNING = new Set(['active', 'trialing', 'past_due']);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Den ene sandhed om hvad en bruger må. Rækkefølge:
 * administrator → løbende abonnement → opsagt men betalt periode → prøveperiode → udløbet.
 * Gæster og anonyme har status "free" – de skal oprette en konto for at få en prøveperiode.
 *
 * `launch`: betaling er ikke åbnet endnu (ingen Stripe). Så har alle konti uden
 * abonnement fuld adgang gratis, og prøveperioden regnes først fra den dag,
 * betaling åbner (se services/launch.ts).
 */
export function computeAccess(
  user: AccessUser | null,
  opts: { now?: Date; graceDays: number; launch?: boolean },
): AccessDTO {
  const now = opts.now ?? new Date();
  const base: AccessDTO = {
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
  if (!user || user.isGuest) return base;

  const trialEnd = user.trialEndsAt;
  const periodEnd = user.currentPeriodEnd;
  const stripeStatus = user.subscriptionStatus;
  const running = Boolean(user.subscriptionId && stripeStatus && RUNNING.has(stripeStatus));
  const inPeriod = Boolean(periodEnd && periodEnd.getTime() > now.getTime());
  const withdrawEnd = user.subscriptionStartedAt ? new Date(user.subscriptionStartedAt.getTime() + WITHDRAWAL_DAYS * DAY) : null;

  const out: AccessDTO = {
    ...base,
    isAdmin: user.role === 'admin',
    trialEndsAt: iso(trialEnd),
    trialUsed: Boolean(trialEnd),
    subscribed: running,
    currentPeriodEnd: iso(periodEnd),
    cancelAtPeriodEnd: user.cancelAtPeriodEnd,
    withdrawableUntil: running && withdrawEnd && withdrawEnd.getTime() > now.getTime() ? withdrawEnd.toISOString() : null,
  };

  let status: AccessStatus = 'expired';
  if (running && stripeStatus === 'past_due') {
    const failedAt = user.paymentFailedAt ?? now;
    const graceEnd = new Date(failedAt.getTime() + opts.graceDays * DAY);
    out.graceEndsAt = graceEnd.toISOString();
    status = graceEnd.getTime() > now.getTime() ? 'past_due' : 'expired';
  } else if (running && user.cancelAtPeriodEnd) {
    status = inPeriod ? 'canceled' : 'expired';
  } else if (running) {
    // Ved fornyelse kan webhooken med den nye periode komme lidt efter periodens slut – derfor to dages slæk.
    // Stripes egen "trialing" (første træk udskudt til prøveperiodens slut) er et tegnet abonnement.
    const renewing = Boolean(periodEnd && periodEnd.getTime() + 2 * DAY > now.getTime());
    status = !periodEnd || renewing || stripeStatus === 'trialing' ? 'active' : 'expired';
    out.nextPaymentAt = iso(periodEnd);
  } else if (stripeStatus === 'canceled' && inPeriod) {
    // Afsluttet abonnement hvor den betalte periode endnu ikke er udløbet.
    status = 'canceled';
  }

  if (status === 'expired' && trialEnd && trialEnd.getTime() > now.getTime()) status = 'trial';
  if (trialEnd && trialEnd.getTime() > now.getTime()) {
    out.trialDaysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / DAY);
  }
  if (status === 'past_due' && !out.nextPaymentAt) out.nextPaymentAt = iso(periodEnd);

  if (opts.launch && (status === 'trial' || status === 'expired')) {
    status = 'launch';
    out.trialDaysLeft = null;
  }
  if (out.isAdmin && status !== 'active') status = 'active';
  out.status = status;
  out.hasAccess = status === 'trial' || status === 'active' || status === 'past_due' || status === 'canceled' || status === 'launch';
  return out;
}
