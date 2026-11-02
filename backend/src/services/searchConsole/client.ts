import { JWT } from 'google-auth-library';

/**
 * Klient til Search Console API (searchconsole.googleapis.com): søgeresultater,
 * URL-inspektion og sitemaps. Kun læseadgang (scope webmasters.readonly).
 *
 * Bevidst IKKE Indexing API (kun til jobopslag og livestreams) og IKKE det
 * udfasede sitemap-ping-endpoint.
 */

const API = 'https://searchconsole.googleapis.com';
export const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
/** Flest rækker pr. kald (API'ets grænse). */
export const ROW_LIMIT = 25_000;
/** Sikkerhedsgrænse: højst så mange sider pr. forespørgsel (1 mio. rækker). */
const MAX_PAGES = 40;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export type SearchType = 'web' | 'image' | 'discover';
export type Dimension = 'date' | 'query' | 'page' | 'device' | 'country';

export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions: Dimension[];
  type: SearchType;
  dataState?: 'final' | 'all';
  /** Kun Danmark: 'dnk'. Udeladt = alle lande. */
  country?: string;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface UrlInspection {
  verdict: string | null;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  crawledAs: string | null;
}

export interface SitemapInfo {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  isSitemapsIndex: boolean;
  errors: number;
  warnings: number;
  submitted: number;
}

export interface GscClient {
  searchAnalytics(req: SearchAnalyticsRequest): Promise<SearchAnalyticsRow[]>;
  inspectUrl(url: string): Promise<UrlInspection>;
  listSitemaps(): Promise<SitemapInfo[]>;
}

/** Fejl fra Google – beskeden er renset for nøgler og tokens. */
export class GscApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GscApiError';
  }
}

/** Fjerner alt, der ligner en privat nøgle eller et token, og afkorter. */
export function redactSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[nøgle fjernet]')
    .replace(/\b(ya29\.|eyJ)[A-Za-z0-9._-]{10,}/g, '[token fjernet]')
    .replace(/[A-Za-z0-9+/_-]{60,}={0,2}/g, '[…]')
    .slice(0, 300);
}

/** Adgangstokens fra service accounten (google-auth-library genbruger og fornyer selv tokenet). */
export function serviceAccountTokenProvider(clientEmail: string, privateKey: string): () => Promise<string> {
  const jwt = new JWT({ email: clientEmail, key: privateKey, scopes: [SCOPE] });
  return async () => {
    try {
      const { token } = await jwt.getAccessToken();
      if (!token) throw new Error('Google gav intet adgangstoken');
      return token;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GscApiError(401, `Kunne ikke logge ind hos Google med service accounten: ${redactSecrets(message)}`);
    }
  };
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : 0) || 0;
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function createGscClient(o: {
  siteUrl: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): GscClient {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = o.maxRetries ?? 3;
  const site = encodeURIComponent(o.siteUrl);

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await o.getToken();
      let res: Response;
      try {
        res = await fetchImpl(`${API}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new GscApiError(0, `Search Console svarede ikke: ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
      }
      if (res.ok) return (await res.json()) as T;
      if (RETRY_STATUS.has(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      let detail = res.statusText;
      try {
        const data = (await res.json()) as { error?: { message?: string } };
        if (data.error?.message) detail = data.error.message;
      } catch {
        // Intet JSON-svar – statusteksten må række.
      }
      throw new GscApiError(res.status, `Search Console svarede ${res.status}: ${redactSecrets(detail)}`);
    }
  }

  return {
    async searchAnalytics(req) {
      const rows: SearchAnalyticsRow[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = {
          startDate: req.startDate,
          endDate: req.endDate,
          dimensions: req.dimensions,
          type: req.type,
          dataState: req.dataState ?? 'final',
          rowLimit: ROW_LIMIT,
          startRow: page * ROW_LIMIT,
          ...(req.country
            ? { dimensionFilterGroups: [{ filters: [{ dimension: 'country', operator: 'equals', expression: req.country }] }] }
            : {}),
        };
        const data = await call<{ rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[] }>(
          'POST',
          `/webmasters/v3/sites/${site}/searchAnalytics/query`,
          body,
        );
        const batch = data.rows ?? [];
        for (const r of batch) {
          rows.push({ keys: r.keys ?? [], clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.ctr), position: num(r.position) });
        }
        if (batch.length < ROW_LIMIT) break;
      }
      return rows;
    },

    async inspectUrl(url) {
      const data = await call<{ inspectionResult?: { indexStatusResult?: Record<string, unknown> } }>('POST', '/v1/urlInspection/index:inspect', {
        inspectionUrl: url,
        siteUrl: o.siteUrl,
        languageCode: 'da-DK',
      });
      const r = data.inspectionResult?.indexStatusResult ?? {};
      return {
        verdict: str(r.verdict),
        coverageState: str(r.coverageState),
        robotsTxtState: str(r.robotsTxtState),
        indexingState: str(r.indexingState),
        pageFetchState: str(r.pageFetchState),
        lastCrawlTime: str(r.lastCrawlTime),
        googleCanonical: str(r.googleCanonical),
        userCanonical: str(r.userCanonical),
        crawledAs: str(r.crawledAs),
      };
    },

    async listSitemaps() {
      const data = await call<{ sitemap?: Record<string, unknown>[] }>('GET', `/webmasters/v3/sites/${site}/sitemaps`);
      return (data.sitemap ?? []).map((s) => ({
        path: String(s.path ?? ''),
        lastSubmitted: str(s.lastSubmitted),
        lastDownloaded: str(s.lastDownloaded),
        isPending: Boolean(s.isPending),
        isSitemapsIndex: Boolean(s.isSitemapsIndex),
        // Tal kommer som tekst (int64) fra API'et.
        errors: num(s.errors),
        warnings: num(s.warnings),
        submitted: Array.isArray(s.contents) ? (s.contents as { submitted?: unknown }[]).reduce((sum, c) => sum + num(c.submitted), 0) : 0,
      }));
    },
  };
}
