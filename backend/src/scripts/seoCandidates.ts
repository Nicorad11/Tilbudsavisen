/**
 * Kandidater til varelisten på /tilbud/{vare} (shared/src/seoTerms.ts):
 * varetyper med mange tilbud de sidste 90 dage, som ingen vare på listen dækker.
 *
 *   npm run seo:candidates -w backend            # top 40
 *   npm run seo:candidates -w backend -- 100     # top 100
 *
 * Bemærk: med den indlejrede database (PGlite) må API-serveren ikke køre samtidig.
 */
import { categoryLabel, SEO_TERMS } from '@tilbudsradar/shared';
import { bootstrap } from '../bootstrap';
import { candidateOffers, uncoveredConcepts } from '../services/seo/candidates';
import { WINDOW_DAYS } from '../services/seo/termIndex';

const limit = Number(process.argv[2] ?? 40);
const { database } = await bootstrap();
const rows = await candidateOffers(database.db);
const all = uncoveredConcepts(rows);
const candidates = all.filter((c) => c.offers >= 4 && c.stores >= 2).slice(0, limit);

console.log(`${rows.length} tilbud de sidste ${WINDOW_DAYS} dage, ${SEO_TERMS.length} varer på listen, ${all.length} varetyper uden side.\n`);
console.log('Tilbud  Kæder  Kategori              Varetype');
for (const c of candidates) {
  console.log(`${String(c.offers).padStart(6)}  ${String(c.stores).padStart(5)}  ${categoryLabel(c.category).padEnd(20)}  ${c.label}`);
}
await database.close();
