/**
 * Kør scrapere direkte fra terminalen – uden database – og se resultatet.
 *
 *   npm run scrape                          # alle kilder
 *   npm run scrape -- --source rema1000     # én kilde
 *   npm run scrape -- --chain rema1000      # alle kilder for en kæde
 *   npm run scrape -- --max-pages 1         # hurtig røgtest
 *   npm run scrape -- --stores              # hent butikslokationer i stedet
 *
 * Resultater gemmes som JSON i scrapers/out/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SCRAPERS } from './chains';
import { loadScraperConfig } from './config';
import { createLogger } from './log';
import { createNotifier } from './notify';
import { createHttpClient, runScrapers } from './runner';
import type { ScrapeContext } from './types';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // Ingen .env – standardværdier bruges.
}

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    chain: { type: 'string' },
    'max-pages': { type: 'string' },
    out: { type: 'string', default: path.resolve(import.meta.dirname, '../out') },
    stores: { type: 'boolean', default: false },
    samples: { type: 'string', default: '6' },
  },
});

const config = loadScraperConfig();
const log = createLogger('scrape');
const http = createHttpClient(config, log);
const ctx: ScrapeContext = {
  http,
  log,
  now: new Date(),
  geo: config.defaultGeo,
  maxPages: values['max-pages'] ? Number(values['max-pages']) : undefined,
};

const wanted = (list?: string) => (list ? list.split(',').map((s) => s.trim()) : null);
const sources = wanted(values.source);
const chains = wanted(values.chain);
const selected = SCRAPERS.filter(
  (s) =>
    (!sources || sources.includes(s.id)) &&
    (!chains || chains.includes(s.chain.id)) &&
    !config.disabledChains.includes(s.chain.id),
);

if (!selected.length) {
  log.error(`Ingen scrapere matcher. Tilgængelige: ${SCRAPERS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

await mkdir(values.out!, { recursive: true });
const kr = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(2).replace('.', ','));

if (values.stores) {
  for (const scraper of selected.filter((s) => s.fetchStores)) {
    const stores = [];
    for await (const s of scraper.fetchStores!(ctx)) stores.push(s);
    log.info(`${scraper.chain.name}: ${stores.length} butikker`);
    await writeFile(path.join(values.out!, `${scraper.chain.id}-stores.json`), JSON.stringify(stores, null, 2));
  }
  process.exit(0);
}

log.info(`Kører ${selected.length} scrapere: ${selected.map((s) => s.id).join(', ')}`);
log.info(`User-Agent: ${config.userAgent} · pause ${config.minDelayMs}-${config.maxDelayMs} ms · max ${config.maxRequestsPerMinute}/min pr. vært`);

const results = await runScrapers(selected, ctx, { notifier: createNotifier(config, log) });

console.log('\n' + '─'.repeat(96));
console.log(
  ['Kilde'.padEnd(20), 'Status'.padEnd(8), 'Rå'.padStart(6), 'Gyldige'.padStart(8), 'Afvist'.padStart(7), 'Udløbet'.padStart(8), 'Tid'.padStart(6)].join(' '),
);
console.log('─'.repeat(96));
for (const r of results) {
  console.log(
    [
      r.sourceId.padEnd(20),
      r.status.padEnd(8),
      String(r.rawCount).padStart(6),
      String(r.offers.length).padStart(8),
      String(r.rejected).padStart(7),
      String(r.expired).padStart(8),
      `${Math.round(r.durationMs / 1000)}s`.padStart(6),
    ].join(' '),
  );
  if (r.error) console.log(`  ⚠ ${r.error}`);
  if (r.note) console.log(`  ℹ ${r.note}`);
  for (const s of r.rejectedSamples.slice(0, 3)) console.log(`  afvist ${s.externalId}: ${s.reason}`);
  for (const o of r.offers.slice(0, Number(values.samples))) {
    const label = o.productName.length > 52 ? `${o.productName.slice(0, 51)}…` : o.productName;
    console.log(
      `   · ${label.padEnd(53)} ${kr(o.offerPrice).padStart(8)} kr  ${kr(o.unitPrice).padStart(8)} kr/${o.unit.padEnd(3)} [${o.category}] "${o.normalizedProductName}"`,
    );
  }
  await writeFile(path.join(values.out!, `${r.sourceId}.json`), JSON.stringify(r, null, 2));
}
console.log('─'.repeat(96));
console.log('HTTP-forbrug pr. vært:');
for (const h of http.limiter.usage()) {
  console.log(`   ${h.host.padEnd(28)} ${h.total} requests · ${h.cacheHits} cache-hits · ${h.robotsBlocked} blokeret af robots.txt`);
}
console.log(`JSON gemt i ${values.out}`);
process.exit(results.some((r) => r.status === 'failed') ? 2 : 0);
