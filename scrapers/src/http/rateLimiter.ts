export interface RateLimitOptions {
  /** Mindste pause mellem to requests til samme vært. */
  minDelayMs: number;
  /** Største pause – den faktiske pause er tilfældig mellem min og max. */
  maxDelayMs: number;
  /** Loft for requests pr. vært pr. rullende minut. */
  maxPerMinute: number;
}

export interface HostUsage {
  host: string;
  lastMinute: number;
  total: number;
  limitPerMinute: number;
  cacheHits: number;
  robotsBlocked: number;
}

interface HostState {
  tail: Promise<unknown>;
  lastFinishedAt: number | null;
  timestamps: number[];
  total: number;
  cacheHits: number;
  robotsBlocked: number;
  crawlDelayMs: number;
}

export type Sleep = (ms: number) => Promise<void>;
export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Central rate-limiter delt af ALLE scrapere i processen.
 *
 * Requests til samme vært køres strengt serielt med en tilfældig pause
 * (min–max) imellem, og antallet pr. rullende minut er loftbelagt. To
 * scrapere der rammer samme vært (fx fem kæder via samme tilbuds-API)
 * deler derfor kø og budget.
 */
export class HostRateLimiter {
  private readonly hosts = new Map<string, HostState>();

  constructor(
    private readonly opts: RateLimitOptions,
    private readonly sleep: Sleep = defaultSleep,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const state = this.state(host);
    const result = state.tail.then(async () => {
      await this.waitForSlot(state);
      state.timestamps.push(this.now());
      state.total++;
      try {
        return await task();
      } finally {
        state.lastFinishedAt = this.now();
      }
    });
    // Kæden må ikke knække hvis en enkelt request fejler.
    state.tail = result.catch(() => undefined);
    return result;
  }

  /** robots.txt kan angive Crawl-delay – den respekteres hvis den er større. */
  setCrawlDelay(host: string, seconds: number | null | undefined): void {
    if (!seconds || !Number.isFinite(seconds)) return;
    this.state(host).crawlDelayMs = Math.min(seconds, 60) * 1000;
  }

  noteCacheHit(host: string): void {
    this.state(host).cacheHits++;
  }

  noteRobotsBlocked(host: string): void {
    this.state(host).robotsBlocked++;
  }

  usage(): HostUsage[] {
    const cutoff = this.now() - 60_000;
    return [...this.hosts.entries()].map(([host, s]) => ({
      host,
      lastMinute: s.timestamps.filter((t) => t > cutoff).length,
      total: s.total,
      limitPerMinute: this.opts.maxPerMinute,
      cacheHits: s.cacheHits,
      robotsBlocked: s.robotsBlocked,
    }));
  }

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = {
        tail: Promise.resolve(),
        lastFinishedAt: null,
        timestamps: [],
        total: 0,
        cacheHits: 0,
        robotsBlocked: 0,
        crawlDelayMs: 0,
      };
      this.hosts.set(host, s);
    }
    return s;
  }

  private async waitForSlot(state: HostState): Promise<void> {
    if (state.lastFinishedAt !== null) {
      const { minDelayMs, maxDelayMs } = this.opts;
      const jitter = minDelayMs + this.random() * (maxDelayMs - minDelayMs);
      const gap = Math.max(jitter, state.crawlDelayMs);
      const elapsed = this.now() - state.lastFinishedAt;
      if (elapsed < gap) await this.sleep(gap - elapsed);
    }
    for (;;) {
      const cutoff = this.now() - 60_000;
      state.timestamps = state.timestamps.filter((t) => t > cutoff);
      if (state.timestamps.length < this.opts.maxPerMinute) return;
      const oldest = state.timestamps[0] ?? this.now();
      await this.sleep(Math.max(50, oldest - cutoff + 10));
    }
  }
}
