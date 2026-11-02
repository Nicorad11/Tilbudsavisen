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
import { sql } from 'drizzle-orm';
import { bootstrap } from '../bootstrap';
import { query } from '../db/client';
import { conceptKey, extractConcepts } from '../services/concepts';
import { OFFER_SELECT, type OfferRow } from '../services/offers';
import { activeChainSql } from '../services/scope';
import { matchTerm, WINDOW_DAYS } from '../services/seo/termIndex';

const limit = Number(process.argv[2] ?? 40);
const { database } = await bootstrap();
const rows = await query<OfferRow>(
  database.db,
  sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
      WHERE ${activeChainSql} AND o.valid_to > now() - make_interval(days => ${WINDOW_DAYS})`,
);

// Tilbud, der allerede hører til en vare på listen, tæller ikke med.
const covered = new Set<number>();
for (const term of SEO_TERMS) for (const r of matchTerm(term, rows)) covered.add(r.id);

const groups = new Map<string, { label: string; offers: number; stores: Set<string>; categories: Map<string, number> }>();
for (const r of rows) {
  if (covered.has(r.id) || r.category === 'andet') continue;
  for (const concept of extractConcepts(r.title)) {
    const key = conceptKey(concept);
    const g = groups.get(key) ?? { label: concept, offers: 0, stores: new Set<string>(), categories: new Map<string, number>() };
    g.offers++;
    g.stores.add(r.store_name);
    g.categories.set(r.category, (g.categories.get(r.category) ?? 0) + 1);
    groups.set(key, g);
  }
}

const candidates = [...groups.values()]
  .filter((g) => g.offers >= 4 && g.stores.size >= 2)
  .sort((a, b) => b.offers - a.offers || b.stores.size - a.stores.size)
  .slice(0, limit);

console.log(`${rows.length} tilbud de sidste ${WINDOW_DAYS} dage, ${covered.size} dækket af ${SEO_TERMS.length} varer på listen.\n`);
console.log('Tilbud  Kæder  Kategori              Varetype');
for (const c of candidates) {
  const category = [...c.categories.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  console.log(`${String(c.offers).padStart(6)}  ${String(c.stores.size).padStart(5)}  ${categoryLabel(category).padEnd(20)}  ${c.label}`);
}
await database.close();
