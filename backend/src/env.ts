import path from 'node:path';
import { createLogger, loadScraperConfig } from '@tilbudsradar/scrapers';
import { z } from 'zod';

const ROOT = path.resolve(import.meta.dirname, '../..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // Ingen .env – standardværdier og eksisterende miljøvariabler bruges.
}

const DEV_SECRET = 'udviklings-hemmelighed-skift-mig-i-produktion-0123456789';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  PGLITE_DIR: z.string().default(path.join(ROOT, 'backend', '.data', 'pglite')),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default(DEV_SECRET),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  ADMIN_EMAILS: z.string().default(''),
  SCRAPE_CRON: z.string().default('15 6,18 * * *'),
  STORES_CRON: z.string().default('30 3 * * 1'),
  SCRAPE_ON_STARTUP: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  ANTHROPIC_EFFORT: z
    .enum(['low', 'medium', 'high', 'xhigh', 'max', ''])
    .default('')
    .transform((v) => (v === '' ? null : v)),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('TilbudsRadar <noreply@tilbudsradar.local>'),
  FRONTEND_DIST: z.string().default(path.join(ROOT, 'frontend', 'dist')),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Ugyldig konfiguration:', z.prettifyError(parsed.error));
  process.exit(1);
}

const raw = parsed.data;

if (raw.NODE_ENV === 'production' && (raw.JWT_SECRET === DEV_SECRET || raw.JWT_SECRET.length < 32)) {
  console.error('JWT_SECRET skal sættes til en tilfældig streng på mindst 32 tegn i produktion.');
  process.exit(1);
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  adminEmails: raw.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  scraper: loadScraperConfig(),
};

export const log = createLogger('api', env.isTest ? 'error' : 'info');
