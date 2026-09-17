import { HttpError, RobotsDisallowedError } from '../errors';
import type { Logger } from '../log';
import { silentLogger } from '../log';
import { ResponseCache, cachePolicy } from './cache';
import { HostRateLimiter, defaultSleep, type Sleep } from './rateLimiter';
import { ALLOW_ALL, DISALLOW_ALL, crawlDelayFor, isAllowedByRobots, parseRobotsTxt, type RobotsTxt } from './robots';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  userAgent: string;
  limiter: HostRateLimiter;
  cache?: ResponseCache;
  fetch?: FetchLike;
  sleep?: Sleep;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: Logger;
  /** Hvor længe robots.txt caches (default 12 timer). */
  robotsTtlMs?: number;
}

interface RobotsEntry {
  robots: RobotsTxt;
  fetchedAt: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Ansvarlig HTTP-klient til scraping:
 *  - tydelig User-Agent
 *  - tjekker robots.txt før hver request (caches pr. vært)
 *  - alle requests går gennem den centrale rate-limiter
 *  - respekterer Cache-Control/ETag og Retry-After
 *  - retry med eksponentiel backoff på 429/5xx
 */
export class HttpClient {
  private readonly cache: ResponseCache;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly log: Logger;
  private readonly robotsTtlMs: number;
  private readonly robots = new Map<string, Promise<RobotsEntry>>();

  constructor(private readonly opts: HttpClientOptions) {
    this.cache = opts.cache ?? new ResponseCache();
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? defaultSleep;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.log = opts.logger ?? silentLogger;
    this.robotsTtlMs = opts.robotsTtlMs ?? 12 * 60 * 60 * 1000;
  }

  get userAgent(): string {
    return this.opts.userAgent;
  }

  get limiter(): HostRateLimiter {
    return this.opts.limiter;
  }

  async getJson<T = unknown>(url: string): Promise<T> {
    const body = await this.get(url, 'application/json');
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new HttpError(url, 200, `Ugyldig JSON fra ${url}`);
    }
  }

  async getText(url: string): Promise<string> {
    return this.get(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8');
  }

  async isAllowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const { robots } = await this.robotsFor(u);
    return isAllowedByRobots(robots, this.opts.userAgent, u.pathname + u.search);
  }

  private async get(url: string, accept: string): Promise<string> {
    const u = new URL(url);
    const host = u.host;

    if (!(await this.isAllowed(url))) {
      this.opts.limiter.noteRobotsBlocked(host);
      throw new RobotsDisallowedError(url);
    }

    const cached = this.cache.get(url);
    if (cached && cached.freshUntil > Date.now()) {
      this.opts.limiter.noteCacheHit(host);
      return cached.body;
    }

    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        'User-Agent': this.opts.userAgent,
        Accept: accept,
        'Accept-Language': 'da-DK,da;q=0.9,en;q=0.5',
      };
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

      let res: Response;
      try {
        res = await this.opts.limiter.schedule(host, () =>
          this.fetchImpl(url, { headers, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'follow' }),
        );
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        const wait = this.backoff(attempt);
        this.log.warn(`Netværksfejl – prøver igen om ${Math.round(wait / 1000)}s`, { url, err: String(err) });
        await this.sleep(wait);
        continue;
      }

      if (res.status === 304 && cached) {
        await res.body?.cancel();
        const policy = cachePolicy(res.headers, Date.now());
        this.cache.set(url, { ...cached, storedAt: Date.now(), freshUntil: Date.now() + policy.maxAgeMs });
        this.opts.limiter.noteCacheHit(host);
        return cached.body;
      }

      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        await res.body?.cancel();
        const wait = this.retryAfter(res) ?? this.backoff(attempt);
        this.log.warn(`HTTP ${res.status} – venter ${Math.round(wait / 1000)}s før nyt forsøg`, { url });
        await this.sleep(wait);
        continue;
      }

      const body = await res.text();
      if (!res.ok) {
        throw new HttpError(url, res.status, `HTTP ${res.status} fra ${u.host}${u.pathname}: ${body.slice(0, 160)}`);
      }

      const now = Date.now();
      const policy = cachePolicy(res.headers, now);
      if (policy.store) {
        this.cache.set(url, {
          body,
          status: res.status,
          storedAt: now,
          freshUntil: now + policy.maxAgeMs,
          etag: res.headers.get('etag'),
          lastModified: res.headers.get('last-modified'),
        });
      }
      return body;
    }
  }

  private backoff(attempt: number): number {
    return Math.min(60_000, 2_000 * 2 ** attempt) + Math.floor(Math.random() * 500);
  }

  private retryAfter(res: Response): number | null {
    const value = res.headers.get('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.min(120_000, seconds * 1000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.min(120_000, Math.max(0, date - Date.now())) : null;
  }

  private robotsFor(u: URL): Promise<RobotsEntry> {
    const key = u.origin;
    const existing = this.robots.get(key);
    if (existing) {
      return existing.then((entry) => {
        if (Date.now() - entry.fetchedAt < this.robotsTtlMs) return entry;
        this.robots.delete(key);
        return this.robotsFor(u);
      });
    }
    const pending = this.fetchRobots(u);
    this.robots.set(key, pending);
    return pending;
  }

  private async fetchRobots(u: URL): Promise<RobotsEntry> {
    const url = `${u.origin}/robots.txt`;
    let robots: RobotsTxt;
    // Ved midlertidige fejl caches "lukket" kun kort, så næste kørsel prøver igen.
    let transient = false;
    try {
      const res = await this.opts.limiter.schedule(u.host, () =>
        this.fetchImpl(url, {
          headers: { 'User-Agent': this.opts.userAgent, Accept: 'text/plain,*/*' },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'follow',
        }),
      );
      const text = await res.text();
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && !type.includes('text/html')) {
        robots = parseRobotsTxt(text);
      } else if (res.ok || (res.status >= 400 && res.status < 500)) {
        // 4xx (eller en HTML-side i stedet for robots.txt) = ingen regler.
        robots = ALLOW_ALL;
      } else {
        this.log.warn(`robots.txt på ${u.host} svarede ${res.status} – behandler værten som lukket`);
        robots = DISALLOW_ALL;
        transient = true;
      }
    } catch (err) {
      this.log.warn(`Kunne ikke hente robots.txt fra ${u.host} – behandler værten som lukket`, { err: String(err) });
      robots = DISALLOW_ALL;
      transient = true;
    }
    this.opts.limiter.setCrawlDelay(u.host, crawlDelayFor(robots, this.opts.userAgent));
    const fetchedAt = transient ? Date.now() - this.robotsTtlMs + 5 * 60 * 1000 : Date.now();
    return { robots, fetchedAt };
  }
}
