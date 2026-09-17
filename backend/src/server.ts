import cron from 'node-cron';
import { bootstrap } from './bootstrap';
import { env, log } from './env';
import { createApp } from './http/app';
import { cleanupAuth } from './services/auth';

const { database, scrape } = await bootstrap();
const app = createApp({ db: database.db, scrape });

const server = app.listen(env.PORT, () => {
  log.info(`API kører på http://localhost:${env.PORT}`);
});

scrape.schedule();
cron.schedule('0 4 * * *', () => void cleanupAuth(database.db).catch((err) => log.warn('Oprydning fejlede', { err: String(err) })), {
  timezone: 'Europe/Copenhagen',
  name: 'cleanup',
});

// Første opstart: hent data med det samme, så UI'et ikke er tomt.
if (env.SCRAPE_ON_STARTUP && !env.isTest) {
  void (async () => {
    if (!(await scrape.hasData())) {
      log.info('Ingen aktive tilbud i databasen – starter scraping (tager et par minutter pga. høflige pauser)…');
      await scrape.start('startup');
    }
    if (!(await scrape.hasLocations())) {
      log.info('Henter butikslokationer til geolokation i baggrunden…');
      await scrape.syncStoreLocations();
    }
  })().catch((err) => log.error('Opstarts-scraping fejlede', { err: String(err) }));
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} modtaget – lukker ned`);
  scrape.stop();
  server.close();
  await database.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
