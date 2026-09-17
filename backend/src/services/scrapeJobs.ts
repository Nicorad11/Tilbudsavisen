import type { RunStatus, ScrapeRunDTO, ScrapeStatusDTO, SourceStatusDTO } from '@tilbudsradar/shared';
import {
  CHAINS,
  SCRAPERS,
  alertOnFailure,
  createHttpClient,
  createNotifier,
  errorMessage,
  runScraper,
  type HttpClient,
  type Logger,
  type Notifier,
  type ScrapeContext,
  type Scraper,
  type ScraperRunResult,
} from '@tilbudsradar/scrapers';
import { eq, sql } from 'drizzle-orm';
import cron, { type ScheduledTask } from 'node-cron';
import { query, queryOne, type Db } from '../db/client';
import { scrapeRuns, scrapeSources, stores } from '../db/schema';
import { env } from '../env';
import { ingestOffers, saveRawBatch, upsertStoreLocations } from './ingest';
import { purgeOutOfScope } from './scope';
import { checkWatchlists } from './watch';

type Trigger = 'cron' | 'manual' | 'startup';

/**
 * Orkestrerer scraping: feature-flags, kørselslog, rå-data-lagring,
 * normalisering/ingest, fejlnotifikationer og planlægning.
 */
export class ScrapeManager {
  readonly http: HttpClient;
  private readonly notifier: Notifier;
  private readonly active = new Set<string>();
  private readonly tasks: ScheduledTask[] = [];
  private storesSyncRunning = false;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly scrapers: Scraper[] = SCRAPERS,
  ) {
    this.http = createHttpClient(env.scraper, log.child('scrape'));
    this.notifier = createNotifier(env.scraper, log.child('alert'));
  }

  /** Sørger for at alle kendte kæder/kilder findes i databasen (uden at overskrive flag). */
  async syncRegistry(): Promise<void> {
    // Kørsler der stadig står som "running" stammer fra en tidligere proces.
    await this.db.execute(
      sql`UPDATE scrape_runs SET status = 'failed', finished_at = now(), message = 'Afbrudt – serveren blev genstartet' WHERE status = 'running'`,
    );
    for (const chain of CHAINS) {
      await this.db
        .insert(stores)
        .values({
          id: chain.id,
          name: chain.name,
          color: chain.color,
          category: chain.category,
          website: chain.website,
          logoUrl: chain.logoUrl ?? null,
        })
        .onConflictDoUpdate({
          target: stores.id,
          set: { name: chain.name, color: chain.color, category: chain.category, website: chain.website },
        });
    }
    for (const s of this.scrapers) {
      await this.db
        .insert(scrapeSources)
        .values({ id: s.id, storeId: s.chain.id, kind: s.kind, description: s.description })
        .onConflictDoUpdate({ target: scrapeSources.id, set: { kind: s.kind, description: s.description } });
    }
    const purged = await purgeOutOfScope(this.db);
    if (purged) this.log.info(`${purged} tilbud fra pausede kæder/kategorier fjernet`);
  }

  isRunning(): boolean {
    return this.active.size > 0;
  }

  /** Kilder der må køre: kilden og kæden er slået til, og kæden er ikke slået fra via env. */
  private async enabledScrapers(ids?: string[]): Promise<Scraper[]> {
    const rows = await query<{ id: string; enabled: boolean; store_enabled: boolean }>(
      this.db,
      sql`SELECT ss.id, ss.enabled, s.enabled AS store_enabled FROM scrape_sources ss JOIN stores s ON s.id = ss.store_id`,
    );
    const allowed = new Set(
      rows
        .filter((r) => r.enabled && r.store_enabled)
        .map((r) => r.id),
    );
    return this.scrapers.filter(
      (s) =>
        allowed.has(s.id) &&
        !env.scraper.disabledChains.includes(s.chain.id) &&
        (!ids || ids.includes(s.id)),
    );
  }

  /** Starter kørsler i baggrunden. Returnerer de kilder der faktisk blev startet. */
  async start(trigger: Trigger, ids?: string[]): Promise<string[]> {
    const scrapers = (await this.enabledScrapers(ids)).filter((s) => !this.active.has(s.id));
    for (const s of scrapers) this.active.add(s.id);
    void Promise.all(scrapers.map((s) => this.runOne(s, trigger))).then(async (results) => {
      if (results.some((r) => r && r.offers.length)) {
        try {
          const n = await checkWatchlists(this.db, this.log);
          if (n) this.log.info(`${n} nye watchlist-notifikationer`);
        } catch (err) {
          this.log.error('Watchlist-tjek fejlede', { err: errorMessage(err) });
        }
      }
    });
    return scrapers.map((s) => s.id);
  }

  /** Kører og venter (bruges af CLI-scripts og tests). */
  async runAndWait(trigger: Trigger, ids?: string[]): Promise<(ScraperRunResult | null)[]> {
    const scrapers = (await this.enabledScrapers(ids)).filter((s) => !this.active.has(s.id));
    for (const s of scrapers) this.active.add(s.id);
    const results = await Promise.all(scrapers.map((s) => this.runOne(s, trigger)));
    await checkWatchlists(this.db, this.log);
    return results;
  }

  private async runOne(scraper: Scraper, trigger: Trigger): Promise<ScraperRunResult | null> {
    const [run] = await this.db
      .insert(scrapeRuns)
      .values({ sourceId: scraper.id, trigger })
      .returning({ id: scrapeRuns.id });
    const runId = run!.id;
    const rawIds = new Map<string, number>();
    const ctx: ScrapeContext = {
      http: this.http,
      log: this.log.child('scrape'),
      now: new Date(),
      geo: env.scraper.defaultGeo,
    };

    try {
      const result = await runScraper(scraper, ctx, {
        onRawBatch: async (batch) => {
          for (const [k, v] of await saveRawBatch(this.db, batch, runId)) rawIds.set(k, v);
        },
      });

      let saved = { offersSaved: 0, baselineSaved: 0 };
      let status: RunStatus = result.status;
      let message = result.error ?? result.note;
      try {
        saved = await ingestOffers(this.db, result.offers, rawIds);
      } catch (err) {
        status = 'failed';
        message = `Kunne ikke gemme data: ${errorMessage(err)}`;
        this.log.error(message);
      }

      const finishedAt = new Date();
      await this.db
        .update(scrapeRuns)
        .set({
          finishedAt,
          status,
          rawCount: result.rawCount,
          offersFound: result.offers.length,
          offersSaved: saved.offersSaved,
          baselineSaved: saved.baselineSaved,
          rejected: result.rejected,
          message,
          durationMs: finishedAt.getTime() - result.startedAt.getTime(),
        })
        .where(eq(scrapeRuns.id, runId));

      const ok = status === 'success';
      await this.db.execute(sql`
        UPDATE scrape_sources SET
          last_run_at = ${finishedAt.toISOString()}::timestamptz,
          last_success_at = CASE WHEN ${ok}::boolean THEN ${finishedAt.toISOString()}::timestamptz ELSE last_success_at END,
          last_status = ${status},
          last_error = ${ok ? null : message},
          consecutive_failures = CASE WHEN ${ok}::boolean THEN 0 ELSE consecutive_failures + 1 END
        WHERE id = ${scraper.id}`);

      await alertOnFailure({ ...result, status: status === 'failed' ? 'failed' : result.status, error: message }, this.notifier);
      return result;
    } catch (err) {
      this.log.error(`Kørsel af ${scraper.id} fejlede uventet`, { err: errorMessage(err) });
      await this.db
        .update(scrapeRuns)
        .set({ finishedAt: new Date(), status: 'failed', message: errorMessage(err) })
        .where(eq(scrapeRuns.id, runId));
      return null;
    } finally {
      this.active.delete(scraper.id);
    }
  }

  /** Henter butikslokationer (geolokation) for alle kæder der understøtter det. */
  async syncStoreLocations(): Promise<number> {
    if (this.storesSyncRunning) return 0;
    this.storesSyncRunning = true;
    let total = 0;
    try {
      const ctx: ScrapeContext = { http: this.http, log: this.log.child('stores'), now: new Date(), geo: env.scraper.defaultGeo };
      const seenChains = new Set<string>();
      for (const s of await this.enabledScrapers()) {
        if (!s.fetchStores || seenChains.has(s.chain.id)) continue;
        seenChains.add(s.chain.id);
        try {
          const locations = [];
          for await (const l of s.fetchStores(ctx)) locations.push(l);
          total += await upsertStoreLocations(this.db, locations);
          this.log.info(`${s.chain.name}: ${locations.length} butikker synkroniseret`);
        } catch (err) {
          this.log.warn(`Butikker for ${s.chain.name} kunne ikke hentes`, { err: errorMessage(err) });
        }
      }
    } finally {
      this.storesSyncRunning = false;
    }
    return total;
  }

  schedule(): void {
    if (env.SCRAPE_CRON && cron.validate(env.SCRAPE_CRON)) {
      this.tasks.push(
        cron.schedule(env.SCRAPE_CRON, () => void this.start('cron'), { timezone: 'Europe/Copenhagen', name: 'scrape' }),
      );
      this.log.info(`Scraping planlagt: "${env.SCRAPE_CRON}" (Europe/Copenhagen)`);
    }
    if (env.STORES_CRON && cron.validate(env.STORES_CRON)) {
      this.tasks.push(
        cron.schedule(env.STORES_CRON, () => void this.syncStoreLocations(), { timezone: 'Europe/Copenhagen', name: 'stores' }),
      );
    }
  }

  stop(): void {
    for (const t of this.tasks) void t.stop();
    this.tasks.length = 0;
  }

  async status(): Promise<ScrapeStatusDTO> {
    const sources = await query<{
      id: string;
      store_id: string;
      store_name: string;
      store_color: string;
      kind: string;
      description: string;
      enabled: boolean;
      store_enabled: boolean;
      last_run_at: Date | null;
      last_success_at: Date | null;
      last_status: string | null;
      last_error: string | null;
      consecutive_failures: number;
      active_offers: number;
    }>(
      this.db,
      sql`SELECT ss.*, s.name AS store_name, s.color AS store_color, s.enabled AS store_enabled,
            (SELECT count(*)::int FROM offers o WHERE o.source_id = ss.id AND o.valid_to > now()) AS active_offers
          FROM scrape_sources ss JOIN stores s ON s.id = ss.store_id
          WHERE ss.id IN (${sql.join(this.scrapers.map((x) => sql`${x.id}`), sql`, `)})
          ORDER BY s.name, ss.id`,
    );
    const runs = await query<{
      id: number;
      source_id: string;
      started_at: Date;
      finished_at: Date | null;
      status: string;
      offers_found: number;
      offers_saved: number;
      baseline_saved: number;
      rejected: number;
      message: string | null;
      duration_ms: number | null;
      rn: number;
    }>(
      this.db,
      sql`SELECT * FROM (
            SELECT r.*, row_number() OVER (PARTITION BY r.source_id ORDER BY r.started_at DESC)::int AS rn
            FROM scrape_runs r
          ) x WHERE rn <= 8`,
    );
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    const toRun = (r: (typeof runs)[number]): ScrapeRunDTO => ({
      id: r.id,
      sourceId: r.source_id,
      startedAt: iso(r.started_at)!,
      finishedAt: iso(r.finished_at),
      status: r.status as RunStatus,
      offersFound: r.offers_found,
      offersSaved: r.offers_saved,
      baselineSaved: r.baseline_saved,
      rejected: r.rejected,
      message: r.message,
      durationMs: r.duration_ms,
    });
    const envDisabled = new Set(env.scraper.disabledChains);
    return {
      running: this.isRunning(),
      current: [...this.active][0] ?? null,
      queue: [...this.active],
      hosts: this.http.limiter.usage(),
      schedule: env.SCRAPE_CRON || null,
      sources: sources.map(
        (s): SourceStatusDTO => ({
          id: s.id,
          storeId: s.store_id,
          storeName: s.store_name,
          storeColor: s.store_color,
          kind: s.kind as SourceStatusDTO['kind'],
          description: s.description,
          enabled: s.enabled,
          storeEnabled: s.store_enabled && !envDisabled.has(s.store_id),
          lastRunAt: iso(s.last_run_at),
          lastSuccessAt: iso(s.last_success_at),
          lastStatus: (s.last_status as RunStatus | null) ?? null,
          lastError: s.last_error,
          consecutiveFailures: s.consecutive_failures,
          activeOffers: s.active_offers,
          runs: runs.filter((r) => r.source_id === s.id).map(toRun),
        }),
      ),
    };
  }

  async hasData(): Promise<boolean> {
    const row = await queryOne<{ n: number }>(this.db, sql`SELECT count(*)::int AS n FROM offers WHERE valid_to > now()`);
    return (row?.n ?? 0) > 0;
  }

  async hasLocations(): Promise<boolean> {
    const row = await queryOne<{ n: number }>(this.db, sql`SELECT count(*)::int AS n FROM store_locations`);
    return (row?.n ?? 0) > 0;
  }
}
