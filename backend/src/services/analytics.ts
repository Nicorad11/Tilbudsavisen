import { createHash, randomBytes } from 'node:crypto';
import type { AccessStatus, AdminCount, AdminDay, AdminOverviewDTO, AdminUserRow, PageViewRequest, ScrapeStatusDTO } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../db/client';
import { pageViews, users } from '../db/schema';
import { env } from '../env';
import { accessFor } from './auth';
import { getSetting, setSetting } from './settings';
import { getStats } from './stats';

/**
 * Cookiefri besøgsstatistik i vores egen database (ingen tredjepart).
 *
 * - Der sættes intet på enheden (ingen cookies eller localStorage).
 * - IP-adressen gemmes aldrig. Den hashes sammen med browserens User-Agent og et
 *   tilfældigt salt, der skiftes hver dag og overskrives – så en besøgende kan
 *   tælles som unik inden for én dag, men ikke genkendes dagen efter.
 * - Kun stien gemmes (uden forespørgsel), referrerens værtsnavn og UTM-parametre.
 */

const TZ = 'Europe/Copenhagen';
const SALT_KEY = 'analytics_salt';
/** Sidevisninger slettes efter 13 måneder (samme periode som årsrapporter typisk dækker). */
export const PAGE_VIEW_RETENTION_DAYS = 395;

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http/i;

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** YYYY-MM-DD i dansk tid. */
export const localDay = (d: Date) => dayFmt.format(d);

let saltCache: { day: string; salt: string } | null = null;

/** Dagens salt. Et nyt dagssalt overskriver gårsdagens, så gamle hashes ikke kan genskabes. */
async function dailySalt(db: Db, now: Date): Promise<string> {
  const day = localDay(now);
  if (saltCache?.day === day) return saltCache.salt;
  const stored = await getSetting(db, SALT_KEY);
  if (stored) {
    const parsed = JSON.parse(stored) as { day: string; salt: string };
    if (parsed.day === day) return (saltCache = parsed).salt;
  }
  saltCache = { day, salt: randomBytes(32).toString('hex') };
  await setSetting(db, SALT_KEY, JSON.stringify(saltCache));
  return saltCache.salt;
}

