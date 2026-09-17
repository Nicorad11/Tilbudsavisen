/**
 * DEMO-DATA: opbygger 180 dages syntetisk prishistorik for varer med aktive
 * tilbud, så prisgrafer og "reelt tilbud"-vurderingen kan afprøves med det
 * samme. Alle rækker markeres `synthetic = true`, vises som demo-data i UI'et
 * og overskrives aldrig oven i rigtige observationer.
 *
 *   npm run db:seed-demo            # opret
 *   npm run db:seed-demo -- --clear # fjern igen
 */
import { parseArgs } from 'node:util';
import { FOOD_CATEGORIES } from '@tilbudsradar/shared';
import { sql, type SQL } from 'drizzle-orm';
import { bootstrap } from '../bootstrap';
import { query } from '../db/client';
import { log } from '../env';
import { bumpDataVersion } from '../services/offers';

const { values } = parseArgs({ options: { clear: { type: 'boolean', default: false } } });
const { database } = await bootstrap();
const db = database.db;

if (values.clear) {
  const removed = await query<{ id: number }>(db, sql`DELETE FROM price_history WHERE synthetic RETURNING id`);
  log.info(`${removed.length} syntetiske prispunkter fjernet`);
  await database.close();
  process.exit(0);
}

const offers = await query<{ product_id: number; store_id: string; unit_price: number; offer_price: number }>(
  db,
  sql`SELECT DISTINCT ON (o.product_id, o.store_id) o.product_id, o.store_id, o.unit_price, o.offer_price
      FROM offers o
      WHERE o.product_id IS NOT NULL AND o.unit_price IS NOT NULL AND o.valid_to > now()
        AND o.category IN (${sql.join(FOOD_CATEGORIES.map((c) => sql`${c}`), sql`, `)})
      ORDER BY o.product_id, o.store_id, o.unit_price`,
);

/** Deterministisk pseudo-tilfældighed pr. vare, så kørslen kan gentages. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const DAYS = 180;
const STEP = 3;
const today = new Date();
let rows: SQL[] = [];
let inserted = 0;

async function flush() {
  if (!rows.length) return;
  const res = await query<{ id: number }>(
    db,
    sql`INSERT INTO price_history (product_id, store_id, observed_on, price, unit_price, is_offer, source_id, synthetic)
        VALUES ${sql.join(rows, sql`, `)}
        ON CONFLICT (product_id, store_id, observed_on, is_offer) DO NOTHING
        RETURNING id`,
  );
  inserted += res.length;
  rows = [];
}

for (const o of offers) {
  const rand = rng(o.product_id * 31 + o.store_id.length * 7);
  const scenario = rand();
  // 70 %: reel besparelse · 20 %: lille besparelse · 10 %: "tilbud" på normalpris
  const markup = scenario < 0.7 ? 1.18 + rand() * 0.3 : scenario < 0.9 ? 1.03 + rand() * 0.05 : 0.95 + rand() * 0.04;
  const qty = o.offer_price / o.unit_price;
  let regular = o.unit_price * markup;
  const dipEvery = 28 + Math.floor(rand() * 21);
  const dipOffset = Math.floor(rand() * dipEvery);

  for (let d = DAYS; d >= 2; d -= STEP) {
    regular *= 1 + (rand() - 0.5) * 0.015;
    const inDip = (d + dipOffset) % dipEvery < 7;
    const unit = inDip ? regular * (0.78 + rand() * 0.08) : regular;
    const day = new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    const round = (n: number) => Math.round(n * 100) / 100;
    rows.push(
      sql`(${o.product_id}, ${o.store_id}, ${day}::date, ${round(unit * qty)}, ${round(unit)}, ${inDip}, 'demo', true)`,
    );
    if (rows.length >= 1000) await flush();
  }
}
await flush();
bumpDataVersion();
log.info(`Demo-historik: ${inserted} syntetiske prispunkter for ${offers.length} vare/kæde-par`);
await database.close();
