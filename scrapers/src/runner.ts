import type { RawRecord, ScrapedOffer } from '@tilbudsradar/shared';
import type { ScraperConfig } from './config';
import { StructureChangedError, errorMessage } from './errors';
import { HttpClient } from './http/client';
import { HostRateLimiter } from './http/rateLimiter';
import type { Logger } from './log';
import type { Notifier } from './notify';
import type { ScrapeContext, Scraper } from './types';
import { validateOffer } from './validate';

export type ScraperStatus = 'success' | 'partial' | 'failed';

export interface ScraperRunResult {
  sourceId: string;
  chainId: string;
  status: ScraperStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  rawCount: number;
  offers: ScrapedOffer[];
  rejected: number;
  expired: number;
  rejectedSamples: { externalId: string; reason: string }[];
  error: string | null;
  errorKind: string | null;
  /** Informativ besked der ikke er en fejl (fx "ingen aktive aviser"). */
  note: string | null;
}

export interface RunHooks {
  /** Kaldes løbende med rå records, så de kan gemmes før parsing. */
  onRawBatch?(records: RawRecord[]): Promise<void>;
  onProgress?(sourceId: string, rawCount: number): void;
}

/** Andel af records der må afvises, før vi antager at kilden har ændret format. */
const MAX_REJECT_RATIO = 0.5;

/**
 * Kører én scraper isoleret. Kaster ALDRIG – alle fejl returneres som en
 * status, så ét ødelagt website ikke stopper de øvrige kæder.
 */
export async function runScraper(scraper: Scraper, ctx: ScrapeContext, hooks: RunHooks = {}): Promise<ScraperRunResult> {
  const log = ctx.log.child(scraper.id);
  const startedAt = new Date();
  const offers: ScrapedOffer[] = [];
  const rejectedSamples: ScraperRunResult['rejectedSamples'] = [];
  let rawCount = 0;
  let rejected = 0;
  let expired = 0;
  let batch: RawRecord[] = [];
  let error: string | null = null;
  let errorKind: string | null = null;
  let note: string | null = null;

  const reject = (externalId: string, reason: string) => {
    rejected++;
    if (rejectedSamples.length < 8) rejectedSamples.push({ externalId, reason });
  };
  const flush = async () => {
    if (!batch.length || !hooks.onRawBatch) return;
    const toSave = batch;
    batch = [];
    await hooks.onRawBatch(toSave);
  };

  try {
    for await (const record of scraper.fetch({ ...ctx, log })) {
      rawCount++;
      batch.push(record);
      if (batch.length >= 200) await flush();
      if (rawCount % 100 === 0) hooks.onProgress?.(scraper.id, rawCount);

      let parsed: ScrapedOffer[] = [];
      try {
        parsed = scraper.parse(record, { now: ctx.now });
      } catch (err) {
        reject(record.externalId, `parse-fejl: ${errorMessage(err)}`);
        continue;
      }
      if (!parsed.length) {
        reject(record.externalId, 'kunne ikke læses (manglende pris/navn eller ukendt format)');
        continue;
      }
      for (const offer of parsed) {
        const v = validateOffer(offer);
        if (!v.ok) {
          reject(offer.externalId, v.reason);
          continue;
        }
        if (!offer.isBaseline && offer.validTo.getTime() < ctx.now.getTime()) {
          expired++;
          continue;
        }
        offers.push(offer);
      }
    }
    await flush();

    if (rawCount === 0 && scraper.emptyIsOk) {
      note = 'Ingen aktive eller kommende aviser lige nu';
    } else if (rawCount === 0) {
      throw new StructureChangedError(
        scraper.id,
        'Kilden returnerede ingen data – enten er der ingen aktive aviser, eller kilden har ændret struktur',
      );
    }
    if (rawCount >= 10 && rejected / rawCount > MAX_REJECT_RATIO) {
      throw new StructureChangedError(
        scraper.id,
        `${rejected} af ${rawCount} records kunne ikke læses – har kilden ændret format? Eksempel: ${rejectedSamples[0]?.reason ?? '-'}`,
      );
    }
  } catch (err) {
    error = errorMessage(err);
    errorKind = err instanceof Error ? err.name : 'Error';
    try {
      await flush();
    } catch (flushErr) {
      log.warn('Kunne ikke gemme rå data efter fejl', { err: errorMessage(flushErr) });
    }
  }

  const finishedAt = new Date();
  const status: ScraperStatus = error ? (offers.length ? 'partial' : 'failed') : 'success';
  const result: ScraperRunResult = {
    sourceId: scraper.id,
    chainId: scraper.chain.id,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    rawCount,
    offers,
    rejected,
    expired,
    rejectedSamples,
    error,
    errorKind,
    note,
  };
  const summary = `${status}: ${rawCount} rå, ${offers.length} gyldige, ${rejected} afvist, ${expired} udløbet (${Math.round(result.durationMs / 1000)}s)`;
  if (status === 'success') log.info(note ? `${summary} – ${note}` : summary);
  else log.warn(`${summary} – ${error}`);
  return result;
}

export async function alertOnFailure(result: ScraperRunResult, notifier: Notifier): Promise<void> {
  if (result.status === 'success') return;
  await notifier.notify({
    level: result.status === 'failed' ? 'error' : 'warn',
    sourceId: result.sourceId,
    title: result.errorKind === 'StructureChangedError' ? 'Mulig strukturændring' : 'Scraping fejlede',
    message: result.error ?? 'Ukendt fejl',
  });
}

/**
 * Kører flere scrapere samtidig. Det er sikkert, fordi alle deler samme
 * HttpClient og dermed samme rate-limiter pr. vært.
 */
export async function runScrapers(
  scrapers: Scraper[],
  ctx: ScrapeContext,
  opts: { notifier?: Notifier; hooks?: (scraper: Scraper) => RunHooks; onResult?(r: ScraperRunResult): Promise<void> } = {},
): Promise<ScraperRunResult[]> {
  return Promise.all(
    scrapers.map(async (scraper) => {
      const result = await runScraper(scraper, ctx, opts.hooks?.(scraper));
      if (opts.notifier) await alertOnFailure(result, opts.notifier);
      await opts.onResult?.(result);
      return result;
    }),
  );
}

/** Én fælles HTTP-klient + limiter pr. proces. */
export function createHttpClient(config: ScraperConfig, log: Logger): HttpClient {
  const limiter = new HostRateLimiter({
    minDelayMs: config.minDelayMs,
    maxDelayMs: config.maxDelayMs,
    maxPerMinute: config.maxRequestsPerMinute,
  });
  return new HttpClient({
    userAgent: config.userAgent,
    limiter,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    logger: log.child('http'),
  });
}
