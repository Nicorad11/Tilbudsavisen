/**
 * Re-processerer ALLE gemte rå data med den nuværende parser- og
 * normaliseringslogik. Bruges når normaliseringen er forbedret.
 *   npm run reprocess
 */
import type { RawRecord, ScrapedOffer } from '@tilbudsradar/shared';
import { parserFor, validateOffer } from '@tilbudsradar/scrapers';
import { sql } from 'drizzle-orm';
import { bootstrap } from '../bootstrap';
import { query } from '../db/client';
import { log } from '../env';
import { ingestOffers } from '../services/ingest';

const { database } = await bootstrap();
const db = database.db;

let lastId = 0;
let raws = 0;
let parsed = 0;
let skipped = 0;
for (;;) {
  const rows = await query<{
    id: number;
    source_id: string;
    external_id: string;
    kind: string;
    payload: unknown;
    context: Record<string, unknown> | null;
    last_seen_at: Date;
  }>(
    db,
    sql`SELECT id, source_id, external_id, kind, payload, context, last_seen_at
        FROM raw_offers WHERE id > ${lastId} ORDER BY id LIMIT 500`,
  );
  if (!rows.length) break;
  lastId = rows.at(-1)!.id;

  const byDay = new Map<string, { offers: ScrapedOffer[]; rawIds: Map<string, number> }>();
  for (const row of rows) {
    raws++;
    const scraper = parserFor(row.source_id, row.kind);
    if (!scraper) {
      skipped++;
      continue;
    }
    const seen = new Date(row.last_seen_at);
    const record: RawRecord = {
      sourceId: row.source_id,
      externalId: row.external_id,
      kind: row.kind,
      payload: row.payload,
      context: row.context ?? undefined,
    };
    const day = seen.toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { offers: [] as ScrapedOffer[], rawIds: new Map<string, number>() };
    for (const offer of scraper.parse(record, { now: seen })) {
      if (!validateOffer(offer).ok) continue;
      bucket.offers.push(offer);
      bucket.rawIds.set(`${offer.sourceId}|${offer.externalId}`, row.id);
      parsed++;
    }
    byDay.set(day, bucket);
  }
  for (const [day, bucket] of byDay) await ingestOffers(db, bucket.offers, bucket.rawIds, day);
  log.info(`… ${raws} rå records behandlet`);
}

log.info(`Re-processering færdig: ${raws} rå records → ${parsed} tilbud/priser (${skipped} uden kendt parser)`);
await database.close();