/** /app/kvitteringer/123 → /app/kvitteringer/:id – og aldrig forespørgsler (fx ?token=…). */
export function normalizePath(path: string): string | null {
  const clean = path.split(/[?#]/)[0]!.trim();
  if (!clean.startsWith('/') || clean.startsWith('/api')) return null;
  const segments = clean
    .split('/')
    .map((s) => (/^\d+$/.test(s) || /^[0-9a-f-]{20,}$/i.test(s) ? ':id' : s))
    .join('/');
  return (segments.replace(/\/+$/, '') || '/').slice(0, 200);
}

export function deviceFromUserAgent(ua: string): 'mobil' | 'tablet' | 'computer' {
  if (/ipad|tablet|kindle|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobil';
  return 'computer';
}

/** Kun værtsnavnet – og ikke vores eget domæne (intern navigation). */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
    const own = new URL(env.APP_URL).hostname.replace(/^www\./, '');
    if (!host || host === own || host.endsWith('.onrender.com') || host === 'localhost') return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

const short = (v: string | null | undefined, max = 80) => (v ? v.trim().toLowerCase().slice(0, max) || null : null);

export async function recordPageView(
  db: Db,
  input: PageViewRequest,
  client: { ip: string; userAgent: string },
  now = new Date(),
): Promise<boolean> {
  if (!client.userAgent || BOT.test(client.userAgent)) return false;
  const path = normalizePath(input.path);
  if (!path) return false;
  const salt = await dailySalt(db, now);
  const visitor = createHash('sha256').update(`${salt}|${client.ip}|${client.userAgent}`).digest('hex').slice(0, 16);
  await db.insert(pageViews).values({
    createdAt: now,
    path,
    referrer: referrerHost(input.referrer),
    utmSource: short(input.utmSource),
    utmMedium: short(input.utmMedium),
    utmCampaign: short(input.utmCampaign, 120),
    device: deviceFromUserAgent(client.userAgent),
    visitor,
    member: Boolean(input.member),
  });
  return true;
}

export async function cleanupPageViews(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM page_views WHERE created_at < now() - make_interval(days => ${PAGE_VIEW_RETENTION_DAYS})`);
}

/** Pæne navne til trafikkilder: UTM-kilden vinder, ellers referrerens domæne. */
export function sourceLabel(utmSource: string | null, referrer: string | null): string {
  const raw = (utmSource || referrer || '').toLowerCase();
  if (!raw) return 'Direkte';
  const known: [RegExp, string][] = [
    [/instagram|^ig$/, 'Instagram'],
    [/facebook|^fb$|fb\.com/, 'Facebook'],
    [/tiktok/, 'TikTok'],
    [/google/, 'Google'],
    [/bing/, 'Bing'],
    [/duckduckgo/, 'DuckDuckGo'],
    [/linkedin|lnkd/, 'LinkedIn'],
    [/reddit/, 'Reddit'],
    [/t\.co$|twitter|^x\.com$/, 'X'],
    [/mail|newsletter/, 'E-mail'],
  ];
  return known.find(([re]) => re.test(raw))?.[1] ?? raw;
}

const STATUS_LABEL: Record<AccessStatus, string> = {
  launch: 'Gratis (lancering)',
  trial: 'Prøveperiode',
  active: 'Abonnement',
  past_due: 'Betaling fejlet',
  canceled: 'Opsagt',
  expired: 'Udløbet',
  free: 'Gæst',
};

/** Overblik til administratoren: brugere, besøg og driftsstatus de sidste `days` dage. */
export async function adminOverview(db: Db, scrape: ScrapeStatusDTO, days: number, now = new Date()): Promise<AdminOverviewDTO> {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000);
  const sinceDay = localDay(since);
  const today = localDay(now);
  const dayExpr = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`);

  const accounts = await db
    .select()
    .from(users)
    .where(sql`NOT ${users.isGuest} AND ${users.email} IS NOT NULL`);
  const ago = (d: number) => now.getTime() - d * 86_400_000;
  const statusCounts = new Map<string, number>();
  for (const u of accounts) {
    const access = accessFor(u, now);
    const label = access.isAdmin ? 'Administrator' : STATUS_LABEL[access.status];
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
  }

  const [signups, traffic, todayTraffic, pages, sources, devices, latest, stats] = await Promise.all([
    query<{ day: string; n: number }>(
      db,
      sql`SELECT ${dayExpr('created_at')} AS day, count(*)::int AS n FROM users
          WHERE NOT is_guest AND email IS NOT NULL AND ${dayExpr('created_at')} >= ${sinceDay}
          GROUP BY 1`,
    ),
    query<{ day: string; pageviews: number; visitors: number }>(
      db,
      sql`SELECT ${dayExpr('created_at')} AS day, count(*)::int AS pageviews, count(DISTINCT visitor)::int AS visitors
          FROM page_views WHERE created_at >= ${since.toISOString()}::timestamptz - interval '1 day'
          GROUP BY 1`,
    ),
    query<{ pageviews: number; visitors: number }>(
      db,
      sql`SELECT count(*)::int AS pageviews, count(DISTINCT visitor)::int AS visitors
          FROM page_views WHERE ${dayExpr('created_at')} = ${today}`,
    ),
    query<{ path: string; pageviews: number; visits: number }>(
      db,
      sql`SELECT path, count(*)::int AS pageviews, count(DISTINCT (${dayExpr('created_at')}, visitor))::int AS visits
          FROM page_views WHERE ${dayExpr('created_at')} >= ${sinceDay}
          GROUP BY path ORDER BY pageviews DESC LIMIT 15`,
    ),
    // Første sidevisning pr. besøg (dag + besøgende) afgør, hvor besøget kom fra.
    query<{ utm_source: string | null; referrer: string | null; visits: number }>(
      db,
      sql`SELECT utm_source, referrer, count(*)::int AS visits FROM (
            SELECT DISTINCT ON (${dayExpr('created_at')}, visitor) utm_source, referrer
            FROM page_views WHERE ${dayExpr('created_at')} >= ${sinceDay}
            ORDER BY ${dayExpr('created_at')}, visitor, created_at
          ) first_views GROUP BY 1, 2`,
    ),
    query<{ device: string; visits: number }>(
      db,
      sql`SELECT device, count(DISTINCT (${dayExpr('created_at')}, visitor))::int AS visits
          FROM page_views WHERE ${dayExpr('created_at')} >= ${sinceDay} GROUP BY device ORDER BY visits DESC`,
    ),
    query<{
      id: string;
      email: string;
      created_at: Date;
      last_seen_at: Date;
      email_verified_at: Date | null;
      lists: number;
      watches: number;
    }>(
      db,
      sql`SELECT u.id, u.email, u.created_at, u.last_seen_at, u.email_verified_at,
            (SELECT count(*)::int FROM shopping_lists l WHERE l.user_id = u.id) AS lists,
            (SELECT count(*)::int FROM watchlist w WHERE w.user_id = u.id) AS watches
          FROM users u WHERE NOT u.is_guest AND u.email IS NOT NULL
          ORDER BY u.created_at DESC LIMIT 50`,
    ),
    getStats(db),
  ]);

  const byId = new Map(accounts.map((u) => [u.id, u]));
  const latestUsers: AdminUserRow[] = latest.map((r) => {
    const access = accessFor(byId.get(r.id) ?? null, now);
    return {
      id: r.id,
      email: r.email,
      createdAt: new Date(r.created_at).toISOString(),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
      emailVerified: Boolean(r.email_verified_at),
      status: access.status,
      isAdmin: access.isAdmin,
      lists: r.lists,
      watches: r.watches,
    };
  });

  const signupMap = new Map(signups.map((r) => [r.day, r.n]));
  const trafficMap = new Map(traffic.map((r) => [r.day, r]));
  const byDay: AdminDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = localDay(new Date(now.getTime() - i * 86_400_000));
    if (byDay.at(-1)?.day === day) continue; // sommertid kan give samme dag to gange
    byDay.push({
      day,
      signups: signupMap.get(day) ?? 0,
      visitors: trafficMap.get(day)?.visitors ?? 0,
      pageviews: trafficMap.get(day)?.pageviews ?? 0,
    });
  }

  const sourceCounts = new Map<string, number>();
  for (const s of sources) {
    const label = sourceLabel(s.utm_source, s.referrer);
    sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + s.visits);
  }
  const counts = (m: Map<string, number>): AdminCount[] =>
    [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  return {
    generatedAt: now.toISOString(),
    days,
    billingEnabled: env.billingEnabled,
    users: {
      total: accounts.length,
      verified: accounts.filter((u) => u.emailVerifiedAt).length,
      newToday: byDay.at(-1)?.signups ?? 0,
      newInPeriod: byDay.reduce((n, d) => n + d.signups, 0),
      active1d: accounts.filter((u) => u.lastSeenAt.getTime() > ago(1)).length,
      active7d: accounts.filter((u) => u.lastSeenAt.getTime() > ago(7)).length,
      active30d: accounts.filter((u) => u.lastSeenAt.getTime() > ago(30)).length,
      byStatus: counts(statusCounts),
    },
    traffic: {
      visitorsToday: todayTraffic[0]?.visitors ?? 0,
      pageviewsToday: todayTraffic[0]?.pageviews ?? 0,
      visitsInPeriod: byDay.reduce((n, d) => n + d.visitors, 0),
      pageviewsInPeriod: byDay.reduce((n, d) => n + d.pageviews, 0),
      topPages: pages,
      sources: counts(sourceCounts).slice(0, 10),
      devices: devices.map((d) => ({ label: d.device, count: d.visits })),
    },
    byDay,
    latestUsers,
    site: {
      totalOffers: stats.totalOffers,
      lastScrapeAt: stats.lastScrapeAt,
      sources: scrape.sources.map((s) => ({
        id: s.id,
        name: `${s.storeName}${s.kind === 'api' ? '' : ` (${s.kind})`}`,
        status: s.lastStatus,
        lastRunAt: s.lastRunAt,
        failures: s.consecutiveFailures,
        enabled: s.enabled && s.storeEnabled,
      })),
    },
  };
}
