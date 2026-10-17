import type { ScrapeStatusDTO } from '@tilbudsradar/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { pageViews, users } from '../src/db/schema';
import {
  adminOverview,
  deviceFromUserAgent,
  localDay,
  normalizePath,
  recordPageView,
  referrerHost,
  sourceLabel,
} from '../src/services/analytics';
import { BILLING_OPENED_KEY, openBillingIfNeeded } from '../src/services/launch';
import { testOutbox } from '../src/services/mailer';
import { getSetting } from '../src/services/settings';

const DAY = 86_400_000;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const noScrape: ScrapeStatusDTO = { running: false, current: null, queue: [], hosts: [], schedule: null, sources: [] };

let database: Database;

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
});
afterAll(() => database.close());

describe('statistik: hjælpere', () => {
  it('gemmer kun stien – uden tokens, id’er og API-kald', () => {
    expect(normalizePath('/app/nulstil-adgangskode?token=hemmelig')).toBe('/app/nulstil-adgangskode');
    expect(normalizePath('/app/kvitteringer/123')).toBe('/app/kvitteringer/:id');
    expect(normalizePath('/app/')).toBe('/app');
    expect(normalizePath('/api/auth/me')).toBeNull();
    expect(normalizePath('https://evil.example/')).toBeNull();
  });

  it('enhed, referrer og kilde', () => {
    expect(deviceFromUserAgent(IPHONE)).toBe('mobil');
    expect(deviceFromUserAgent(DESKTOP)).toBe('computer');
    expect(referrerHost('https://l.instagram.com/?u=x')).toBe('l.instagram.com');
    expect(referrerHost('https://tilbudsradar.test/priser')).toBeNull(); // eget domæne
    expect(referrerHost('ikke en url')).toBeNull();
    expect(sourceLabel('instagram', null)).toBe('Instagram');
    expect(sourceLabel(null, 'l.instagram.com')).toBe('Instagram');
    expect(sourceLabel(null, 'google.dk')).toBe('Google');
    expect(sourceLabel(null, null)).toBe('Direkte');
  });
});

describe('statistik: registrering og overblik', () => {
  const now = new Date();

  it('tæller besøgende pr. dag uden at gemme IP-adressen', async () => {
    const db = database.db;
    await recordPageView(db, { path: '/', utmSource: 'instagram', utmCampaign: 'Lancering' }, { ip: '10.0.0.1', userAgent: IPHONE }, now);
    await recordPageView(db, { path: '/priser' }, { ip: '10.0.0.1', userAgent: IPHONE }, now);
    await recordPageView(db, { path: '/', referrer: 'https://www.google.dk/' }, { ip: '10.0.0.2', userAgent: DESKTOP }, now);
    // Bots tælles ikke.
    expect(await recordPageView(db, { path: '/' }, { ip: '10.0.0.3', userAgent: 'Googlebot/2.1' }, now)).toBe(false);

    const rows = await db.select().from(pageViews);
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain('10.0.0.');
    expect(new Set(rows.map((r) => r.visitor)).size).toBe(2);
    expect(rows[0]).toMatchObject({ utmSource: 'instagram', utmCampaign: 'lancering', device: 'mobil' });
  });

  it('samme person får en ny hash næste dag (saltet skiftes)', async () => {
    const db = database.db;
    const tomorrow = new Date(now.getTime() + DAY);
    await recordPageView(db, { path: '/' }, { ip: '10.0.0.1', userAgent: IPHONE }, tomorrow);
    const rows = await db.select().from(pageViews);
    const todayHash = rows.find((r) => r.path === '/priser')!.visitor;
    expect(rows.at(-1)!.visitor).not.toBe(todayHash);
    await db.delete(pageViews).where(eq(pageViews.createdAt, tomorrow));
  });

  it('admin-overblik: brugere, tilmeldinger, besøg og kilder', async () => {
    const db = database.db;
    await db.insert(users).values([
      { email: 'ny@eksempel.dk', createdAt: now, lastSeenAt: now, trialEndsAt: new Date(now.getTime() + 14 * DAY) },
      { email: 'gammel@eksempel.dk', createdAt: new Date(now.getTime() - 40 * DAY), lastSeenAt: new Date(now.getTime() - 20 * DAY) },
      { isGuest: true },
    ]);

    const o = await adminOverview(db, noScrape, 7, now);
    expect(o.users).toMatchObject({ total: 2, newToday: 1, newInPeriod: 1, active1d: 1, active7d: 1, active30d: 2 });
    expect(o.byDay).toHaveLength(7);
    expect(o.byDay.at(-1)).toMatchObject({ day: localDay(now), signups: 1, visitors: 2, pageviews: 3 });
    expect(o.traffic).toMatchObject({ visitorsToday: 2, pageviewsToday: 3, visitsInPeriod: 2, pageviewsInPeriod: 3 });
    expect(o.traffic.topPages[0]).toMatchObject({ path: '/', pageviews: 2, visits: 2 });
    expect(o.traffic.sources).toEqual(expect.arrayContaining([{ label: 'Instagram', count: 1 }, { label: 'Google', count: 1 }]));
    expect(o.traffic.devices).toEqual(expect.arrayContaining([{ label: 'mobil', count: 1 }, { label: 'computer', count: 1 }]));
    expect(o.latestUsers.map((u) => u.email)).toEqual(['ny@eksempel.dk', 'gammel@eksempel.dk']);
  });
});

describe('lanceringsperioden slutter, når betaling åbner', () => {
  it('giver alle konti uden abonnement 14 dage fra i dag – én gang', async () => {
    const db = database.db;
    const now = new Date();
    const [expired] = await db
      .insert(users)
      .values({ email: 'udloebet@eksempel.dk', trialEndsAt: new Date(now.getTime() - 30 * DAY), trialEndedSentAt: now })
      .returning();
    const [subscriber] = await db
      .insert(users)
      .values({ email: 'abonnent@eksempel.dk', subscriptionId: 'sub_1', subscriptionStatus: 'active' })
      .returning();

    expect(await openBillingIfNeeded(db, false, now)).toBe(0); // stadig lanceringsperiode
    expect(await getSetting(db, BILLING_OPENED_KEY)).toBeNull();

    testOutbox.length = 0;
    expect(await openBillingIfNeeded(db, true, now)).toBeGreaterThanOrEqual(1);
    const [after] = await db.select().from(users).where(eq(users.id, expired!.id));
    expect(after!.trialEndsAt!.getTime()).toBe(now.getTime() + 14 * DAY);
    expect(after!.trialEndedSentAt).toBeNull();
    const [sub] = await db.select().from(users).where(eq(users.id, subscriber!.id));
    expect(sub!.trialEndsAt).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(testOutbox.map((m) => m.to)).toContain('udloebet@eksempel.dk');
    expect(testOutbox.map((m) => m.to)).not.toContain('abonnent@eksempel.dk');

    expect(await openBillingIfNeeded(db, true, new Date(now.getTime() + DAY))).toBe(0);
  });
});
