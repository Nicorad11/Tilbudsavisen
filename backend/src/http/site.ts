import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_ELEMENT_ID, renderHeadTags, seoForPath, SITEMAP_PATHS, type PublicConfig } from '@tilbudsradar/shared';
import express, { type Express, type Request } from 'express';
import type { Db } from '../db/client';
import { env, log } from '../env';
import { requestHost } from './canonical';
import { createSsr, isServerRendered, loadSsrModule, type Ssr } from './ssr';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Meta-tags til en fast side ud fra stien – erstatter blokken mellem <!--seo--> og <!--/seo--> i index.html. */
export function seoTags(pathname: string): string {
  return renderHeadTags(seoForPath(pathname), env.APP_URL);
}

/** Det frontenden må vide om driften – ingen hemmeligheder. */
export function publicConfig(): PublicConfig {
  return {
    companyName: env.COMPANY_NAME,
    companyCvr: env.COMPANY_CVR,
    vatRegistered: env.VAT_REGISTERED,
    companyAddress: env.COMPANY_ADDRESS,
    contactEmail: env.CONTACT_EMAIL,
    instagramUrl: env.VITE_INSTAGRAM_URL,
    appUrl: env.APP_URL,
    plausibleDomain: env.VITE_PLAUSIBLE_DOMAIN,
    plausibleSrc: env.VITE_PLAUSIBLE_SRC,
    sentryDsn: env.VITE_SENTRY_DSN,
    sentryEnvironment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    billingEnabled: env.billingEnabled,
  };
}

/** JSON-blok (ikke et script, så CSP'en tillader den). "<" escapes, så værdier ikke kan lukke tagget. */
export function configTag(): string {
  const json = JSON.stringify(publicConfig()).replace(/</g, '\\u003c');
  return `<script id="${CONFIG_ELEMENT_ID}" type="application/json">${json}</script>`;
}

/** Admin-appen ligger på sit eget værtsnavn (admin.tilbudsradaren.dk – under udvikling admin.localhost). */
export const isAdminHost = (req: Request) => requestHost(req).startsWith('admin.');

export function robotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /app/konto',
    'Disallow: /app/betaling/',
    'Disallow: /app/nulstil-adgangskode',
    'Disallow: /app/bekraeft-email',
    '',
    `Sitemap: ${env.APP_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = SITEMAP_PATHS.map(
    (p) => `  <url><loc>${esc(`${env.APP_URL}${p}`)}</loc><lastmod>${today}</lastmod><changefreq>${p.startsWith('/app') ? 'daily' : 'monthly'}</changefreq></url>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Gamle adresser fra før appen flyttede under /app – bevar links og bogmærker. */
const LEGACY_PATH = /^\/(?:sog|lister|kvitteringer|alarmer|konto)(?:\/.*)?$/;

/**
 * I produktion serverer backend også den byggede frontend (én service på Render):
 * hjemmesiden på hoveddomænet og admin-appen (admin.html) på admin-domænet.
 * Hjemmesiden udleverer aldrig admin.html, og admin-domænet viser kun admin-appen.
 */
/**
 * Hvornår security.txt udløber (RFC 9116: højst et år frem). Forny datoen,
 * inden den passerer – serveren advarer i loggen, når den er overskredet.
 */
export const SECURITY_TXT_EXPIRES = '2027-11-02T00:00:00.000Z';

/** /.well-known/security.txt – hvor sikkerhedsfund kan meldes. */
export function securityTxt(): string {
  return [
    `Contact: mailto:${env.CONTACT_EMAIL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    'Preferred-Languages: da, en',
    `Canonical: ${env.APP_URL}/.well-known/security.txt`,
    '',
  ].join('\n');
}

export function mountSite(app: Express, distDir = env.FRONTEND_DIST, deps: { db?: Db } = {}): void {
  if (Date.now() > Date.parse(SECURITY_TXT_EXPIRES)) {
    log.warn(`security.txt udløb ${SECURITY_TXT_EXPIRES.slice(0, 10)} – forny SECURITY_TXT_EXPIRES i backend/src/http/site.ts.`);
  }
  app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=86400').send(securityTxt());
  });
  app.get(LEGACY_PATH, (req, res, next) => (isAdminHost(req) ? next() : res.redirect(301, `/app${req.originalUrl}`)));
  app.get('/robots.txt', (req, res) => {
    res
      .type('text/plain')
      .set('Cache-Control', 'public, max-age=3600')
      .send(isAdminHost(req) ? 'User-agent: *\nDisallow: /\n' : robotsTxt());
  });
  app.get('/sitemap.xml', (req, res) => {
    if (isAdminHost(req)) {
      res.status(404).end();
      return;
    }
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapXml());
  });

  const indexFile = path.join(distDir, 'index.html');
  if (!existsSync(indexFile)) return;
  const template = readFileSync(indexFile, 'utf8');
  const adminFile = path.join(distDir, 'admin.html');
  const adminTemplate = existsSync(adminFile) ? readFileSync(adminFile, 'utf8') : null;
  const config = configTag();

  // Server-rendering af de offentlige sider, når frontenden er bygget med SSR-bundlet (og der er en database).
  const db = deps.db;
  const ssr: Promise<Ssr | null> = db
    ? loadSsrModule(distDir, publicConfig())
        .then((module) => (module ? createSsr({ db, module, template, configTag: config }) : null))
        .catch((err: unknown) => {
          log.error('SSR-bundlet kunne ikke indlæses – siderne renderes i browseren', { err: String(err) });
          return null;
        })
    : Promise.resolve(null);

  const assets = express.static(distDir, {
    index: false,
    setHeaders(res, file) {
      const name = path.basename(file);
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (name === 'sw.js' || name === 'manifest.webmanifest') res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  });
  // admin.html udleveres kun som side på admin-domænet (nedenfor), aldrig som fil – og SSR-bundlet
  // (dist/server) er serverkode, ikke en offentlig fil.
  app.use((req, res, next) => (req.path === '/admin.html' || req.path.startsWith('/server/') ? next() : assets(req, res, next)));

  app.get(/^(?!\/api(\/|$)).*/, (req, res, next) => {
    if (!isAdminHost(req)) return next();
    if (!adminTemplate) {
      res.status(404).type('text/plain').send('Admin-appen er ikke bygget');
      return;
    }
    res
      .set('Cache-Control', 'no-cache')
      .set('X-Robots-Tag', 'noindex, nofollow')
      .type('html')
      .send(adminTemplate.replace('<!--config-->', () => config));
  });

  app.get(/^(?!\/api(\/|$)).*/, async (req, res) => {
    const renderer = isServerRendered(req.path) ? await ssr : null;
    if (renderer) {
      try {
        const page = await renderer.render(req.path);
        res.status(page.status).set('Cache-Control', 'no-cache').type('html').send(page.html);
        return;
      } catch (err) {
        // Siden virker stadig – den renderes bare i browseren.
        log.error(`SSR af ${req.path} fejlede`, { err: err instanceof Error ? (err.stack ?? err.message) : String(err) });
      }
    }
    // /app og reserven: app-skallen, som renderes i browseren.
    const html = template.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, () => `${seoTags(req.path)}\n    ${config}`);
    res
      .status(seoForPath(req.path).notFound ? 404 : 200)
      .set('Cache-Control', 'no-cache')
      .type('html')
      .send(html);
  });
}
