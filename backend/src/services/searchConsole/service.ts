import type { Logger, Notifier } from '@tilbudsradar/scrapers';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { gscSyncRuns, gscUrlInspections } from '../../db/schema';
import { env } from '../../env';
import { sitemaps, sitemapUrls } from '../seo/sitemap';
import { createGscClient, GscApiError, redactSecrets, serviceAccountTokenProvider, type GscClient } from './client';
import { gscConfig, publicGscStatus, type GscConfig } from './config';
import {
  nextInspectionTargets,
  recentInspectionCalls,
  recordInspectionCall,
  saveInspection,
  syncInspectionTargets,
  type InspectionRow,
} from './inspections';
import { INSPECT_PER_RUN, QuotaLimiter, type QuotaOptions } from './quota';
import { syncFreshTotals, syncMetrics, syncRange, syncSitemaps } from './sync';

/** Så mange fejlede kørsler i træk, før der sendes en alarm (Slack/e-mail). */
export const ALERT_AFTER_FAILURES = 2;

export type SyncTrigger = 'cron' | 'manual' | 'report';

export interface SyncResult {
  status: 'success' | 'partial' | 'failed' | 'skipped' | 'busy';
  rows: number;
  inspected: number;
  error: string | null;
}

export interface SearchConsoleService {
  status(): ReturnType<typeof publicGscStatus>;
  running(): boolean;
  /** Fejler aldrig – fejl gemmes på kørslen og logges. */
  sync(trigger: SyncTrigger): Promise<SyncResult>;
  /** Inspicerer én URL med det samme (tæller med i kvoten). */
  inspect(url: string): Promise<InspectionRow>;
}

export class GscUnavailableError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

const safeMessage = (err: unknown) => redactSecrets(err instanceof GscApiError ? err.message : err instanceof Error ? err.message : String(err));

