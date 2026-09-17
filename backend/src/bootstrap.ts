import { createDatabase, type Database } from './db/client';
import { env, log } from './env';
import { ScrapeManager } from './services/scrapeJobs';

/** Fælles opstart for server og scripts: database, migrationer og kilderegister. */
export async function bootstrap(opts: { dataDir?: string } = {}): Promise<{ database: Database; scrape: ScrapeManager }> {
  const database = await createDatabase({ url: env.DATABASE_URL, dataDir: opts.dataDir ?? env.PGLITE_DIR });
  log.info(database.kind === 'pglite' ? `Database: indlejret Postgres (PGlite) i ${opts.dataDir ?? env.PGLITE_DIR}` : 'Database: PostgreSQL');
  await database.migrate();
  const scrape = new ScrapeManager(database.db, log);
  await scrape.syncRegistry();
  return { database, scrape };
}
