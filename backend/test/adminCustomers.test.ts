import type { AdminCustomerDetail, AdminCustomerPage, AuthResponse } from '@tilbudsradar/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Rigtig administrator via ADMIN_EMAILS (ikke den åbne udviklingstilstand) – skal sættes før env indlæses.
process.env.ADMIN_EMAILS = 'chef@tilbudsradar.test';

const { createDatabase } = await import('../src/db/client');
const { createApp } = await import('../src/http/app');
const { ScrapeManager } = await import('../src/services/scrapeJobs');
const { testOutbox } = await import('../src/services/mailer');
const { silentLogger } = await import('@tilbudsradar/scrapers');

let database: Awaited<ReturnType<typeof createDatabase>>;
let app: ReturnType<typeof createApp>;
let admin: { Authorization: string };

async function register(email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hemmelig123', acceptTerms: true }).expect(201);
  const body = res.body as AuthResponse;
  return { id: body.user.id, auth: { Authorization: `Bearer ${body.accessToken}` }, cookie: res.headers['set-cookie'] };
}

const tokenFrom = (text: string) => decodeURIComponent(/token=([^\s&]+)/.exec(text)![1]!);

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  app = createApp({ db: database.db, scrape, stripe: null });
  admin = (await register('chef@tilbudsradar.test')).auth;
});

afterAll(async () => {
  await database.close();
});

