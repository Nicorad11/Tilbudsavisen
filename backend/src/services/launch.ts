import { PLAN } from '@tilbudsradar/shared';
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { log } from '../env';
import { billingOpenedMail } from './emails';
import { sendMailInBackground } from './mailer';
import { getSetting, setSetting } from './settings';

const DAY = 86_400_000;
export const BILLING_OPENED_KEY = 'billing_opened_at';

/**
 * Lanceringsperioden slutter første gang serveren starter med Stripe sat op.
 * Alle konti uden abonnement får så en frisk prøveperiode på 14 dage fra i dag
 * (eller beholder en længere) og en mail om det. Sker kun én gang.
 */
export async function openBillingIfNeeded(db: Db, billingEnabled: boolean, now = new Date()): Promise<number> {
  if (!billingEnabled || (await getSetting(db, BILLING_OPENED_KEY))) return 0;

  const trialEnd = new Date(now.getTime() + PLAN.trialDays * DAY);
  const extended = await db
    .update(users)
    .set({ trialEndsAt: trialEnd, trialReminderSentAt: null, trialEndedSentAt: null })
    .where(
      and(
        eq(users.isGuest, false),
        isNotNull(users.email),
        isNull(users.subscriptionId),
        or(isNull(users.trialEndsAt), lt(users.trialEndsAt, trialEnd)),
      ),
    )
    .returning({ email: users.email });
  await setSetting(db, BILLING_OPENED_KEY, now.toISOString());

  for (const u of extended) sendMailInBackground(billingOpenedMail(u.email!, trialEnd));
  log.info('Betaling er åbnet – lanceringsperioden er slut', { konti: extended.length, proeveperiodeTil: trialEnd.toISOString() });
  return extended.length;
}

/** Til admin: hvornår betaling blev åbnet (null = lanceringsperiode). */
export async function billingOpenedAt(db: Db): Promise<Date | null> {
  const value = await getSetting(db, BILLING_OPENED_KEY);
  return value ? new Date(value) : null;
}
