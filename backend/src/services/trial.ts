import { createHash } from 'node:crypto';
import { PLAN } from '@tilbudsradar/shared';
import type { Db } from '../db/client';
import { trialClaims } from '../db/schema';

/**
 * Normaliserer en e-mail til brug for "én prøveperiode pr. e-mail":
 * små bogstaver, uden "+tag" i den lokale del, og for Gmail uden punktummer
 * (Gmail ignorerer begge dele, så de er reelt samme indbakke).
 */
export function normalizeEmailForTrial(email: string): string {
  const [rawLocal = '', rawDomain = ''] = email.trim().toLowerCase().split('@');
  let local = rawLocal.split('+')[0] ?? '';
  let domain = rawDomain;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

export const trialEmailHash = (email: string) => createHash('sha256').update(normalizeEmailForTrial(email), 'utf8').digest('hex');

/**
 * Registrerer at e-mailen har fået sin prøveperiode. Returnerer prøveperiodens
 * slutning, eller null hvis e-mailen allerede har brugt den.
 */
export async function claimTrial(db: Db, email: string, now = new Date()): Promise<Date | null> {
  const inserted = await db
    .insert(trialClaims)
    .values({ emailHash: trialEmailHash(email) })
    .onConflictDoNothing()
    .returning({ hash: trialClaims.emailHash });
  if (!inserted.length) return null;
  return new Date(now.getTime() + PLAN.trialDays * 86_400_000);
}