describe('admin: kunder', () => {
  it('kun administratorer kan se kunder', async () => {
    const kunde = await register('kunde1@example.dk');
    await request(app).get('/api/admin/users').expect(403);
    await request(app).get('/api/admin/users').set(kunde.auth).expect(403);
    await request(app).get(`/api/admin/users/${kunde.id}`).set(kunde.auth).expect(403);
    await request(app).get('/api/admin/users').set(admin).expect(200);
  });

  it('søg, filtrér og sidedel', async () => {
    await register('anna@example.dk');
    await register('bo_x@example.dk');
    await request(app).post('/api/auth/guest').expect(201); // gæster er ikke kunder

    const all = (await request(app).get('/api/admin/users').set(admin).expect(200)).body as AdminCustomerPage;
    expect(all.items.map((u) => u.email)).not.toContain(null);
    expect(all.total).toBe(all.counts.all);
    expect(all.counts.admin).toBe(1);
    expect(all.items[0]!.email).toBe('bo_x@example.dk'); // nyeste først

    const search = (await request(app).get('/api/admin/users?q=ANNA').set(admin).expect(200)).body as AdminCustomerPage;
    expect(search.items.map((u) => u.email)).toEqual(['anna@example.dk']);
    // "_" er et jokertegn i LIKE – søgningen skal tage det bogstaveligt.
    const literal = (await request(app).get('/api/admin/users?q=o_x').set(admin).expect(200)).body as AdminCustomerPage;
    expect(literal.items.map((u) => u.email)).toEqual(['bo_x@example.dk']);

    const admins = (await request(app).get('/api/admin/users?filter=admin').set(admin).expect(200)).body as AdminCustomerPage;
    expect(admins.items.map((u) => u.email)).toEqual(['chef@tilbudsradar.test']);

    const page2 = (await request(app).get('/api/admin/users?pageSize=10&page=2&sort=email').set(admin).expect(200))
      .body as AdminCustomerPage;
    expect(page2.items).toEqual([]);
    expect(page2.total).toBe(all.total);
  });

  it('ukendte id’er og gæster giver 404', async () => {
    await request(app).get('/api/admin/users/ikke-et-id').set(admin).expect(404);
    await request(app).get('/api/admin/users/00000000-0000-4000-8000-000000000000').set(admin).expect(404);
    const guest = (await request(app).post('/api/auth/guest').expect(201)).body as AuthResponse;
    await request(app).get(`/api/admin/users/${guest.user.id}`).set(admin).expect(404);
  });

  it('forlæng prøveperioden og markér e-mail som bekræftet – med historik', async () => {
    const kunde = await register('trial@example.dk');
    const end = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const detail = (
      await request(app).patch(`/api/admin/users/${kunde.id}`).set(admin).send({ trialEndsAt: end, emailVerified: true }).expect(200)
    ).body as AdminCustomerDetail;
    expect(detail.access.trialEndsAt).toBe(end);
    expect(detail.emailVerifiedAt).not.toBeNull();
    expect(detail.events.map((e) => e.action).sort()).toEqual(['email_verified', 'trial_changed']);
    expect(detail.events[0]!.adminEmail).toBe('chef@tilbudsradar.test');

    const tooFar = new Date(Date.now() + 4 * 365 * 86_400_000).toISOString();
    await request(app).patch(`/api/admin/users/${kunde.id}`).set(admin).send({ trialEndsAt: tooFar }).expect(400);
    await request(app).patch(`/api/admin/users/${kunde.id}`).set(admin).send({}).expect(400);
    // Abonnementsfelter kan ikke sættes herfra – Stripe er kilden.
    await request(app).patch(`/api/admin/users/${kunde.id}`).set(admin).send({ subscriptionStatus: 'active' }).expect(400);
  });

  it('skift e-mail sker først når kunden klikker på linket', async () => {
    const kunde = await register('gammel@example.dk');
    await register('optaget@example.dk');
    await request(app).post(`/api/admin/users/${kunde.id}/change-email`).set(admin).send({ email: 'optaget@example.dk' }).expect(409);

    testOutbox.length = 0;
    const res = await request(app)
      .post(`/api/admin/users/${kunde.id}/change-email`)
      .set(admin)
      .send({ email: 'Ny@Example.dk' })
      .expect(200);
    expect(res.body).toMatchObject({ ok: true, mailSent: true });
    expect(testOutbox.map((m) => m.to)).toEqual(['ny@example.dk']);

    const before = (await request(app).get(`/api/admin/users/${kunde.id}`).set(admin).expect(200)).body as AdminCustomerDetail;
    expect(before.email).toBe('gammel@example.dk');

    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: tokenFrom(testOutbox[0]!.text) })
      .expect(200);
    const after = (await request(app).get(`/api/admin/users/${kunde.id}`).set(admin).expect(200)).body as AdminCustomerDetail;
    expect(after.email).toBe('ny@example.dk');
    expect(after.events.some((e) => e.action === 'email_change_sent')).toBe(true);
  });

  it('send link til ny adgangskode – kunden vælger selv adgangskoden', async () => {
    const kunde = await register('glemsom@example.dk');
    testOutbox.length = 0;
    await request(app).post(`/api/admin/users/${kunde.id}/password-reset`).set(admin).expect(200);
    const token = tokenFrom(testOutbox[0]!.text);
    await request(app).post('/api/auth/reset-password').send({ token, password: 'nyhemmelig123' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'glemsom@example.dk', password: 'nyhemmelig123' }).expect(200);
  });

  it('log ud på alle enheder', async () => {
    const kunde = await register('ud@example.dk');
    const before = (await request(app).get(`/api/admin/users/${kunde.id}`).set(admin).expect(200)).body as AdminCustomerDetail;
    expect(before.counts.activeSessions).toBe(1);
    const after = (await request(app).post(`/api/admin/users/${kunde.id}/logout`).set(admin).expect(200)).body as AdminCustomerDetail;
    expect(after.counts.activeSessions).toBe(0);
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', kunde.cookie as unknown as string[])
      .expect(401);
  });

  it('slet konto – men ikke sin egen eller en administrators', async () => {
    const kunde = await register('slet@example.dk');
    await request(app).patch(`/api/admin/users/${kunde.id}`).set(admin).send({ emailVerified: true }).expect(200);
    await request(app).delete(`/api/admin/users/${kunde.id}`).set(admin).expect(204);
    await request(app).get(`/api/admin/users/${kunde.id}`).set(admin).expect(404);

    const self = (await request(app).get('/api/admin/users?filter=admin').set(admin).expect(200)).body as AdminCustomerPage;
    await request(app).delete(`/api/admin/users/${self.items[0]!.id}`).set(admin).expect(400);
  });
});
