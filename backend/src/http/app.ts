import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Db } from '../db/client';
import { env } from '../env';
import { sentryEnabled } from '../instrument';
import type { StripeClient } from '../services/billing';
import type { ScrapeManager } from '../services/scrapeJobs';
import { optionalAuth } from './auth';
import { canonicalHost } from './canonical';
import { logProxyChainOnce, trustProxy } from './clientIp';
import { errorHandler, HttpError, notFoundHandler } from './errors';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { analyticsRoutes } from './routes/analytics';
import { billingRoutes, stripeWebhook } from './routes/billing';
import { offerRoutes } from './routes/offers';
import { receiptRoutes } from './routes/receipts';
import { seoRoutes } from './routes/seo';
import { userRoutes } from './routes/user';
import { limiter } from './rateLimit';
import { mountSite } from './site';

export interface AppContext {
  db: Db;
  scrape: ScrapeManager;
  /** null når STRIPE_SECRET_KEY ikke er sat – betalingsendpoints svarer så 503. */
  stripe: StripeClient | null;
}

const originOf = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** CSP'en åbner kun for Sentry og Plausible, hvis de er slået til. Stripe Checkout er et redirect og kræver intet. */
function contentSecurityPolicy() {
  const sentry = originOf(env.VITE_SENTRY_DSN);
  const plausible = env.VITE_PLAUSIBLE_DOMAIN ? originOf(env.VITE_PLAUSIBLE_SRC) : null;
  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...(plausible ? [plausible] : [])],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...(sentry ? [sentry] : []), ...(plausible ? [plausible] : [])],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
    },
  };
}

/**
 * Query-parametre skal være almindelig tekst. Gentagne nøgler (?q=a&q=b giver en liste)
 * og nøgler med klammer (?q[$ne]=x) afvises, før en route eller et Zod-schema ser dem.
 */
const plainQuery: RequestHandler = (req, _res, next) => {
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value !== 'string' || /[[\]]/.test(key)) return next(new HttpError(400, 'Ugyldige parametre'));
  }
  next();
};

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  // Kun Renders interne proxyer og Cloudflare er betroede (se clientIp.ts). Et fast antal hop
  // ("trust proxy: 1") gav Cloudflares skiftende IP'er som klient-IP, så brugerne delte kvoter.
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  // "simple" (Node's querystring) laver aldrig indlejrede objekter af ?a[b]=c – se også plainQuery.
  app.set('query parser', 'simple');
  // Ét domæne: tilbudsradar.onrender.com og www sendes videre til APP_URL (kun i produktion).
  if (env.isProd) app.use(canonicalHost(env.APP_URL));
  app.use(
    helmet({
      contentSecurityPolicy: contentSecurityPolicy(),
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: env.isProd ? { maxAge: 63_072_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(cors({ origin: env.corsOrigins, credentials: true }));

  // Stripe-webhooken skal have den rå body for at kunne verificere signaturen – derfor før express.json.
  app.post('/api/billing/webhook', ...stripeWebhook(ctx));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', logProxyChainOnce);
  // API-svar er data til appen, ikke sider – de skal aldrig i søgeresultaterne.
  app.use('/api', (_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex');
    next();
  });
  app.use('/api', limiter({ windowMs: 60_000, limit: env.isTest ? 10_000 : 300 }));
  app.use('/api', plainQuery);
  app.use('/api', optionalAuth);

  // Offentlig og uden driftsdetaljer – om scraping kører, står i /api/admin/status.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/billing', billingRoutes(ctx));
  app.use('/api/analytics', analyticsRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api/seo', seoRoutes(ctx));
  app.use('/api', offerRoutes(ctx));
  app.use('/api', userRoutes(ctx));
  app.use('/api', receiptRoutes(ctx));
  app.use('/api', notFoundHandler);

  mountSite(app, undefined, { db: ctx.db });

  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);
  return app;
}
