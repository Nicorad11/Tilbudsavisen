import { scrubSentryEvent } from '@tilbudsradar/shared';
import { silentLogger } from '@tilbudsradar/scrapers';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { companyProblems } from '../src/env';
import { createApp } from '../src/http/app';
import { mountSite, SECURITY_TXT_EXPIRES } from '../src/http/site';
import { ScrapeManager } from '../src/services/scrapeJobs';

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

describe('query-parametre', () => {
  it('afviser objekter og lister – kun almindelig tekst', async () => {
    await request(app).get('/api/search?q[$ne]=x').expect(400);
    await request(app).get('/api/search?q%5B%24ne%5D=x').expect(400);
    await request(app).get('/api/search?q=kaffe&q=te').expect(400);
    await request(app).get('/api/stores/nearby?zip[gt]=1').expect(400);
    const ok = await request(app).get('/api/search?q=kaffe').expect(200);
    expect(ok.body.query).toBe('kaffe');
  });
});

describe('/api/health', () => {
  it('siger kun om serveren kører – ingen driftsdetaljer', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'time']);
  });
});

describe('/.well-known/security.txt', () => {
  const site = express();
  mountSite(site, '/findes-ikke');

  it('har kontakt, udløbsdato og canonical', async () => {
    const res = await request(site).get('/.well-known/security.txt').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('Contact: mailto:kontakt@tilbudsradar.test\n');
    expect(res.text).toContain(`Expires: ${SECURITY_TXT_EXPIRES}\n`);
    expect(res.text).toContain('Canonical: https://tilbudsradar.test/.well-known/security.txt\n');
    // RFC 9116: udløbsdatoen skal være en gyldig dato.
    expect(Number.isNaN(Date.parse(SECURITY_TXT_EXPIRES))).toBe(false);
  });
});

describe('Sentry: ingen persondata eller hemmeligheder', () => {
  it('fjerner headere, cookies, adgangskoder, tokens og e-mails – også i tekst og breadcrumbs', () => {
    const event = scrubSentryEvent({
      user: { id: 'u1', email: 'kunde@example.dk', ip_address: '1.2.3.4' },
      message: 'Login fejlede for kunde@example.dk',
      request: {
        url: 'https://tilbudsradaren.dk/app/nulstil-adgangskode?token=hemmeligt&x=1',
        headers: { Authorization: 'Bearer abc.def.ghi', Cookie: 'tr_refresh=xyz' },
        cookies: { tr_refresh: 'xyz' },
        data: { email: 'kunde@example.dk', password: 'hemmelig123' },
        query_string: 'session_id=cs_live_123&email=kunde@example.dk',
      },
      exception: { values: [{ value: 'Kunne ikke sende til kunde@example.dk med Bearer eyJhbGciOi.payload.sig' }] },
      breadcrumbs: [
        { message: 'POST /api/auth/login', data: { url: '/api/auth/login?email=kunde@example.dk', password: 'x', method: 'POST' } },
        { message: 'console', data: { arguments: ['refresh token', { accessToken: 'abc' }] } },
      ],
      extra: { email: 'kunde@example.dk', nested: { authorization: 'Bearer x', note: 'skrev til a@b.dk' } },
      contexts: { stripe: { apiKey: 'sk_live_x', customer: 'cus_1' } },
    });
    const json = JSON.stringify(event);
    for (const secret of ['kunde@example.dk', 'a@b.dk', 'hemmeligt', 'hemmelig123', 'abc.def.ghi', 'eyJhbGciOi', 'tr_refresh=xyz', 'sk_live_x', 'cs_live_123']) {
      expect(json, secret).not.toContain(secret);
    }
    expect(event.user).toBeUndefined();
    expect(event.request).not.toHaveProperty('headers');
    expect(event.request).not.toHaveProperty('cookies');
    expect(event.request).not.toHaveProperty('data');
    // Det, der ikke er følsomt, bevares til fejlsøgning.
    expect(event.request?.url).toBe('https://tilbudsradaren.dk/app/nulstil-adgangskode?token=[fjernet]&x=1');
    expect(event.breadcrumbs?.[0]?.data).toMatchObject({ method: 'POST' });
    expect(event.contexts).toMatchObject({ stripe: { customer: 'cus_1' } });
  });
});

describe('firmaoplysninger', () => {
  const base = { name: '[UDFYLD: firmanavn]', address: '[UDFYLD: adresse]', cvr: null, vatRegistered: false };

  it('advarer, når betaling er slået til, og navn eller adresse mangler', () => {
    const [problem] = companyProblems({ ...base, billingEnabled: true });
    expect(problem).toMatch(/COMPANY_NAME og COMPANY_ADDRESS mangler/);
    expect(companyProblems({ ...base, name: 'Kodo v/ Test', billingEnabled: true })[0]).toMatch(/COMPANY_ADDRESS mangler/);
    expect(companyProblems({ ...base, billingEnabled: false })).toEqual([]);
    expect(companyProblems({ name: 'Kodo', address: 'Testvej 1, 8000 Aarhus C', cvr: null, vatRegistered: false, billingEnabled: true })).toEqual([]);
  });

  it('advarer ved momsregistrering uden CVR', () => {
    expect(companyProblems({ name: 'Kodo', address: 'Testvej 1', cvr: null, vatRegistered: true, billingEnabled: true })[0]).toMatch(/COMPANY_CVR/);
  });
});
