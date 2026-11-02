import type { AuthResponse } from '@tilbudsradar/shared';
import { desc, eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Rigtig administrator via ADMIN_EMAILS – skal sættes før env indlæses.
process.env.ADMIN_EMAILS = 'chef@tilbudsradar.test';

const { createDatabase } = await import('../src/db/client');
const { adminAuditLog, refreshTokens } = await import('../src/db/schema');
const { createApp } = await import('../src/http/app');
const { signAccessToken } = await import('../src/services/auth');
const { ScrapeManager } = await import('../src/services/scrapeJobs');
const { silentLogger } = await import('@tilbudsradar/scrapers');

let database: Awaited<ReturnType<typeof createDatabase>>;
let app: ReturnType<typeof createApp>;

interface Session {
  id: string;
  token: string;
  auth: { Authorization: string };
}

async function register(email: string): Promise<Session> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hemmelig123', acceptTerms: true }).expect(201);
  const body = res.body as AuthResponse;
  return { id: body.user.id, token: body.accessToken, auth: { Authorization: `Bearer ${body.accessToken}` } };
}

let admin: Session;
let kunde: Session;

/** Revisionsrækken skrives, når svaret er sendt – vent kort på den. */
async function auditRows(action: string) {
  for (let i = 0; i < 50; i++) {
    const rows = await database.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, action)).orderBy(desc(adminAuditLog.id));
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return [];
}

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape, stripe: null });
  admin = await register('chef@tilbudsradar.test');
  kunde = await register('kunde@example.dk');
});

afterAll(async () => {
  await database.close();
});

/** Alle admin-endpoints (admin.ts og adminCustomers.ts). */
const ADMIN_ENDPOINTS: [string, string][] = [
  ['get', '/api/admin/status'],
  ['get', '/api/admin/overview'],
  ['get', '/api/admin/users'],
  ['get', '/api/admin/users/00000000-0000-4000-8000-000000000000'],
  ['patch', '/api/admin/users/00000000-0000-4000-8000-000000000000'],
  ['post', '/api/admin/users/00000000-0000-4000-8000-000000000000/change-email'],
  ['post', '/api/admin/users/00000000-0000-4000-8000-000000000000/resend-verification'],
  ['post', '/api/admin/users/00000000-0000-4000-8000-000000000000/password-reset'],
  ['post', '/api/admin/users/00000000-0000-4000-8000-000000000000/logout'],
  ['delete', '/api/admin/users/00000000-0000-4000-8000-000000000000'],
  ['patch', '/api/admin/stores/rema1000'],
  ['patch', '/api/admin/sources/rema1000'],
  ['post', '/api/admin/scrape'],
  ['post', '/api/admin/stores/sync'],
  ['post', '/api/admin/aliases'],
  ['get', '/api/admin/sources/rema1000/raw'],
  ['get', '/api/admin/findes-ikke'],
];

const call = (method: string, url: string) => (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url);

describe('admin: rolle-tjek på serveren', () => {
  it('uden login: 401 på alle admin-endpoints – uden detaljer', async () => {
    for (const [method, url] of ADMIN_ENDPOINTS) {
      const res = await call(method, url).send({});
      expect(res.status, `${method} ${url}`).toBe(401);
      expect(res.body).toEqual({ error: 'Ikke logget ind' });
    }
  });

  it('almindelig bruger: 403 på alle admin-endpoints – uden detaljer', async () => {
    for (const [method, url] of ADMIN_ENDPOINTS) {
      const res = await call(method, url).set(kunde.auth).send({});
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body).toEqual({ error: 'Ingen adgang' });
    }
  });

  it('en admin-rolle i tokenet er ikke nok – brugeren skal stå i ADMIN_EMAILS', async () => {
    // Et gyldigt token med admin-rolle til en almindelig bruger (fx en fjernet administrator).
    const forged = signAccessToken({ id: kunde.id, role: 'admin', isGuest: false });
    await request(app).get('/api/admin/users').set({ Authorization: `Bearer ${forged}` }).expect(403);
    await request(app).get('/api/admin/users').set(admin.auth).expect(200);
  });
});

describe('admin: kortere sessioner', () => {
  it('adgangstoken: 5 min for administratorer, 15 min for brugere', () => {
    const lifetime = (token: string) => {
      const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
      return exp - iat;
    };
    expect(lifetime(admin.token)).toBe(5 * 60);
    expect(lifetime(kunde.token)).toBe(15 * 60);
  });

  it('session (refresh-token): 12 timer for administratorer, 30 dage for brugere', async () => {
    const expiry = async (userId: string) => {
      const [row] = await database.db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId)).limit(1);
      return (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 3_600_000;
    };
    expect(await expiry(admin.id)).toBeCloseTo(12, 1);
    expect(await expiry(kunde.id)).toBeCloseTo(30 * 24, 0);
  });
});

describe('admin: revisionslog', () => {
  it('logger hvem, hvad, hvornår og hvilken kunde – også opslag på en kunde', async () => {
    const before = Date.now();
    await request(app).get(`/api/admin/users/${kunde.id}`).set(admin.auth).expect(200);
    const [view] = await auditRows('GET /users/:id');
    expect(view).toMatchObject({ adminId: admin.id, adminEmail: 'chef@tilbudsradar.test', customerId: kunde.id, status: 200 });
    expect(view!.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const trialEndsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await request(app).patch(`/api/admin/users/${kunde.id}`).set(admin.auth).send({ trialEndsAt }).expect(200);
    const [patch] = await auditRows('PATCH /users/:id');
    expect(patch).toMatchObject({ customerId: kunde.id, status: 200, details: { trialEndsAt } });
  });

  it('gemmer ikke e-mailadresser i detaljerne', async () => {
    await request(app).post(`/api/admin/users/${kunde.id}/change-email`).set(admin.auth).send({ email: 'ny-kunde@example.dk' }).expect(200);
    const [row] = await auditRows('POST /users/:id/change-email');
    expect(row!.details).toEqual({ email: '[e-mail]' });
    expect(JSON.stringify(row)).not.toContain('ny-kunde@example.dk');
  });

  it('logger handlinger uden kunde (kæder, kilder) og afviste forsøg med status', async () => {
    await request(app).patch('/api/admin/stores/rema1000').set(admin.auth).send({ enabled: false }).expect(200);
    await request(app).patch('/api/admin/stores/rema1000').set(admin.auth).send({ enabled: true }).expect(200);
    const rows = await auditRows('PATCH /stores/:id');
    expect(rows[0]).toMatchObject({ targetId: 'rema1000', customerId: null, status: 200, details: { enabled: true } });
    await request(app).patch('/api/admin/stores/findes-ikke').set(admin.auth).send({ enabled: true }).expect(404);
    expect((await auditRows('PATCH /stores/:id'))[0]).toMatchObject({ targetId: 'findes-ikke', status: 404 });
  });

  it('kundelisten og overblikket logges ikke; sporet overlever, at kunden slettes', async () => {
    await request(app).get('/api/admin/users').set(admin.auth).expect(200);
    await request(app).get('/api/admin/overview').set(admin.auth).expect(200);
    const all = await database.db.select({ action: adminAuditLog.action }).from(adminAuditLog);
    expect(all.map((r) => r.action)).not.toContain('GET /users');
    expect(all.map((r) => r.action)).not.toContain('GET /overview');

    const slettes = await register('slettes@example.dk');
    await request(app).delete(`/api/admin/users/${slettes.id}`).set(admin.auth).expect(204);
    const [deleted] = await auditRows('DELETE /users/:id');
    expect(deleted).toMatchObject({ customerId: slettes.id, status: 204 });
  });
});
