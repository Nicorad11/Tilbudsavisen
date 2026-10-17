import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../env';
import { recordPageView } from '../../services/analytics';
import type { AppContext } from '../app';
import { parse } from '../errors';

const pageViewSchema = z.object({
  path: z.string().min(1).max(500),
  referrer: z.string().max(1000).nullish(),
  utmSource: z.string().max(200).nullish(),
  utmMedium: z.string().max(200).nullish(),
  utmCampaign: z.string().max(200).nullish(),
  member: z.boolean().optional(),
});

/** Cookiefri besøgsstatistik (se services/analytics.ts). */
export function analyticsRoutes({ db }: AppContext): Router {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 10_000 : 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  r.post('/pageview', limiter, async (req, res) => {
    const body = parse(pageViewSchema, req.body);
    await recordPageView(db, body, { ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' });
    res.status(204).end();
  });

  return r;
}
