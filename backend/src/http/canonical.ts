import type { Request, RequestHandler } from 'express';

/**
 * Værtsnavnet fra Host-headeren – uden port, i små bogstaver. Ikke req.hostname:
 * med "trust proxy" læser Express den fra X-Forwarded-Host, som klienten selv
 * kan sætte.
 */
export function requestHost(req: Request): string {
  const host = (req.headers.host ?? '').trim().toLowerCase();
  const withoutPort = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '');
  return withoutPort.replace(/\.$/, '');
}

/**
 * Permanent omdirigering til det kanoniske domæne (APP_URL) med samme sti og
 * query – fx fra tilbudsradar.onrender.com og www. Admin-appens domæne
 * (admin.<domæne>) er undtaget, og det samme er /api/health, så Renders
 * health check virker uanset værtsnavn.
 */
export function canonicalHost(appUrl: string): RequestHandler {
  const canonical = new URL(appUrl);
  const allowed = new Set([canonical.hostname, `admin.${canonical.hostname}`]);
  return (req, res, next) => {
    if (req.path === '/api/health' || allowed.has(requestHost(req))) return next();
    // 308 bevarer metode og body for POST m.m.; GET/HEAD får den klassiske 301.
    const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
    res.redirect(status, `${canonical.origin}${req.originalUrl}`);
  };
}
