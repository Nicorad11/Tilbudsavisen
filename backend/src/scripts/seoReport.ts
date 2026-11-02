/**
 * SEO-rapport til Claude Code: docs/seo-report.md (står i .gitignore).
 *
 *   npm run seo:report                  # henter først fra Search Console, hvis GSC_* er sat lokalt
 *   npm run seo:report -- --no-sync     # kun data, der allerede er i databasen
 *   npm run seo:report -- --dk          # kun Danmark
 *
 * Databasen er DATABASE_URL (fx en kopi af produktionen) eller den indlejrede PGlite.
 * Med PGlite må API-serveren ikke køre samtidig. Titler og interne links kræver,
 * at frontenden er bygget (npm run build).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bootstrap } from '../bootstrap';
import { env, log } from '../env';
import { configTag, publicConfig } from '../http/site';
import { createSsr, loadSsrModule } from '../http/ssr';
import { indexing, lastRun, overview } from '../services/searchConsole/reports';
import { createSearchConsoleService } from '../services/searchConsole/service';
import { opportunitiesForSite } from '../services/seo/opportunities';
import { renderSeoReport } from '../services/seo/report';
import { sitemaps, sitemapUrls } from '../services/seo/sitemap';
import { snapshotWith, type PageInfo } from '../services/seo/siteSnapshot';

const args = process.argv.slice(2);
const country = args.includes('--dk') ? 'dnk' : 'all';
const { database } = await bootstrap();
const db = database.db;

const gsc = createSearchConsoleService(db, { log: log.child('search-console') });
const setup = gsc.status();
if (!args.includes('--no-sync') && setup.configured) {
  log.info('Henter data fra Search Console …');
  const result = await gsc.sync('report');
  log.info(`Hentning: ${result.status}${result.error ? ` – ${result.error}` : ''}`);
} else if (!setup.configured) {
  log.info(`Search Console er ikke sat op lokalt (${setup.reason}) – bruger data i databasen.`);
}

// Titler og interne links fra de server-renderede sider (kræver npm run build).
let snapshot: Map<string, PageInfo> | null = null;
const template = path.join(env.FRONTEND_DIST, 'index.html');
const module = existsSync(template) ? await loadSsrModule(env.FRONTEND_DIST, publicConfig()) : null;
if (module) {
  const ssr = createSsr({ db, module, template: readFileSync(template, 'utf8'), configTag: configTag() });
  const paths = sitemapUrls(await sitemaps(db)).map((e) => e.path);
  snapshot = await snapshotWith((p) => ssr.render(p), paths, env.APP_URL);
}

const now = new Date();
const markdown = renderSeoReport({
  generatedAt: now,
  setup,
  lastRun: await lastRun(db),
  overview: await overview(db, { setup, running: false, days: 28, country, device: 'all', now }),
  opportunities: await opportunitiesForSite(db, { country, appUrl: env.APP_URL, snapshot, now }),
  indexing: await indexing(db, setup, now),
});

const file = path.resolve(import.meta.dirname, '../../../docs/seo-report.md');
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, markdown);
log.info(`Skrev ${path.relative(process.cwd(), file)}`);
await database.close();
