import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env, log } from '../env';
import { verifyAccessToken, type AccessClaims } from '../services/auth';
import { HttpError } from './errors';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AccessClaims;
  }
}

export const REFRESH_COOKIE = 'tr_refresh';

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
 * Admin-endpoints (kilder, manuel scraping). I udvikling uden ADMIN_EMAILS er
 * de åbne, så projektet kan afprøves uden opsætning – det logges tydeligt.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.role === 'admin') return next();
  if (!env.isProd && env.adminEmails.length === 0) {
    if (!warnedOpenAdmin) {
      log.warn('Admin-endpoints er åbne (development uden ADMIN_EMAILS). Sæt ADMIN_EMAILS før deploy.');
      warnedOpenAdmin = true;
    }
    return next();
  }
  next(new HttpError(403, 'Kræver administratoradgang'));
}

export function userId(req: Request): string {
  if (!req.auth) throw new HttpError(401, 'Ikke logget ind');
  return req.auth.sub;
}

export function adminOpen(): boolean {
  return !env.isProd && env.adminEmails.length === 0;
}