export function createSearchConsoleService(
  db: Db,
  o: {
    config?: GscConfig;
    client?: GscClient;
    log: Logger;
    notifier?: Notifier;
    appUrl?: string;
    now?: () => Date;
    quota?: Omit<QuotaOptions, 'now'>;
    perRun?: number;
  },
): SearchConsoleService {
  const config = o.config ?? gscConfig();
  const now = o.now ?? (() => new Date());
  const appUrl = o.appUrl ?? env.APP_URL;
  const client = config.enabled
    ? (o.client ?? createGscClient({ siteUrl: config.siteUrl, getToken: serviceAccountTokenProvider(config.clientEmail, config.privateKey) }))
    : null;
  let busy = false;

  async function limiter() {
    const previous = await recentInspectionCalls(db, now());
    return new QuotaLimiter(previous, { ...o.quota, now: () => now().getTime() });
  }

  async function inspectOne(gsc: GscClient, url: string): Promise<'ok' | 'error' | 'quota'> {
    try {
      const result = await gsc.inspectUrl(url);
      await saveInspection(db, url, result, now());
      return 'ok';
    } catch (err) {
      await saveInspection(db, url, { error: safeMessage(err) }, now());
      if (err instanceof GscApiError && err.status === 429) return 'quota';
      if (err instanceof GscApiError && (err.status === 401 || err.status === 403)) throw err;
      return 'error';
    }
  }

  /** Inspicerer de næste URL'er i rotationen. */
  async function runInspections(gsc: GscClient): Promise<{ inspected: number; errors: number }> {
    const urls = sitemapUrls(await sitemaps(db)).map((e) => `${appUrl}${e.path}`);
    await syncInspectionTargets(db, urls, now());
    const quota = await limiter();
    let inspected = 0;
    let errors = 0;
    for (const url of await nextInspectionTargets(db, o.perRun ?? INSPECT_PER_RUN)) {
      if (!(await quota.acquire())) break;
      await recordInspectionCall(db, now());
      const outcome = await inspectOne(gsc, url);
      if (outcome === 'quota') break;
      if (outcome === 'error') errors++;
      inspected++;
    }
    return { inspected, errors };
  }

  async function alertIfRepeated(error: string) {
    const last = await db.select({ status: gscSyncRuns.status }).from(gscSyncRuns).orderBy(desc(gscSyncRuns.id)).limit(ALERT_AFTER_FAILURES);
    if (last.length === ALERT_AFTER_FAILURES && last.every((r) => r.status === 'failed')) {
      await o.notifier
        ?.notify({ level: 'error', sourceId: 'search-console', title: 'Search Console-synkronisering fejler', message: `${ALERT_AFTER_FAILURES} kørsler i træk er fejlet. Seneste fejl: ${error}` })
        .catch(() => undefined);
    }
  }

  return {
    status: () => publicGscStatus(config),
    running: () => busy,

    async sync(trigger) {
      if (!client) return { status: 'skipped', rows: 0, inspected: 0, error: config.enabled ? null : config.reason };
      if (busy) return { status: 'busy', rows: 0, inspected: 0, error: null };
      busy = true;
      const started = now();
      let runId: number | null = null;
      try {
        const range = await syncRange(db, started);
        const [run] = await db
          .insert(gscSyncRuns)
          .values({ startedAt: started, trigger, status: 'running', rangeStart: range.start, rangeEnd: range.end })
          .returning({ id: gscSyncRuns.id });
        runId = run!.id;

        let rows = 0;
        let inspected = 0;
        const problems: string[] = [];
        let failed: string | null = null;
        try {
          rows += await syncMetrics(db, client, range, started);
        } catch (err) {
          failed = safeMessage(err);
        }
        if (!failed) {
          for (const [label, step] of [
            ['foreløbige tal', () => syncFreshTotals(db, client, started)],
            ['sitemaps', () => syncSitemaps(db, client, started)],
          ] as const) {
            try {
              await step();
            } catch (err) {
              problems.push(`${label}: ${safeMessage(err)}`);
            }
          }
          try {
            const r = await runInspections(client);
            inspected = r.inspected;
            if (r.errors) problems.push(`${r.errors} URL-inspektioner fejlede`);
          } catch (err) {
            problems.push(`URL-inspektion: ${safeMessage(err)}`);
          }
        }

        const status: SyncResult['status'] = failed ? 'failed' : problems.length ? 'partial' : 'success';
        const error = failed ?? (problems.length ? problems.join(' · ').slice(0, 1000) : null);
        await db.update(gscSyncRuns).set({ finishedAt: now(), status, rows, inspected, error }).where(eq(gscSyncRuns.id, runId));
        if (status === 'failed') {
          o.log.error('Search Console-synkronisering fejlede', { trigger, error });
          await alertIfRepeated(error!);
        } else {
          o.log.info('Search Console hentet', { trigger, status, rows, inspected, range: `${range.start}–${range.end}` });
          if (error) o.log.warn('Search Console: dele af hentningen fejlede', { error });
        }
        return { status, rows, inspected, error };
      } catch (err) {
        // Databasefejl o.l. – kørslen markeres, og serveren lever videre.
        const error = safeMessage(err);
        o.log.error('Search Console-synkronisering fejlede', { trigger, error });
        if (runId !== null) await db.update(gscSyncRuns).set({ finishedAt: now(), status: 'failed', error }).where(eq(gscSyncRuns.id, runId)).catch(() => undefined);
        return { status: 'failed', rows: 0, inspected: 0, error };
      } finally {
        busy = false;
      }
    },

    async inspect(url) {
      if (!client) throw new GscUnavailableError(config.enabled ? 'Search Console er ikke klar.' : `Search Console er ikke sat op: ${config.reason}`);
      const quota = await limiter();
      if (!(await quota.acquire())) throw new GscUnavailableError('Dagens kvote for URL-inspektion er brugt. Prøv igen i morgen.', 429);
      await recordInspectionCall(db, now());
      const outcome = await inspectOne(client, url);
      const [row] = await db.select().from(gscUrlInspections).where(eq(gscUrlInspections.url, url)).limit(1);
      if (outcome === 'quota') throw new GscUnavailableError('Google afviste kaldet (kvote). Prøv igen senere.', 429);
      return row!;
    },
  };
}

let defaultService: SearchConsoleService | null = null;

/** Den fælles service for serveren (oprettes ved første brug ud fra miljøvariablerne). */
export function searchConsoleService(db: Db, o: { log: Logger; notifier?: Notifier }): SearchConsoleService {
  defaultService ??= createSearchConsoleService(db, o);
  return defaultService;
}
