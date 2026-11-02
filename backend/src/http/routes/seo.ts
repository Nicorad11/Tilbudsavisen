import { Router } from 'express';
import { z } from 'zod';
import {
  getCategoryPage,
  getHomeLinks,
  getInsights,
  getMethodPage,
  getStorePage,
  getStoresHub,
  getTermHub,
  getTermPage,
  getWeeklyBest,
} from '../../services/seo/pages';
import type { AppContext } from '../app';
import { notFound, parse } from '../errors';

const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });

/**
 * Datasiderne som JSON – til navigation i browseren. Første visning er
 * server-renderet med de samme data (backend/src/http/ssr.ts).
 */
export function seoRoutes({ db }: AppContext): Router {
  const r = Router();

  r.get('/forside', async (_req, res) => {
    res.json(await getHomeLinks(db));
  });
  r.get('/tilbud', async (_req, res) => {
    res.json(await getTermHub(db));
  });
  r.get('/tilbud/:slug', async (req, res) => {
    const page = await getTermPage(db, parse(slugParam, req.params).slug);
    if (!page) throw notFound('Varen');
    res.json(page);
  });
  r.get('/butikker', async (_req, res) => {
    res.json(await getStoresHub(db));
  });
  r.get('/butik/:slug', async (req, res) => {
    const page = await getStorePage(db, parse(slugParam, req.params).slug);
    if (!page) throw notFound('Butikken');
    res.json(page);
  });
  r.get('/kategori/:slug', async (req, res) => {
    const page = await getCategoryPage(db, parse(slugParam, req.params).slug);
    if (!page) throw notFound('Kategorien');
    res.json(page);
  });
  r.get('/ugens-bedste-tilbud', async (_req, res) => {
    res.json(await getWeeklyBest(db));
  });
  r.get('/indsigt', async (_req, res) => {
    res.json(await getInsights(db));
  });
  r.get('/metode', async (_req, res) => {
    res.json(await getMethodPage(db));
  });

  return r;
}
