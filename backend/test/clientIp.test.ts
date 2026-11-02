import { silentLogger } from '@tilbudsradar/scrapers';
import express, { type Request } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { createApp } from '../src/http/app';
import { clientIp, clientKey, ipv6Prefix64, isCloudflareIp, isInternalIp, trustProxy } from '../src/http/clientIp';
import { ScrapeManager } from '../src/services/scrapeJobs';

/** Supertest forbinder fra 127.0.0.1 – det svarer til Renders interne proxy foran appen. */
const CF_EDGE = '172.70.10.1'; // Cloudflare (172.64.0.0/13)

/** Hvor mange forespørgsler der er tilbage for den nøgle, forespørgslen fik (RateLimit-headeren, draft-8). */
const remaining = (res: request.Response) => Number(/;\s*r=(\d+)/.exec(String(res.headers['ratelimit']))?.[1]);

describe('klient-IP', () => {
  it('kender Cloudflares og de interne net', () => {
    expect(isCloudflareIp('104.16.0.1')).toBe(true);
    expect(isCloudflareIp('2606:4700::1')).toBe(true);
    expect(isCloudflareIp('203.0.113.7')).toBe(false);
    expect(isInternalIp('10.12.3.4')).toBe(true);
    expect(isInternalIp('::ffff:127.0.0.1')).toBe(true);
    expect(trustProxy('203.0.113.7')).toBe(false);
  });

  it('IPv6 samles pr. /64', () => {
    expect(ipv6Prefix64('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12');
    expect(ipv6Prefix64('2001:db8::1')).toBe('2001:db8:0:0');
    expect(ipv6Prefix64('::1')).toBe('0:0:0:0');
  });

  /** En falsk request som bag Render: socket fra den interne proxy, headere som sendt videre af Cloudflare. */
  function fakeReq(headers: Record<string, string>, ip: string): Request {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { get: (name: string) => lower[name.toLowerCase()], ip, socket: { remoteAddress: '10.0.0.5' } } as unknown as Request;
  }

  it('bag Render bruges CF-Connecting-IP – forfalsket X-Forwarded-For og True-Client-IP ignoreres', () => {
    const req = fakeReq(
      { 'CF-Connecting-IP': '198.51.100.23', 'X-Forwarded-For': '6.6.6.6, 198.51.100.23, 172.70.10.1', 'True-Client-IP': '6.6.6.6' },
      '198.51.100.23',
    );
    expect(clientIp(req, { trustCloudflareHeader: true })).toBe('198.51.100.23');
    // IPv6-klienter får hele deres /64 som nøgle.
    const v6 = fakeReq({ 'CF-Connecting-IP': '2001:db8:1:2:aaaa::9' }, '');
    expect(clientKey(v6, { trustCloudflareHeader: true })).toBe('2001:db8:1:2::/64');
  });

  it('en ugyldig CF-Connecting-IP giver den IP, proxykæden udleder', () => {
    const req = fakeReq({ 'CF-Connecting-IP': 'ikke-en-ip' }, '198.51.100.23');
    expect(clientIp(req, { trustCloudflareHeader: true })).toBe('198.51.100.23');
  });

  it('uden for Render stoles der ikke på CF-Connecting-IP', () => {
    const req = fakeReq({ 'CF-Connecting-IP': '6.6.6.6' }, '198.51.100.23');
    expect(clientIp(req, { trustCloudflareHeader: false })).toBe('198.51.100.23');
  });
});

describe('X-Forwarded-For med trust proxy', () => {
  // En lille app med samme trust proxy-opsætning, der svarer med den IP, Express udleder.
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/ip', (req, res) => {
    res.json({ ip: clientIp(req, { trustCloudflareHeader: false }) });
  });
  const ipFor = async (xff: string) => ((await request(app).get('/ip').set('X-Forwarded-For', xff).expect(200)).body as { ip: string }).ip;

  it('vælger den første adresse fra højre, der ikke er Render eller Cloudflare', async () => {
    expect(await ipFor(`203.0.113.7, ${CF_EDGE}`)).toBe('203.0.113.7');
  });

  it('klientens egne poster længere til venstre kan ikke ændre resultatet', async () => {
    expect(await ipFor(`6.6.6.6, 203.0.113.7, ${CF_EDGE}`)).toBe('203.0.113.7');
    expect(await ipFor(`1.1.1.1, 9.9.9.9, 203.0.113.7, ${CF_EDGE}`)).toBe('203.0.113.7');
  });

  it('at udgive sig for at være Cloudflare hjælper ikke', async () => {
    // Klienten sender selv en Cloudflare-adresse til venstre for sin rigtige IP.
    expect(await ipFor(`104.16.0.1, 203.0.113.7, ${CF_EDGE}`)).toBe('203.0.113.7');
  });
});

describe('rate limiting pr. rigtig klient', () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createDatabase({ url: null, dataDir: 'memory://' });
    await database.migrate();
    const scrape = new ScrapeManager(database.db, silentLogger);
    await scrape.syncRegistry();
    app = createApp({ db: database.db, scrape, stripe: null });
  });

  afterAll(async () => {
    await database?.close();
  });

  it('samme klient tæller i samme kvote, selv med forfalsket X-Forwarded-For; en anden klient har sin egen', async () => {
    const hit = (xff: string) => request(app).get('/api/stats').set('X-Forwarded-For', xff).expect(200);
    const first = remaining(await hit(`203.0.113.50, ${CF_EDGE}`));
    // Samme rigtige klient via en anden Cloudflare-server og med falske poster foran.
    const second = remaining(await hit(`6.6.6.6, 203.0.113.50, 162.158.1.1`));
    const third = remaining(await hit(`7.7.7.7, 8.8.8.8, 203.0.113.50, ${CF_EDGE}`));
    expect(second).toBe(first - 1);
    expect(third).toBe(first - 2);
    // En anden klient starter forfra.
    expect(remaining(await hit(`203.0.113.51, ${CF_EDGE}`))).toBe(first);
  });

  it('login: højst 10 mislykkede forsøg pr. e-mail pr. 15 min – også fra skiftende IP\'er', async () => {
    const attempt = (email: string, i: number) =>
      request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `198.51.100.${i}, ${CF_EDGE}`)
        .send({ email, password: 'forkert-kode' });
    for (let i = 1; i <= 10; i++) expect((await attempt('offer@example.dk', i)).status).toBe(401);
    const blocked = await attempt('offer@example.dk', 11);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/denne e-mail/);
    // Store/små bogstaver og mellemrum giver ingen ny kvote.
    expect((await attempt('  OFFER@example.dk ', 12)).status).toBe(429);
    // En anden e-mail er ikke ramt.
    expect((await attempt('anden@example.dk', 13)).status).toBe(401);
  });

  it('glemt adgangskode: højst 10 pr. e-mail pr. 15 min', async () => {
    const ask = (i: number) =>
      request(app)
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', `192.0.2.${i}, ${CF_EDGE}`)
        .send({ email: 'glemsom@example.dk' });
    for (let i = 1; i <= 10; i++) expect((await ask(i)).status).toBe(200);
    expect((await ask(11)).status).toBe(429);
  });
});
