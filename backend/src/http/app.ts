import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Db } from '../db/client';
import { env } from '../env';
import type { ScrapeManager } from '../services/scrapeJobs';
import { optionalAuth } from './auth';
import { errorHandler, notFoundHandler } from './errors';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { offerRoutes } from './routes/offers';
import { userRoutes } from './routes/user';

export interface AppContext {
  db: Db;
  scrape: ScrapeManager;
}

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: env.isTest ? 10_000 : 300, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', optionalAuth);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), scraping: ctx.scrape.isRunning() });
  });
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api', offerRoutes(ctx));
  app.use('/api', userRoutes(ctx));
  app.use('/api', notFoundHandler);

  // I produktion kan backend også servere den byggede frontend (én service på Render).
  if (existsSync(path.join(env.FRONTEND_DIST, 'index.html'))) {
    app.use(express.static(env.FRONTEND_DIST, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(env.FRONTEND_DIST, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
