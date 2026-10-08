import type { AccessDTO } from '@tilbudsradar/shared';
import { PLAN } from '@tilbudsradar/shared';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { accessFor } from '../services/auth';
import { HttpError } from './errors';

declare module 'express-serve-static-core' {
  interface Request {
    account?: typeof users.$inferSelect;
    access?: AccessDTO;
  }
}

/**
 * Betalte funktioner kræver en aktiv prøveperiode eller et abonnement.
 * Brugere uden adgang kan stadig læse og slette deres egne data (de ruter
 * bruger kun requireAuth) – data bliver skrivebeskyttede, ikke slettet.
 */
export function planGuard(db: Db) {
  return async function requirePlan(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) {
        throw new HttpError(401, 'Log ind for at bruge denne funktion', undefined, 'ACCOUNT_REQUIRED');
      }
      const [user] = await db.select().from(users).where(eq(users.id, req.auth.sub)).limit(1);
      if (!user) throw new HttpError(401, 'Brugeren findes ikke længere', undefined, 'ACCOUNT_REQUIRED');
      const access = accessFor(user);
      if (!access.hasAccess) {
        if (user.isGuest) {
          throw new HttpError(
            402,
            `Opret en gratis konto for at bruge denne funktion – du får ${PLAN.trialDays} dages prøveperiode uden kort.`,
            { access },
            'ACCOUNT_REQUIRED',
          );
        }
        throw new HttpError(
          402,
          access.trialUsed
            ? 'Din prøveperiode er slut. Abonnér for at bruge denne funktion igen – dine data er gemt.'
            : 'Denne funktion kræver et abonnement.',
          { access },
          'PLAN_REQUIRED',
        );
      }
      req.account = user;
      req.access = access;
      next();
    } catch (err) {
      next(err);
    }
  };
}
