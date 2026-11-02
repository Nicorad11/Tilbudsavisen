import { eq } from 'drizzle-orm';
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { env, log } from '../env';
import { roleForEmail, verifyAccessToken, type AccessClaims } from '../services/auth';
import { HttpError } from './errors';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AccessClaims;
    /** Sat af adminGuard: administratoren bag forespørgslen. */
    admin?: { id: string; email: string | null };
  }
}

export const REFRESH_COOKIE = 'tr_refresh';

/**
 * Refresh-cookien: HttpOnly (JavaScript kan ikke læse den), Secure i produktion,
 * SameSite=Strict som standard og kun sendt til /api/auth. Samme indstillinger
 * bruges, når den slettes – ellers sletter browseren den ikke.
 */
export function refreshCookieOptions(
  expires?: Date,
  config: { isProd: boolean; sameSite: CookieOptions['sameSite'] & string } = { isProd: env.isProd, sameSite: env.COOKIE_SAMESITE },
): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProd || config.sameSite === 'none',
    sameSite: config.sameSite,
    path: '/api/auth',
    ...(expires ? { expires } : {}),
  };
}

/** Læser Bearer-token hvis det findes – kræver det ikke. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const claims = verifyAccessToken(header.slice(7));
    if (claims) req.auth = claims;
  }
  next();
};

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new HttpError(401, 'Log ind eller fortsæt som gæst'));
    return;
  }
  next();
}

export function requireAccount(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(new HttpError(401, 'Log ind for at fortsætte'));
  if (req.auth.guest) return next(new HttpError(403, 'Denne funktion kræver en konto'));
  next();
}

let warnedOpenAdmin = false;

/**
 * Rolle-tjek for alle /api/admin-endpoints – på serveren, ved hver forespørgsel.
 * Ud over admin-rollen i adgangstokenet skal brugeren stadig findes og stå i
 * ADMIN_EMAILS, så en fjernet administrator mister adgangen med det samme.
 * Svarene siger ikke hvorfor: 401 uden login, ellers 403.
 *
 * I udvikling uden ADMIN_EMAILS er endpoints åbne, så projektet kan afprøves
 * uden opsætning – det logges tydeligt.
 */
export function adminGuard(db: Db): RequestHandler {
  return async (req, _res, next) => {
    if (adminOpen()) {
      if (!warnedOpenAdmin) {
        log.warn('Admin-endpoints er åbne (development uden ADMIN_EMAILS). Sæt ADMIN_EMAILS før deploy.');
        warnedOpenAdmin = true;
      }
      return next();
    }
    if (!req.auth) return next(new HttpError(401, 'Ikke logget ind'));
    if (req.auth.role !== 'admin' || req.auth.guest) return next(new HttpError(403, 'Ingen adgang'));
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, req.auth.sub)).limit(1);
    if (!user || roleForEmail(user.email) !== 'admin') return next(new HttpError(403, 'Ingen adgang'));
    req.admin = user;
    next();
  };
}

export function userId(req: Request): string {
  if (!req.auth) throw new HttpError(401, 'Ikke logget ind');
  return req.auth.sub;
}

export function adminOpen(): boolean {
  return !env.isProd && env.adminEmails.length === 0;
}
