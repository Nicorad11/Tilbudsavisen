import path from 'node:path';
import { loadScraperConfig, type Logger } from '@tilbudsradar/scrapers';
import { z } from 'zod';
import { createAppLogger } from './log';

const ROOT = path.resolve(import.meta.dirname, '../..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // Ingen .env – standardværdier og eksisterende miljøvariabler bruges.
}

const DEV_SECRET = 'udviklings-hemmelighed-skift-mig-i-produktion-0123456789';
const DEFAULT_CONTACT = 'kontakt@tilbudsradaren.dk';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));
/** Tekst med pladsholder – også når variablen findes, men er tom (fx i Render). */
const withPlaceholder = (placeholder: string) =>
  z
    .string()
    .optional()
    .transform((v) => v?.trim() || placeholder);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Den offentlige adresse – bruges i links i e-mails, Stripe-redirects og canonical-URL'er. */
  APP_URL: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.trim().replace(/\/+$/, '')),
  DATABASE_URL: optional,
  PGLITE_DIR: z.string().default(path.join(ROOT, 'backend', '.data', 'pglite')),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default(DEV_SECRET),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  /** Frontend og API på samme domæne → Lax. Kun "none" hvis de ligger på hver sit domæne. */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  ADMIN_EMAILS: z.string().default(''),
  /** Hemmelig nøgle til morgen-tælleren på administratorens PC (GET /api/stats/paying). Tom = slået fra. */
  STATS_TOKEN: z
    .string()
    .default('')
    .transform((v) => v.trim()),
  SCRAPE_CRON: z.string().default('15 6,18 * * *'),
  STORES_CRON: z.string().default('30 3 * * 1'),
  /** Daglige mails om prøveperioden (Europe/Copenhagen). */
  BILLING_CRON: z.string().default('0 9 * * *'),
  SCRAPE_ON_STARTUP: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  // Stripe
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_ID: optional,
  STRIPE_PORTAL_CONFIG_ID: optional,
  /** Valgfri 25 % moms-sats (inklusiv), så fakturaerne viser momsen. Oprettes af npm run stripe:setup. */
  STRIPE_TAX_RATE_ID: optional,
  /** Dage med adgang efter en fejlet betaling, mens Stripe prøver igen. */
  PAST_DUE_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(5),

  // Kvitteringer
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  ANTHROPIC_EFFORT: z
    .enum(['low', 'medium', 'high', 'xhigh', 'max', ''])
    .default('')
    .transform((v) => (v === '' ? null : v)),
  RECEIPT_SCANS_PER_MONTH: z.coerce.number().int().min(0).default(20),
  /** Sprogdata til tekstgenkendelse af kvitteringer hentes hertil første gang (~3 MB). */
  OCR_CACHE_DIR: z.string().default(path.join(ROOT, 'backend', '.data', 'tessdata')),

  // E-mail
  SMTP_URL: optional,
  MAIL_FROM: z.string().default('Tilbudsradar <noreply@tilbudsradaren.dk>'),

  // Virksomheden (vises i e-mails – samme værdier som VITE_COMPANY_* i frontenden)
  COMPANY_NAME: withPlaceholder('[UDFYLD: firmanavn]'),
  /** Tom = intet CVR (enkeltmand) – så vises CVR ingen steder. */
  COMPANY_CVR: optional,
  /** Momsregistreret: priser vises "inkl. moms". Ellers står der kun prisen, og betingelserne siger, at der ikke er moms. */
  VAT_REGISTERED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  COMPANY_ADDRESS: withPlaceholder('[UDFYLD: adresse]'),
  CONTACT_EMAIL: withPlaceholder(DEFAULT_CONTACT),
  /** Link til Instagram-profilen i footer og på /om. Tom eller pladsholder = linket vises ikke. */
  VITE_INSTAGRAM_URL: optional.transform((v) => (v && /^https:\/\//.test(v) ? v : null)),

  // Drift
  SENTRY_DSN: optional,
  SENTRY_ENVIRONMENT: optional,
  /** Frontendens Sentry og Plausible – serveren giver dem til frontenden ved hver sidevisning, og CSP'en åbner kun for det, der bruges. */
  VITE_SENTRY_DSN: optional,
  VITE_PLAUSIBLE_DOMAIN: optional,
  VITE_PLAUSIBLE_SRC: z.string().default('https://plausible.io/js/script.js'),
  LOG_FORMAT: z.enum(['text', 'json', '']).default(''),
  FRONTEND_DIST: z.string().default(path.join(ROOT, 'frontend', 'dist')),
});

export type RawEnv = z.infer<typeof schema>;

/** Nøgler der skal være sat i produktion – opstarten stopper ellers med en tydelig besked. */
export const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'APP_URL', 'ADMIN_EMAILS'] as const;

