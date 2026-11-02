import type { RequestHandler } from 'express';
import type { Db } from '../db/client';
import { adminAuditLog } from '../db/schema';
import { log } from '../env';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CUSTOMER_PATH = /^\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/|$)/i;
const CUSTOMER_VIEW = /^\/users\/[0-9a-f-]{36}\/?$/i;
const TARGET_PATH = /^\/(stores|sources)\/([^/]+)/;

/** Alt der ændrer noget logges – og opslag på en enkelt kunde, fordi det viser persondata. */
function isAudited(method: string, path: string): boolean {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  return CUSTOMER_VIEW.test(path);
}

/** Feltværdier fra body. E-mailadresser gemmes ikke, og tekster afkortes. */
function summarize(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const value = (v: unknown): unknown => {
    if (typeof v === 'string') return v.includes('@') ? '[e-mail]' : v.slice(0, 200);
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => (typeof x === 'object' && x !== null ? '[…]' : value(x)));
    return '[…]';
  };
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, value(v)]));
}

/**
 * Revisionslog for /api/admin: hvem (administratoren), hvad (metode og sti),
 * hvornår, hvilken kunde og med hvilket resultat. Rækken skrives, når svaret er
 * sendt, så også afviste forsøg kommer med. Skal monteres efter adminGuard.
 */
export function adminAudit(db: Db): RequestHandler {
  return (req, res, next) => {
    const path = req.path; // inden for /api/admin, uden query
    if (!isAudited(req.method, path)) return next();
    const customerId = CUSTOMER_PATH.exec(path)?.[1]?.toLowerCase() ?? null;
    const target = TARGET_PATH.exec(path);
    const action = `${req.method} ${path.replace(UUID, ':id').replace(TARGET_PATH, '/$1/:id')}`;
    const admin = req.admin;
    res.on('finish', () => {
      db.insert(adminAuditLog)
        .values({
          adminId: admin?.id ?? null,
          adminEmail: admin?.email ?? null,
          action,
          customerId,
          targetId: target ? decodeURIComponent(target[2]!).slice(0, 100) : null,
          status: res.statusCode,
          details: summarize(req.body),
        })
        .catch((err: unknown) => log.error('Kunne ikke skrive til admin-revisionsloggen', { action, err: String(err) }));
    });
    next();
  };
}
