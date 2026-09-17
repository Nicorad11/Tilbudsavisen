import { describe, expect, it } from 'vitest';
import { RobotsDisallowedError } from '../src/errors';
import { HttpClient, type FetchLike } from '../src/http/client';
import { HostRateLimiter } from '../src/http/rateLimiter';
import { crawlDelayFor, isAllowedByRobots, parseRobotsTxt } from '../src/http/robots';

const UA = 'TilbudsRadar/0.1 (+https://example.dk)';

describe('robots.txt', () => {
  const rema = parseRobotsTxt('User-agent: *\nDisallow: /api/*\nDisallow: /konto/*\n\nSitemap: https://rema1000.dk/sitemap_index.xml');
  const salling = parseRobotsTxt(
    'User-agent: *\nDisallow: /kurv\nDisallow: /search\nDisallow: */plp-main*\n\nUser-agent: tilbudsradar\nDisallow: /\nAllow: /tilbud$\nCrawl-delay: 5',
  );

  it('respekterer Disallow med wildcards', () => {
    expect(isAllowedByRobots(rema, UA, '/api/v1/products')).toBe(false);
    expect(isAllowedByRobots(rema, UA, '/avis')).toBe(true);
    expect(rema.sitemaps).toEqual(['https://rema1000.dk/sitemap_index.xml']);
  });

  it('vælger den mest specifikke user-agent-gruppe', () => {
    expect(isAllowedByRobots(salling, UA, '/tilbud')).toBe(true);
    expect(isAllowedByRobots(salling, UA, '/tilbud/mere')).toBe(false);
    expect(isAllowedByRobots(salling, 'AndenBot/1.0', '/tilbud/mere')).toBe(true);
    expect(isAllowedByRobots(salling, 'AndenBot/1.0', '/x/plp-main-1')).toBe(false);
    expect(crawlDelayFor(salling, UA)).toBe(5);
  });

  it('tom Disallow betyder alt er tilladt', () => {
    expect(isAllowedByRobots(parseRobotsTxt('User-agent: *\nDisallow:'), UA, '/api/v3/departments')).toBe(true);
  });
});

