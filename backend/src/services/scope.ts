import type { ScrapedOffer } from '@tilbudsradar/shared';
import { PAUSED_CATEGORIES, isPausedCategory } from '@tilbudsradar/shared';
import { CHAINS } from '@tilbudsradar/scrapers';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';

/**
 * Appens nuværende fokus: kun kæderne i scraper-registret og ikke de pausede
 * kategorier (se PAUSED_CATEGORIES / PAUSED_SCRAPERS).
 */
export const ACTIVE_CHAIN_IDS = CHAINS.map((c) => c.id);

const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/** SQL-betingelse: kæden er aktiv i registret (alias `s` for stores). */
export const activeChainSql: SQL = sql`s.id IN (${list(ACTIVE_CHAIN_IDS)})`;

export function isInScope(offer: ScrapedOffer): boolean {
  return ACTIVE_CHAIN_IDS.includes(offer.storeId) && !isPausedCategory(offer.category);
}

/**
 * Fjerner tilbud fra pausede kæder og kategorier. De rå data bevares, så de
 * kan genskabes med `npm run reprocess`, når de slås til igen.
 */
export async function purgeOutOfScope(db: Db): Promise<number> {
  const conditions: SQL[] = [sql`store_id NOT IN (${list(ACTIVE_CHAIN_IDS)})`];
  if (PAUSED_CATEGORIES.length) conditions.push(sql`category IN (${list(PAUSED_CATEGORIES)})`);
  const result = (await db.execute(
    sql`DELETE FROM offers WHERE ${sql.join(conditions, sql` OR `)} RETURNING id`,
  )) as unknown as { rows?: unknown[] };
  return result.rows?.length ?? 0;
}