/**
 * Betaling kan slås til senere. Er én af nøglerne sat, skal alle tre være det –
 * ellers ville betalinger kunne gå igennem uden at kontoen bliver opdateret.
 */
export const STRIPE_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID'] as const;

/** Problemer der stopper opstarten i produktion (tom liste = alt i orden). */
export function productionProblems(raw: RawEnv, source: NodeJS.ProcessEnv = process.env): string[] {
  if (raw.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const key of REQUIRED_IN_PRODUCTION) {
    const value = source[key];
    if (!value || !value.trim()) problems.push(`${key} mangler`);
  }
  const stripeSet = STRIPE_KEYS.filter((key) => source[key]?.trim());
  if (stripeSet.length && stripeSet.length < STRIPE_KEYS.length) {
    for (const key of STRIPE_KEYS) if (!stripeSet.includes(key)) problems.push(`${key} mangler (de tre Stripe-nøgler skal sættes samlet)`);
  }
  if (raw.JWT_SECRET === DEV_SECRET || raw.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET skal være en tilfældig streng på mindst 32 tegn');
  }
  if (source.APP_URL && !raw.APP_URL.startsWith('https://')) problems.push('APP_URL skal starte med https://');
  if (raw.STRIPE_SECRET_KEY && !/^(sk|rk)_(live|test)_/.test(raw.STRIPE_SECRET_KEY)) {
    problems.push('STRIPE_SECRET_KEY ligner ikke en Stripe-nøgle (sk_live_… eller rk_live_…)');
  }
  if (raw.STATS_TOKEN && raw.STATS_TOKEN.length < 32) problems.push('STATS_TOKEN skal være mindst 32 tegn (eller tom)');
  if (raw.STRIPE_WEBHOOK_SECRET && !raw.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    problems.push('STRIPE_WEBHOOK_SECRET skal starte med whsec_');
  }
  if (raw.STRIPE_PRICE_ID && !raw.STRIPE_PRICE_ID.startsWith('price_')) problems.push('STRIPE_PRICE_ID skal starte med price_');
  if (raw.COOKIE_SAMESITE === 'none' && !raw.APP_URL.startsWith('https://')) {
    problems.push('COOKIE_SAMESITE=none kræver https');
  }
  return problems;
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Ugyldig konfiguration:', z.prettifyError(parsed.error));
  process.exit(1);
}

const raw = parsed.data;

const problems = productionProblems(raw);
if (problems.length) {
  console.error(
    `Produktionsopstart stoppet – konfigurationen er ikke klar:\n${problems.map((p) => `  • ${p}`).join('\n')}\n` +
      'Se .env.example og LAUNCH_CHECKLIST.md.',
  );
  process.exit(1);
}

// Scraperne læser deres User-Agent fra miljøet. Uden en eksplicit værdi bruges
// det rigtige domæne og kontakt-e-mailen, så kæderne kan henvende sig.
// (En tom linje i .env tæller som "ikke sat".)
if (!process.env.SCRAPER_USER_AGENT?.trim()) {
  process.env.SCRAPER_USER_AGENT = `Tilbudsradar/1.0 (+${raw.APP_URL}; kontakt: ${raw.CONTACT_EMAIL})`;
}
if (!process.env.MAIL_FROM?.trim()) process.env.MAIL_FROM = raw.MAIL_FROM;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  adminEmails: raw.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  billingEnabled: Boolean(raw.STRIPE_SECRET_KEY && raw.STRIPE_PRICE_ID),
  scraper: loadScraperConfig(),
};

export const log: Logger = createAppLogger('api', {
  json: raw.LOG_FORMAT ? raw.LOG_FORMAT === 'json' : raw.NODE_ENV === 'production',
  level: env.isTest ? 'error' : 'info',
});

if (env.isProd && [raw.COMPANY_NAME, raw.COMPANY_ADDRESS].some((v) => v.includes('[UDFYLD'))) {
  log.warn('Navn og adresse (COMPANY_NAME, COMPANY_ADDRESS) er ikke udfyldt – de vises i e-mails og på siden.');
}
if (env.isProd && !raw.VITE_INSTAGRAM_URL) log.warn('VITE_INSTAGRAM_URL er ikke sat (eller er ikke https://) – Instagram-linket vises ikke.');
if (env.isProd && !env.billingEnabled) {
  log.warn('Stripe er ikke sat op – prøveperioder kører, men abonnementer kan ikke tegnes endnu (se LAUNCH_CHECKLIST.md).');
}
if (env.isProd && !raw.SMTP_URL) {
  log.warn('SMTP_URL er ikke sat – e-mails (bekræftelse, nulstilling af adgangskode, prisalarmer) sendes ikke.');
}
