import { CONFIG_ELEMENT_ID, type PublicConfig } from '@tilbudsradar/shared';

/**
 * Kørselskonfiguration. I produktion indsætter serveren den i index.html ud
 * fra sine miljøvariabler (COMPANY_*, CONTACT_EMAIL, VITE_INSTAGRAM_URL,
 * VITE_PLAUSIBLE_*, VITE_SENTRY_DSN), så den ikke skal bages ind ved build.
 * Under udvikling med Vite bruges VITE_*-variablerne fra .env i rodmappen.
 */
function injected(): Partial<PublicConfig> {
  if (typeof document === 'undefined') return {};
  try {
    return JSON.parse(document.getElementById(CONFIG_ELEMENT_ID)?.textContent || '{}') as Partial<PublicConfig>;
  } catch {
    return {};
  }
}

const env = import.meta.env as Record<string, string | undefined>;
const fromEnv = (key: string) => env[key]?.trim() || null;
const httpsOnly = (v: string | null) => (v && v.startsWith('https://') ? v : null);
const server = injected();
/** Serverens værdi vinder – også når den bevidst er tom (null). */
const pick = <K extends keyof PublicConfig>(key: K, fallback: PublicConfig[K]): PublicConfig[K] =>
  key in server ? (server[key] as PublicConfig[K]) : fallback;

export const CONFIG: PublicConfig = {
  companyName: pick('companyName', '[UDFYLD: firmanavn]'),
  companyCvr: pick('companyCvr', '[UDFYLD: CVR]'),
  companyAddress: pick('companyAddress', '[UDFYLD: adresse]'),
  contactEmail: pick('contactEmail', 'kontakt@tilbudsradaren.dk'),
  instagramUrl: pick('instagramUrl', httpsOnly(fromEnv('VITE_INSTAGRAM_URL'))),
  appUrl: pick('appUrl', typeof window !== 'undefined' ? window.location.origin : 'https://tilbudsradaren.dk'),
  plausibleDomain: pick('plausibleDomain', fromEnv('VITE_PLAUSIBLE_DOMAIN')),
  plausibleSrc: pick('plausibleSrc', fromEnv('VITE_PLAUSIBLE_SRC') ?? 'https://plausible.io/js/script.js'),
  sentryDsn: pick('sentryDsn', fromEnv('VITE_SENTRY_DSN')),
  sentryEnvironment: pick('sentryEnvironment', import.meta.env.MODE),
};
