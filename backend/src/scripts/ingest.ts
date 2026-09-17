/**
 * Kør scraping og gem i databasen uden at starte API'et.
 *   npm run ingest                       # alle aktive kilder
 *   npm run ingest -- --source rema1000  # udvalgte kilder
 *   npm run ingest -- --stores           # hent også butikslokationer
 *
 * Bemærk: med den indlejrede database (PGlite) må API-serveren ikke køre samtidig.
 */
import { parseArgs } from 'node:util';
import { bootstrap } from '../bootstrap';
import { log } from '../env';

const { values } = parseArgs({
  options: { source: { type: 'string' }, stores: { type: 'boolean', default: false } },
});

const { database, scrape } = await bootstrap();
const ids = values.source?.split(',').map((s) => s.trim());
const results = await scrape.runAndWait('manual', ids);
for (const r of results) {
  if (r) log.info(`${r.sourceId}: ${r.status} – ${r.offers.length} gyldige, ${r.rejected} afvist${r.error ? ` (${r.error})` : ''}`);
}
if (values.stores) {
  const n = await scrape.syncStoreLocations();
  log.info(`${n} butikslokationer synkroniseret`);
}
await database.close();
process.exit(results.some((r) => !r || r.status === 'failed') ? 2 : 0);
