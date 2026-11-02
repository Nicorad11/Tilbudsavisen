import { PLAN, TERMS_VERSION } from './billing';
import { breadcrumbJsonLd, organizationJsonLd, websiteJsonLd, type SiteInfo } from './jsonLd';

/**
 * Titler og beskrivelser pr. side. Serveren indsætter dem i HTML'en (så
 * delingsbilleder fra fx Instagram virker uden JavaScript), og frontenden
 * opdaterer dem ved navigation.
 */
export interface PageMeta {
  title: string;
  description: string;
  /** Private sider skal ikke indekseres. */
  noindex?: boolean;
  /** Ukendt adresse – serveren svarer 404. */
  notFound?: boolean;
}

const DEFAULT_DESCRIPTION = `Find ugens bedste tilbud fra REMA 1000, Netto, føtex, Bilka og Lidl. Sammenlign prisen pr. kilo på tværs af kæderne og se, om tilbuddet er reelt. Prøv gratis i ${PLAN.trialDays} dage.`;

export const SITE_NAME = 'Tilbudsradar';

export const PAGE_META: Record<string, PageMeta> = {
  '/': { title: 'Tilbudsradar – alle tilbudsaviser i ét søgefelt', description: DEFAULT_DESCRIPTION },
  '/priser': {
    title: `Priser – ${PLAN.priceDkk} kr/md, ${PLAN.trialDays} dage gratis | Tilbudsradar`,
    description: `Tilbudsradar koster ${PLAN.priceDkk} kr. om måneden. ${PLAN.trialDays} dages gratis prøveperiode uden kort, ingen binding.`,
  },
  '/handelsbetingelser': { title: 'Handelsbetingelser | Tilbudsradar', description: 'Handelsbetingelser for abonnement på Tilbudsradar.' },
  '/privatlivspolitik': { title: 'Privatlivspolitik | Tilbudsradar', description: 'Sådan behandler Tilbudsradar dine personoplysninger.' },
  '/cookies': { title: 'Cookies | Tilbudsradar', description: 'Tilbudsradar bruger kun strengt nødvendige cookies – derfor ingen cookie-banner.' },
  '/om': { title: 'Om Tilbudsradar', description: 'Hvem står bag Tilbudsradar, og hvordan kontakter du os.' },
  '/fortryd': {
    title: 'Fortryd aftale | Tilbudsradar',
    description: 'Fortryd dit abonnement på Tilbudsradar inden for 14 dage.',
  },
  // Appen er en tom skal for crawlere – indholdet ligger på datasiderne (/tilbud …). noindex,follow samler signalerne dér.
  '/app': { title: 'Ugens tilbud | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/sog': { title: 'Søg i ugens tilbudsaviser | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/lister': { title: 'Indkøbslister | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/kvitteringer': { title: 'Kvitteringer | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/alarmer': { title: 'Prisalarmer | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/konto': { title: 'Konto | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
};

/**
 * Offentlig kørselskonfiguration. Serveren indsætter den i index.html som
 * <script type="application/json" id="tr-config">, så firmaoplysninger,
 * Instagram, Plausible og Sentry styres af serverens miljøvariabler – uden
 * at frontenden skal bygges igen. Kun ikke-hemmelige værdier.
 */
export interface PublicConfig {
  companyName: string;
  companyCvr: string | null;
  vatRegistered: boolean;
  companyAddress: string;
  contactEmail: string;
  instagramUrl: string | null;
  appUrl: string;
  plausibleDomain: string | null;
  plausibleSrc: string;
  sentryDsn: string | null;
  sentryEnvironment: string;
  /** Betaling er åbnet (Stripe sat op). Ellers er siden i lanceringsperiode, hvor alt er gratis. */
  billingEnabled: boolean;
}

export const CONFIG_ELEMENT_ID = 'tr-config';

/** Sider i sitemap.xml. */
/** Faste sider i sitemap-pages.xml (datasiderne har deres egne sitemaps). */
export const SITEMAP_PATHS = [
  '/',
  '/tilbud',
  '/butikker',
  '/ugens-bedste-tilbud',
  '/indsigt',
  '/metode',
  '/priser',
  '/om',
  '/fortryd',
  '/handelsbetingelser',
  '/privatlivspolitik',
  '/cookies',
];

/** Seneste indholdsændring på de faste sider (lastmod i sitemap). Forsiden og hubs følger dataene. */
export const STATIC_LASTMOD: Record<string, string> = {
  '/priser': '2026-11-02',
  '/om': '2026-11-02',
  '/metode': '2026-11-02',
  '/fortryd': '2026-11-02',
  '/handelsbetingelser': TERMS_VERSION,
  '/privatlivspolitik': '2026-11-02',
  '/cookies': '2026-11-02',
};

/** Brødkrumme-navne for de faste sider. */
const STATIC_CRUMBS: Record<string, string> = {
  '/priser': 'Priser',
  '/om': 'Om Tilbudsradar',
  '/fortryd': 'Fortryd aftale',
  '/handelsbetingelser': 'Handelsbetingelser',
  '/privatlivspolitik': 'Privatlivspolitik',
  '/cookies': 'Cookies',
};

/** Stien uden afsluttende skråstreg ("/" for forsiden). */
export const cleanPath = (path: string) => path.replace(/\/+$/, '') || '/';

export function metaForPath(path: string): PageMeta {
  const clean = cleanPath(path);
  if (PAGE_META[clean]) return PAGE_META[clean]!;
  // Ukendte /app-sider (betaling, nulstilling, kvitteringsdetaljer …) er private.
  if (clean.startsWith('/app/')) return { title: 'Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true };
  return { title: 'Siden findes ikke | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true, notFound: true };
}

/**
 * Alt i <head> for én side. Serveren skriver det ind i HTML'en, og frontenden
 * sætter de samme værdier ved navigation – så crawlere, delingslinks og
 * brugere ser det samme.
 */
export interface SeoMeta extends PageMeta {
  /** Kanonisk sti uden query. Mangler på 404-sider. */
  path?: string;
  /** Delingsbillede (rod-relativ eller absolut adresse). Standard: /og-image.png. */
  image?: string;
  imageAlt?: string;
  /** Strukturerede data (schema.org), indsat som application/ld+json. */
  jsonLd?: object[];
}

export const DEFAULT_OG_IMAGE = '/og-image.png';
const DEFAULT_OG_ALT = 'Tilbudsradar – find ugens bedste tilbud';

/**
 * Meta for de faste sider ud fra stien (forside, priser, juridiske sider og 404).
 * Med `site` får siderne også strukturerede data: forsiden Organization og
 * WebSite, de øvrige faste sider en brødkrumme.
 */
export function seoForPath(path: string, site?: SiteInfo): SeoMeta {
  const clean = cleanPath(path);
  const meta = metaForPath(clean);
  if (meta.notFound) return meta;
  const result: SeoMeta = { ...meta, path: clean };
  if (site && clean === '/') result.jsonLd = [organizationJsonLd(site), websiteJsonLd(site)];
  else if (site && STATIC_CRUMBS[clean]) {
    result.jsonLd = [breadcrumbJsonLd([{ href: '/', label: 'Forside' }, { href: clean, label: STATIC_CRUMBS[clean]! }], site.appUrl)];
  }
  return result;
}

/** Indekserbare sider må vise store billeder og fulde uddrag; resten er noindex men følger links. */
export const robotsContent = (meta: Pick<SeoMeta, 'noindex'>) => (meta.noindex ? 'noindex,follow' : 'max-image-preview:large, max-snippet:-1');

export const absoluteUrl = (appUrl: string, pathOrUrl: string) => (/^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${appUrl}${pathOrUrl}`);

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** JSON til et <script>-tag: "<" escapes, så værdier ikke kan lukke tagget. */
export const jsonForScript = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

/** <head>-tags for en side som HTML (serveren). */
export function renderHeadTags(meta: SeoMeta, appUrl: string): string {
  const url = meta.path ? absoluteUrl(appUrl, meta.path) : null;
  const image = absoluteUrl(appUrl, meta.image ?? DEFAULT_OG_IMAGE);
  const alt = meta.imageAlt ?? DEFAULT_OG_ALT;
  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    url ? `<link rel="canonical" href="${escapeHtml(url)}" />` : '',
    `<meta name="robots" content="${robotsContent(meta)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="da_DK" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}" />` : '',
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    ...(meta.jsonLd ?? []).map((data) => `<script type="application/ld+json" data-tr-jsonld>${jsonForScript(data)}</script>`),
  ]
    .filter(Boolean)
    .join('\n    ');
}
