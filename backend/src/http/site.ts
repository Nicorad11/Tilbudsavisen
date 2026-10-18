import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_ELEMENT_ID, metaForPath, SITE_NAME, SITEMAP_PATHS, type PublicConfig } from '@tilbudsradar/shared';
import express, { type Express, type Request } from 'express';
import { env } from '../env';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Meta-tags til en side – erstatter blokken mellem <!--seo--> og <!--/seo--> i index.html. */
export function seoTags(pathname: string): string {
  const meta = metaForPath(pathname);
  const url = `${env.APP_URL}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`;
  const image = `${env.APP_URL}/og-image.png`;
  return [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    meta.noindex ? '<meta name="robots" content="noindex" />' : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="da_DK" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Tilbudsradar – find ugens bedste tilbud" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ]
    .filter(Boolean)
    .join('\n    ');
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
export const isAdminHost = (req: Request) => req.hostname.startsWith('admin.');

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
export function mountSite(app: Express, distDir = env.FRONTEND_DIST): void {
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

  const assets = express.static(distDir, {
    index: false,
    setHeaders(res, file) {
      const name = path.basename(file);
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (name === 'sw.js' || name === 'manifest.webmanifest') res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  });
  // admin.html udleveres kun som side på admin-domænet (nedenfor), aldrig som fil.
  app.use((req, res, next) => (req.path === '/admin.html' ? next() : assets(req, res, next)));

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

  app.get(/^(?!\/api(\/|$)).*/, (req, res) => {
    const html = template.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, () => `${seoTags(req.path)}\n    ${config}`);
    res
      .status(metaForPath(req.path).notFound ? 404 : 200)
      .set('Cache-Control', 'no-cache')
      .type('html')
      .send(html);
  });
}
