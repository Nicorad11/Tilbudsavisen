import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import { clientKey } from './clientIp';

/**
 * Fælles rate limiter: nøglen er klientens rigtige IP (se clientIp.ts), ikke
 * Cloudflares eller Renders proxy-IP – ellers deler brugerne kvote.
 *
 * Tællerne ligger i hukommelsen (MemoryStore). Det passer til én instans på
 * Render. Skaleres tjenesten til flere instanser, tæller hver instans for sig,
 * og grænserne skal flyttes til et delt lager (fx Postgres eller Render Key Value).
 */
export function limiter(options: Partial<Options> & Pick<Options, 'limit' | 'windowMs'>) {
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => clientKey(req),
    message: { error: 'For mange forespørgsler. Prøv igen om lidt.' },
    ...options,
  });
}

/** Nøgle pr. e-mailadresse (hashet, så adresserne ikke ligger i hukommelsen). Uden e-mail: pr. IP. */
export function emailKey(req: Request): string {
  const value = (req.body as { email?: unknown } | undefined)?.email;
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email ? `email:${createHash('sha256').update(email).digest('hex')}` : `ip:${clientKey(req)}`;
}

/** Højst 10 forsøg pr. e-mail pr. 15 minutter – oven i grænsen pr. IP, så et angreb fra mange IP'er også stoppes. */
export function perEmailLimiter(options: Partial<Options> = {}) {
  return limiter({
    windowMs: 15 * 60_000,
    limit: 10,
    keyGenerator: emailKey,
    message: { error: 'For mange forsøg med denne e-mail. Vent et kvarter, og prøv igen.' },
    ...options,
  });
}
