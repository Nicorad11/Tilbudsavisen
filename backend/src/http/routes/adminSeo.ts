import type { GscInspectionRow } from '@tilbudsradar/shared';
import { Router } from 'express';
import { z } from 'zod';
import { env, log } from '../../env';
import { GscApiError } from '../../services/searchConsole/client';
import { indexing, lastRun, overview, sitemapsReport, toInspectionRow } from '../../services/searchConsole/reports';
import { GscUnavailableError, searchConsoleService } from '../../services/searchConsole/service';
import { opportunitiesForSite } from '../../services/seo/opportunities';
import type { AppContext } from '../app';
import { HttpError, parse } from '../errors';

const country = z.enum(['all', 'dnk']).default('all');
const overviewQuery = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(28), z.literal(90)])).default(28),
  country,
  device: z.enum(['all', 'DESKTOP', 'MOBILE', 'TABLET']).default('all'),
});

/**
 * Search Console i admin-appen. Monteres under /api/admin/seo og arver dermed
 * adminGuard og revisionsloggen fra admin.ts. Uden opsætning svarer GET-ruterne
 * pænt med `setup.configured: false` (og evt. gemte data), og handlingerne 409.
 */
export function adminSeoRoutes({ db, searchConsole }: AppContext): Router {
  const r = Router();
  const gsc = () => searchConsole ?? searchConsoleService(db, { log: log.child('search-console') });

  r.get('/status', async (_req, res) => {
    res.json({ setup: gsc().status(), running: gsc().running(), lastRun: await lastRun(db) });
  });

  r.get('/overview', async (req, res) => {
    const q = parse(overviewQuery, req.query);
    res.json(await overview(db, { setup: gsc().status(), running: gsc().running(), ...q }));
  });

  r.get('/opportunities', async (req, res) => {
    const q = parse(z.object({ country }), req.query);
    res.json(await opportunitiesForSite(db, { country: q.country, appUrl: env.APP_URL }));
  });

  r.get('/indexing', async (_req, res) => {
    res.json(await indexing(db, gsc().status()));
  });

  r.get('/sitemaps', async (_req, res) => {
    res.json(await sitemapsReport(db, gsc().status()));
  });

  /** "Hent data nu" – kører i baggrunden; status ses på /status. */
  r.post('/sync', (_req, res) => {
    const svc = gsc();
    const setup = svc.status();
    if (!setup.configured) throw new HttpError(409, `Search Console er ikke sat op: ${setup.reason}`);
    if (svc.running()) throw new HttpError(409, 'Data hentes allerede – vent et øjeblik.');
    void svc.sync('manual');
    res.status(202).json({ started: true });
  });

  /** "Inspicér URL" – kun vores egne sider. */
  r.post('/inspect', async (req, res) => {
    const { url: raw } = parse(z.object({ url: z.string().trim().min(1).max(500) }), req.body);
    const url = raw.startsWith('/') ? `${env.APP_URL}${raw}` : raw;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(400, 'Ugyldig adresse');
    }
    if (parsed.origin !== new URL(env.APP_URL).origin) throw new HttpError(400, `Kun sider på ${env.APP_URL} kan inspiceres`);
    try {
      const row = await gsc().inspect(parsed.href);
      res.json(toInspectionRow(row) satisfies GscInspectionRow);
    } catch (err) {
      if (err instanceof GscUnavailableError) throw new HttpError(err.status, err.message);
      // Beskeden er renset for nøgler (client.ts) – fx "Search Console svarede 403: …".
      if (err instanceof GscApiError) throw new HttpError(502, err.message);
      throw err;
    }
  });

  return r;
}
