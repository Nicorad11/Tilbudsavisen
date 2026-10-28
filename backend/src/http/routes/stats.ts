import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { users } from '../../db/schema';
import { env } from '../../env';
import { accessFor } from '../../services/auth';
import type { AppContext } from '../app';
import { HttpError } from '../errors';

/** Betalende kunder: løbende abonnement (ikke Stripes egen prøveperiode), administratorer tæller ikke med. */
export async function payingCount(db: AppContext['db'], now = new Date()): Promise<number> {
  const accounts = await db
    .select()
    .from(users)
    .where(sql`NOT ${users.isGuest} AND ${users.email} IS NOT NULL AND ${users.subscriptionId} IS NOT NULL`);
  return accounts.filter((u) => {
    if (u.role === 'admin' || u.subscriptionStatus === 'trialing') return false;
    const access = accessFor(u, now);
    return access.subscribed && (access.status === 'active' || access.status === 'past_due' || access.status === 'canceled');
  }).length;
}

function tokenMatches(given: string | undefined): boolean {
  const expected = env.STATS_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Skrivebeskyttet tæller til administratorens egen PC (morgen-tælleren).
 * Kræver headeren `X-Stats-Token` = STATS_TOKEN og returnerer kun et tal – ingen kundedata.
 * Uden STATS_TOKEN er endpointet slået fra (404).
 */
export function statsRoutes({ db }: AppContext): Router {
  const r = Router();
  r.get('/paying', async (req, res) => {
    if (!env.STATS_TOKEN) throw new HttpError(404, 'Ikke fundet');
    if (!tokenMatches(req.header('x-stats-token'))) throw new HttpError(401, 'Ugyldig nøgle');
    res.set('Cache-Control', 'no-store');
    res.json({ paying: await payingCount(db), at: new Date().toISOString() });
  });
  return r;
}
