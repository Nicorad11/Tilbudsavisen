import type { ScrapedOffer } from '@tilbudsradar/shared';
import { MATCH_THRESHOLD, coreName, matchScore } from '@tilbudsradar/scrapers';
import { sql } from 'drizzle-orm';
import { query, queryOne, type Db } from '../db/client';

/**
 * Normalizer-service: finder (eller opretter) den kanoniske vare for et
 * scraped tilbud, så priser kan sammenlignes på tværs af kæder.
 *
 *   1. manuel/lært mapping i product_aliases
 *   2. eksakt match på kernenavn + enhed
 *   3. fuzzy match: pg_trgm finder kandidater, JS-scoren afgør
 *   4. ellers oprettes en ny kanonisk vare
 */
export class ProductMatcher {
  private readonly cache = new Map<string, number>();

  async resolve(db: Db, offer: ScrapedOffer): Promise<number> {
    const core = (coreName(offer.productName) || offer.normalizedProductName).slice(0, 200);
    const key = `${core}|${offer.unit}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const id = await this.lookup(db, core, offer);
    this.cache.set(key, id);
    return id;
  }

  private async lookup(db: Db, core: string, offer: ScrapedOffer): Promise<number> {
    const alias = await queryOne<{ product_id: number }>(
      db,
      sql`SELECT product_id FROM product_aliases WHERE alias = ${core} AND unit = ${offer.unit}`,
    );
    if (alias) return alias.product_id;

    const exact = await queryOne<{ id: number }>(
      db,
      sql`SELECT id FROM products WHERE normalized_name = ${core} AND unit = ${offer.unit}`,
    );
    if (exact) return exact.id;

    const candidates = await query<{ id: number; normalized_name: string; category: string }>(
      db,
      sql`SELECT id, normalized_name, category
          FROM products
          WHERE unit = ${offer.unit} AND normalized_name % ${core}
          ORDER BY similarity(normalized_name, ${core}) DESC
          LIMIT 8`,
    );
    let best: { id: number; score: number } | null = null;
    for (const c of candidates) {
      const sameCategory = c.category === offer.category || c.category === 'andet' || offer.category === 'andet';
      if (!sameCategory) continue;
      const score = matchScore(core, c.normalized_name);
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { id: c.id, score };
    }
    if (best) {
      await db.execute(
        sql`INSERT INTO product_aliases (alias, unit, product_id, source, score)
            VALUES (${core}, ${offer.unit}, ${best.id}, 'auto', ${best.score})
            ON CONFLICT (alias, unit) DO NOTHING`,
      );
      return best.id;
    }

    const created = await queryOne<{ id: number }>(
      db,
      sql`INSERT INTO products (name, normalized_name, category, unit, brand)
          VALUES (${offer.productName.slice(0, 300)}, ${core}, ${offer.category}, ${offer.unit}, ${offer.brand ?? null})
          ON CONFLICT (normalized_name, unit) DO UPDATE SET normalized_name = EXCLUDED.normalized_name
          RETURNING id`,
    );
    return created!.id;
  }
}

/** Manuel mapping (fx fra admin): "dette navn er samme vare som produkt X". */
export async function addManualAlias(db: Db, alias: string, unit: string, productId: number): Promise<void> {
  const core = coreName(alias) || alias.toLowerCase();
  await db.execute(
    sql`INSERT INTO product_aliases (alias, unit, product_id, source, score)
        VALUES (${core}, ${unit}, ${productId}, 'manual', 1)
        ON CONFLICT (alias, unit) DO UPDATE SET product_id = EXCLUDED.product_id, source = 'manual', score = 1`,
  );
}
