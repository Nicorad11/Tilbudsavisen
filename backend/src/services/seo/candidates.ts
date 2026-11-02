import { SEO_TERMS } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../../db/client';
import { conceptKey, extractConcepts } from '../concepts';
import { OFFER_SELECT, type OfferRow } from '../offers';
import { activeChainSql } from '../scope';
import { matchTerm, WINDOW_DAYS } from './termIndex';

/**
 * Varetyper i vores tilbud, som ingen vare på listen (shared/src/seoTerms.ts)
 * dækker endnu. Bruges af `npm run seo:candidates` og af "Manglende sider"
 * i Search Console-analysen.
 */

export interface UncoveredConcept {
  key: string;
  /** Varetypen som den står i tilbuddene, fx "rødkål". */
  label: string;
  offers: number;
  stores: number;
  /** Kategorien med flest af tilbuddene. */
  category: string;
}

export function uncoveredConcepts(rows: OfferRow[]): UncoveredConcept[] {
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
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      offers: g.offers,
      stores: g.stores.size,
      category: [...g.categories.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    }))
    .sort((a, b) => b.offers - a.offers || b.stores - a.stores);
}

/** Tilbud fra de sidste 90 dage (og næste uges aviser). */
export function candidateOffers(db: Db): Promise<OfferRow[]> {
  return query<OfferRow>(
    db,
    sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
        WHERE ${activeChainSql} AND o.valid_to > now() - make_interval(days => ${WINDOW_DAYS})`,
  );
}
