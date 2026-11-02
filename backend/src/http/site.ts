import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_ELEMENT_ID, renderHeadTags, seoForPath, SITEMAP_PATHS, STATIC_LASTMOD, type PublicConfig } from '@tilbudsradar/shared';
import express, { type Express, type Request, type RequestHandler } from 'express';
import type { Db } from '../db/client';
import { env, log } from '../env';
import { llmsTxt } from '../services/seo/llmsTxt';
import { OG_KINDS, renderInsightsOgImage, renderOgImage, type OgKind } from '../services/seo/ogImage';
import { SITEMAP_NAMES, sitemapIndexXml, sitemaps, urlsetXml } from '../services/seo/sitemap';
import { requestHost } from './canonical';
import { createSsr, isServerRendered, loadSsrModule, type Ssr } from './ssr';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Meta-tags til en fast side ud fra stien – erstatter blokken mellem <!--seo--> og <!--/seo--> i index.html. */
export function seoTags(pathname: string): string {
  return renderHeadTags(seoForPath(pathname, { appUrl: env.APP_URL, instagramUrl: env.VITE_INSTAGRAM_URL }), env.APP_URL);
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
    'Disallow: /app/bekraeft-fortrydelse',
    '',
    `Sitemap: ${env.APP_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

/** Kun de faste sider – bruges, når der ikke er en database (fx i tests af mountSite). */
export function sitemapXml(): string {
  const today = new Date().toISOString().slice(0, 10);
  return urlsetXml(
    SITEMAP_PATHS.map((p) => ({ path: p, lastmod: STATIC_LASTMOD[p] ?? today })),
    env.APP_URL,
  );
}

/**
 * Én kanonisk adresse pr. side: afsluttende skråstreg og store bogstaver
 * sendes videre (301) til den kanoniske sti med samme query. Filer, /api og
 * admin-domænet røres ikke.
 */
export const canonicalPath: RequestHandler = (req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || /^\/(api|assets|server)\//.test(req.path) || isAdminHost(req)) return next();
  if (/\.[a-z0-9]+$/i.test(req.path)) return next();
  let target = req.path.length > 1 ? req.path.replace(/\/+$/, '') || '/' : req.path;
  // Procent-kodede tegn (%C3%B8 = ø) tæller ikke som store bogstaver.
  if (/[A-ZÆØÅ]/.test(target.replace(/%[0-9a-f]{2}/gi, ''))) target = target.toLocaleLowerCase('da-DK');
  if (target === req.path) return next();
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, `${target}${query}`);
};

/** Ekstra i <head>: ejerskabsbekræftelse (Google/Bing) og forudindlæsning af skrifttypen. */
function extraHeadTags(distDir: string): string {
  const assets = path.join(distDir, 'assets');
  const font = existsSync(assets) ? readdirSync(assets).find((f) => /^inter-tight-latin-wght-normal-.+\.woff2$/.test(f)) : undefined;
  return [
    env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(env.GOOGLE_SITE_VERIFICATION)}" />` : '',
    env.BING_SITE_VERIFICATION ? `<meta name="msvalidate.01" content="${esc(env.BING_SITE_VERIFICATION)}" />` : '',
    font ? `<link rel="preload" href="/assets/${font}" as="font" type="font/woff2" crossorigin />` : '',
  ]
    .filter(Boolean)
    .join('\n    ');
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
  app.use(canonicalPath);
  app.get(LEGACY_PATH, (req, res, next) => (isAdminHost(req) ? next() : res.redirect(301, `/app${req.originalUrl}`)));
  app.get('/robots.txt', (req, res) => {
    res
      .type('text/plain')
      .set('Cache-Control', 'public, max-age=3600')
      .send(isAdminHost(req) ? 'User-agent: *\nDisallow: /\n' : robotsTxt());
  });

  // Kort oversigt til AI-assistenter (llmstxt.org) – ikke på admin-domænet.
  app.get('/llms.txt', (req, res, next) => {
    if (isAdminHost(req)) return next();
    res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(llmsTxt(env.APP_URL, env.CONTACT_EMAIL));
  });

  // IndexNow: nøglefilen beviser, at nøglen hører til domænet.
  if (env.INDEXNOW_KEY) {
    const key = env.INDEXNOW_KEY;
    app.get(`/${key}.txt`, (_req, res) => {
      res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(key);
    });
  }

  const db = deps.db;
  // Sitemap-indeks og ét sitemap pr. sidetype – kun sider, der må indekseres, med rigtig lastmod.
  app.get('/sitemap.xml', async (req, res) => {
    if (isAdminHost(req)) {
      res.status(404).end();
      return;
    }
    const xml = db ? sitemapIndexXml(await sitemaps(db), env.APP_URL) : sitemapXml();
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  });
  app.get(/^\/sitemap-([a-z]+)\.xml$/, async (req, res, next) => {
    const name = req.params[0] as (typeof SITEMAP_NAMES)[number];
    if (!db || isAdminHost(req) || !SITEMAP_NAMES.includes(name)) return next();
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(urlsetXml((await sitemaps(db))[name], env.APP_URL));
  });

  // Delingsbilleder til datasiderne. Findes siden ikke, eller fejler tegningen, bruges standardbilledet.
  const sendPng = async (req: Request, res: express.Response, render: () => Promise<Buffer | null>) => {
    try {
      const png = await render();
      if (png) {
        res.type('image/png').set('Cache-Control', 'public, max-age=3600').send(png);
        return;
      }
    } catch (err) {
      log.warn(`Delingsbillede ${req.path} kunne ikke tegnes`, { err: err instanceof Error ? err.message : String(err) });
    }
    res.redirect(302, '/og-image.png');
  };
  app.get('/og/indsigt.png', (req, res, next) => (!db || isAdminHost(req) ? next() : sendPng(req, res, () => renderInsightsOgImage(db))));
  app.get(/^\/og\/([a-z]+)\/([a-z0-9-]{1,60})\.png$/, async (req, res, next) => {
    const kind = req.params[0] as OgKind;
    if (!db || isAdminHost(req) || !OG_KINDS.includes(kind)) return next();
    await sendPng(req, res, () => renderOgImage(db, kind, String(req.params[1])));
  });

  const indexFile = path.join(distDir, 'index.html');
  if (!existsSync(indexFile)) return;
  const template = readFileSync(indexFile, 'utf8');
  const adminFile = path.join(distDir, 'admin.html');
  const adminTemplate = existsSync(adminFile) ? readFileSync(adminFile, 'utf8') : null;
  const config = configTag();
  const extraHead = extraHeadTags(distDir);
  const headEnd = [config, extraHead].filter(Boolean).join('\n    ');

  // Server-rendering af de offentlige sider, når frontenden er bygget med SSR-bundlet (og der er en database).
  const ssr: Promise<Ssr | null> = db
    ? loadSsrModule(distDir, publicConfig())
        .then((module) => (module ? createSsr({ db, module, template, configTag: headEnd }) : null))
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
    const html = template.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, () => `${seoTags(req.path)}\n    ${headEnd}`);
    res
      .status(seoForPath(req.path).notFound ? 404 : 200)
      .set('Cache-Control', 'no-cache')
      .type('html')
      .send(html);
  });
}