describe('HostRateLimiter', () => {
  function fakeClock() {
    const clock = { now: 0, sleeps: [] as number[] };
    const sleep = async (ms: number) => {
      clock.sleeps.push(Math.round(ms));
      clock.now += ms;
    };
    return { clock, sleep };
  }

  it('kører requests til samme vært serielt med pause imellem', async () => {
    const { clock, sleep } = fakeClock();
    const order: string[] = [];
    const task = (i: number) => async () => {
      order.push(`start${i}`);
      clock.now += 100;
      await Promise.resolve();
      order.push(`slut${i}`);
    };
    const l = new HostRateLimiter({ minDelayMs: 1000, maxDelayMs: 3000, maxPerMinute: 100 }, sleep, () => clock.now, () => 0);
    await Promise.all([1, 2, 3].map((i) => l.schedule('a.dk', task(i))));
    expect(order).toEqual(['start1', 'slut1', 'start2', 'slut2', 'start3', 'slut3']);
    // random() = 0 → pausen er præcis minDelayMs, målt fra forrige request sluttede.
    expect(clock.sleeps).toEqual([1000, 1000]);
    expect(l.usage()[0]).toMatchObject({ host: 'a.dk', total: 3 });
  });

  it('holder loftet pr. minut og lader andre værter køre uafhængigt', async () => {
    const { clock, sleep } = fakeClock();
    const l = new HostRateLimiter({ minDelayMs: 0, maxDelayMs: 0, maxPerMinute: 2 }, sleep, () => clock.now, () => 0);
    await Promise.all([l.schedule('a.dk', async () => 1), l.schedule('a.dk', async () => 2), l.schedule('b.dk', async () => 3)]);
    expect(clock.sleeps).toEqual([]);
    await l.schedule('a.dk', async () => 4);
    expect(clock.sleeps).toEqual([60_010]);
    expect(l.usage().find((u) => u.host === 'a.dk')?.total).toBe(3);
  });

  it('fortsætter køen selv om en request fejler', async () => {
    const { clock, sleep } = fakeClock();
    const l = new HostRateLimiter({ minDelayMs: 0, maxDelayMs: 0, maxPerMinute: 10 }, sleep, () => clock.now);
    await expect(l.schedule('a.dk', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(l.schedule('a.dk', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('HttpClient', () => {
  function setup(handler: (url: string, init?: RequestInit) => Response) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return handler(url, init);
    };
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    const limiter = new HostRateLimiter({ minDelayMs: 0, maxDelayMs: 0, maxPerMinute: 1000 }, sleep);
    const client = new HttpClient({ userAgent: UA, limiter, fetch: fetchImpl, sleep, maxRetries: 2 });
    return { client, calls, sleeps, limiter };
  }

  const robots = () =>
    new Response('User-agent: *\nDisallow: /privat\n', { status: 200, headers: { 'content-type': 'text/plain' } });

  it('afviser URL’er som robots.txt forbyder – uden at kalde dem', async () => {
    const { client, calls, limiter } = setup((url) => (url.endsWith('/robots.txt') ? robots() : Response.json({})));
    await expect(client.getJson('https://kaede.dk/privat/1')).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(calls.map((c) => c.url)).toEqual(['https://kaede.dk/robots.txt']);
    expect(limiter.usage()[0]?.robotsBlocked).toBe(1);
  });

  it('sender en tydelig User-Agent', async () => {
    const { client, calls } = setup((url) => (url.endsWith('/robots.txt') ? robots() : Response.json({ ok: 1 })));
    await expect(client.getJson('https://kaede.dk/tilbud')).resolves.toEqual({ ok: 1 });
    expect(calls[1]?.headers['User-Agent']).toBe(UA);
  });

  it('venter Retry-After ved 429 og prøver igen', async () => {
    let n = 0;
    const { client, sleeps } = setup((url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      n++;
      return n === 1 ? new Response('rolig nu', { status: 429, headers: { 'retry-after': '7' } }) : Response.json({ ok: true });
    });
    await expect(client.getJson('https://kaede.dk/data')).resolves.toEqual({ ok: true });
    expect(sleeps).toContain(7000);
    expect(n).toBe(2);
  });

  it('giver op efter maxRetries ved vedvarende 5xx', async () => {
    const { client } = setup((url) =>
      url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response('nede', { status: 503 }),
    );
    await expect(client.getJson('https://kaede.dk/data')).rejects.toThrow(/HTTP 503/);
  });

  it('bruger cachen når Cache-Control tillader det', async () => {
    let hits = 0;
    const { client, limiter } = setup((url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      hits++;
      return new Response(JSON.stringify({ v: hits }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
      });
    });
    await client.getJson('https://kaede.dk/cached');
    await expect(client.getJson('https://kaede.dk/cached')).resolves.toEqual({ v: 1 });
    expect(hits).toBe(1);
    expect(limiter.usage()[0]?.cacheHits).toBe(1);
  });

  it('cacher ikke når kilden siger no-store', async () => {
    let hits = 0;
    const { client } = setup((url) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      hits++;
      return new Response('{}', { headers: { 'cache-control': 'no-store', etag: '"abc"' } });
    });
    await client.getJson('https://kaede.dk/x');
    await client.getJson('https://kaede.dk/x');
    expect(hits).toBe(2);
  });

  it('behandler en utilgængelig robots.txt (5xx) som lukket', async () => {
    const { client } = setup((url) =>
      url.endsWith('/robots.txt') ? new Response('fejl', { status: 500 }) : Response.json({}),
    );
    await expect(client.getJson('https://nede.dk/a')).rejects.toBeInstanceOf(RobotsDisallowedError);
  });
});
