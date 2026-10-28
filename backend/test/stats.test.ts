import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TOKEN = 'test-stats-token-0123456789abcdef0123456789';
process.env.STATS_TOKEN = TOKEN;
process.env.ADMIN_EMAILS = 'chef@tilbudsradar.test';

const { createDatabase } = await import('../src/db/client');
const { createApp } = await import('../src/http/app');
const { ScrapeManager } = await import('../src/services/scrapeJobs');
const { users } = await import('../src/db/schema');
const { silentLogger } = await import('@tilbudsradar/scrapers');
const { eq } = await import('drizzle-orm');

let database: Awaited<ReturnType<typeof createDatabase>>;
let app: ReturnType<typeof createApp>;

async function register(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hemmelig123', acceptTerms: true }).expect(201);
  return res.body.user.id as string;
}

const future = () => new Date(Date.now() + 20 * 86_400_000);

async function subscribe(id: string, status: string) {
  await database.db
    .update(users)
    .set({ subscriptionId: `sub_${id}`, subscriptionStatus: status, currentPeriodEnd: future(), subscriptionStartedAt: new Date() })
    .where(eq(users.id, id));
}

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  app = createApp({ db: database.db, scrape: new ScrapeManager(database.db, silentLogger), stripe: null });
});

afterAll(async () => {
  await database.close();
});

describe('stats: betalende kunder', () => {
  it('kræver den rigtige nøgle', async () => {
    await request(app).get('/api/stats/paying').expect(401);
    await request(app).get('/api/stats/paying').set('X-Stats-Token', 'forkert').expect(401);
    await request(app).get('/api/stats/paying').set('X-Stats-Token', TOKEN).expect(200);
  });

  it('tæller kun løbende, betalte abonnementer', async () => {
    const admin = await register('chef@tilbudsradar.test');
    await subscribe(admin, 'active'); // administratorer tæller ikke
    await subscribe(await register('a@example.dk'), 'active');
    await subscribe(await register('b@example.dk'), 'active');
    await subscribe(await register('c@example.dk'), 'trialing'); // ikke betalt endnu
    await subscribe(await register('d@example.dk'), 'incomplete');
    await register('e@example.dk'); // ingen abonnement
    await request(app).post('/api/auth/guest').expect(201);

    const res = await request(app).get('/api/stats/paying').set('X-Stats-Token', TOKEN).expect(200);
    expect(res.body.paying).toBe(2);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
