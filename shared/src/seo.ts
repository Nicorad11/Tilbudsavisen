import { PLAN } from './billing';

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
    description: `Tilbudsradar koster ${PLAN.priceDkk} kr. om måneden inkl. moms. ${PLAN.trialDays} dages gratis prøveperiode uden kort, ingen binding.`,
  },
  '/handelsbetingelser': { title: 'Handelsbetingelser | Tilbudsradar', description: 'Handelsbetingelser for abonnement på Tilbudsradar.' },
  '/privatlivspolitik': { title: 'Privatlivspolitik | Tilbudsradar', description: 'Sådan behandler Tilbudsradar dine personoplysninger.' },
  '/cookies': { title: 'Cookies | Tilbudsradar', description: 'Tilbudsradar bruger kun strengt nødvendige cookies – derfor ingen cookie-banner.' },
  '/om': { title: 'Om Tilbudsradar', description: 'Hvem står bag Tilbudsradar, og hvordan kontakter du os.' },
  '/fortryd': {
    title: 'Fortryd aftale | Tilbudsradar',
    description: 'Fortryd dit abonnement på Tilbudsradar inden for 14 dage.',
  },
  '/app': { title: 'Ugens tilbud | Tilbudsradar', description: DEFAULT_DESCRIPTION },
  '/app/sog': { title: 'Søg i ugens tilbudsaviser | Tilbudsradar', description: DEFAULT_DESCRIPTION },
  '/app/lister': { title: 'Indkøbslister | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/kvitteringer': { title: 'Kvitteringer | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/alarmer': { title: 'Prisalarmer | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/konto': { title: 'Konto | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
  '/app/kilder': { title: 'Kilder | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true },
};

/**
 * Offentlig kørselskonfiguration. Serveren indsætter den i index.html som
 * <script type="application/json" id="tr-config">, så firmaoplysninger,
 * Instagram, Plausible og Sentry styres af serverens miljøvariabler – uden
 * at frontenden skal bygges igen. Kun ikke-hemmelige værdier.
 */
export interface PublicConfig {
  companyName: string;
  companyCvr: string;
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
export const SITEMAP_PATHS = ['/', '/priser', '/app', '/app/sog', '/om', '/handelsbetingelser', '/privatlivspolitik', '/cookies'];

export function metaForPath(path: string): PageMeta {
  const clean = path.replace(/\/+$/, '') || '/';
  if (PAGE_META[clean]) return PAGE_META[clean]!;
  // Ukendte /app-sider (betaling, nulstilling, kvitteringsdetaljer …) er private.
  if (clean.startsWith('/app/')) return { title: 'Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true };
  return { title: 'Siden findes ikke | Tilbudsradar', description: DEFAULT_DESCRIPTION, noindex: true, notFound: true };
}
