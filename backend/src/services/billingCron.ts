import { and, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { env, log } from '../env';
import { accessFor } from './auth';
import { trialEndedMail, trialEndingSoonMail } from './emails';
import { sendMail } from './mailer';

const DAY = 86_400_000;

/**
 * Dagligt job: "prøveperioden slutter om 3 dage" og "prøveperioden er slut".
 * Hver mail sendes højst én gang pr. bruger (markeres i databasen), og kun
 * til brugere uden et løbende abonnement.
 */
export async function runBillingCron(db: Db, now = new Date()): Promise<{ reminders: number; ended: number }> {
  let reminders = 0;
  let ended = 0;
  // I lanceringsperioden (ingen betaling) udløber prøveperioder ikke – så heller ingen mails om det.
  if (!env.billingEnabled) return { reminders, ended };

  const soon = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.isGuest, false),
        isNotNull(users.email),
        isNull(users.trialReminderSentAt),
        gt(users.trialEndsAt, now),
        lte(users.trialEndsAt, new Date(now.getTime() + 3 * DAY)),
      ),
    );
  for (const u of soon) {
    if (accessFor(u, now).subscribed) continue;
    // Markér først, så en fejl i mailen ikke giver gentagne mails ved næste kørsel.
    await db.update(users).set({ trialReminderSentAt: now }).where(eq(users.id, u.id));
    if (await sendMail(trialEndingSoonMail(u.email!, u.trialEndsAt!))) reminders++;
  }

  const over = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.isGuest, false),
        isNotNull(users.email),
        isNull(users.trialEndedSentAt),
        lte(users.trialEndsAt, now),
        // Kun nyligt udløbne – undgår en bølge af mails til gamle konti ved første kørsel.
        gt(users.trialEndsAt, new Date(now.getTime() - 7 * DAY)),
      ),
    );
  for (const u of over) {
    await db.update(users).set({ trialEndedSentAt: now }).where(eq(users.id, u.id));
    if (accessFor(u, now).hasAccess) continue; // abonnerer allerede
    if (await sendMail(trialEndedMail(u.email!))) ended++;
  }

  if (reminders || ended) log.info('Mails om prøveperioden sendt', { reminders, ended });
  return { reminders, ended };
}
