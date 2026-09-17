export interface CachedResponse {
  body: string;
  status: number;
  storedAt: number;
  /** Frisk indtil dette tidspunkt; derefter skal der revalideres. */
  freshUntil: number;
  etag: string | null;
  lastModified: string | null;
}

export interface CachePolicy {
  store: boolean;
  maxAgeMs: number;
}

/** Fortolker Cache-Control / Expires efter hvad kilden selv beder om. */
export function cachePolicy(headers: Headers, now: number): CachePolicy {
  const cc = (headers.get('cache-control') ?? '').toLowerCase();
  const directives = new Map<string, string | true>();
  for (const part of cc.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k) directives.set(k, v ? v.replace(/"/g, '') : true);
  }
  if (directives.has('no-store')) return { store: false, maxAgeMs: 0 };

  const hasValidator = Boolean(headers.get('etag') || headers.get('last-modified'));
  if (directives.has('no-cache')) return { store: hasValidator, maxAgeMs: 0 };

  const maxAge = Number(directives.get('s-maxage') ?? directives.get('max-age'));
  if (Number.isFinite(maxAge) && maxAge >= 0) {
    return { store: maxAge > 0 || hasValidator, maxAgeMs: maxAge * 1000 };
  }
  const expires = headers.get('expires');
  if (expires) {
    const t = Date.parse(expires);
    if (Number.isFinite(t)) return { store: t > now || hasValidator, maxAgeMs: Math.max(0, t - now) };
  }
  // Ingen instrukser: gem kun hvis vi kan revalidere billigt.
  return { store: hasValidator, maxAgeMs: 0 };
}

/** Lille LRU-cache i hukommelsen. */
export class ResponseCache {
  private readonly entries = new Map<string, CachedResponse>();

  constructor(private readonly maxEntries = 500) {}

  get(url: string): CachedResponse | undefined {
    const hit = this.entries.get(url);
    if (hit) {
      this.entries.delete(url);
      this.entries.set(url, hit);
    }
    return hit;
  }

  set(url: string, value: CachedResponse): void {
    this.entries.delete(url);
    this.entries.set(url, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
