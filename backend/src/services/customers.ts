import type {
  AdminCustomerAction,
  AdminCustomerDetail,
  AdminCustomerEvent,
  AdminCustomerFilter,
  AdminCustomerPage,
  AdminCustomerRow,
  AdminCustomerSort,
} from '@tilbudsradar/shared';
import { and, desc, eq, gt, ilike, isNotNull, isNull, sql } from 'drizzle-orm';
import { query, type Db } from '../db/client';
import { adminEvents, refreshTokens, users } from '../db/schema';
import { env } from '../env';
import { accessFor } from './auth';

type UserRow = typeof users.$inferSelect;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** % og _ er jokertegn i LIKE – en søgning på "a_b" skal finde præcis "a_b". */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Hvilken fane i kundelisten en konto hører til. */
function filterKey(u: UserRow, now: Date): Exclude<AdminCustomerFilter, 'all'> {
  const access = accessFor(u, now);
  if (access.isAdmin) return 'admin';
  return access.status === 'free' ? 'expired' : access.status;
}

/**
 * Kundelisten: alle konti med e-mail (gæster er anonyme og slettes selv efter 30 dage).
 * Adgangsstatus beregnes i koden – samme regler som resten af appen – så
 * filtrering og sortering sker i hukommelsen. Det er fint op til titusinder af kunder.
 */
export async function listCustomers(
  db: Db,
  opts: { q?: string; filter: AdminCustomerFilter; sort: AdminCustomerSort; page: number; pageSize: number },
  now = new Date(),
): Promise<AdminCustomerPage> {
  const q = opts.q?.trim().toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.isGuest, false), isNotNull(users.email), q ? ilike(users.email, `%${escapeLike(q)}%`) : undefined));

  const counts: AdminCustomerPage['counts'] = { all: rows.length };
  const keyed = rows.map((u) => {
    const key = filterKey(u, now);
    counts[key] = (counts[key] ?? 0) + 1;
    return { u, key };
  });

  const matching = keyed.filter((r) => opts.filter === 'all' || r.key === opts.filter).map((r) => r.u);
  const by: Record<AdminCustomerSort, (a: UserRow, b: UserRow) => number> = {
    created: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    lastSeen: (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
    email: (a, b) => a.email!.localeCompare(b.email!, 'da'),
  };
  matching.sort(by[opts.sort]);

  const start = (opts.page - 1) * opts.pageSize;
  const pageRows = matching.slice(start, start + opts.pageSize);
  const activity = await activityCounts(
    db,
    pageRows.map((u) => u.id),
  );

  const items: AdminCustomerRow[] = pageRows.map((u) => {
    const access = accessFor(u, now);
    const a = activity.get(u.id);
    return {
      id: u.id,
      email: u.email!,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: u.lastSeenAt.toISOString(),
      emailVerified: Boolean(u.emailVerifiedAt),
      status: access.status,
      isAdmin: access.isAdmin,
      lists: a?.lists ?? 0,
      watches: a?.watches ?? 0,
      trialEndsAt: iso(u.trialEndsAt),
      subscriptionStatus: u.subscriptionStatus,
    };
  });

  return { items, total: matching.length, page: opts.page, pageSize: opts.pageSize, counts };
}

async function activityCounts(db: Db, ids: string[]): Promise<Map<string, { lists: number; watches: number }>> {
  if (!ids.length) return new Map();
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await query<{ id: string; lists: number; watches: number }>(
    db,
    sql`SELECT u.id,
          (SELECT count(*)::int FROM shopping_lists l WHERE l.user_id = u.id) AS lists,
          (SELECT count(*)::int FROM watchlist w WHERE w.user_id = u.id) AS watches
        FROM users u WHERE u.id IN (${idList})`,
  );
  return new Map(rows.map((r) => [r.id, { lists: r.lists, watches: r.watches }]));
}

/** Kunden med e-mail – gæster og ukendte id'er giver null. */
export async function findCustomer(db: Db, id: string): Promise<UserRow | null> {
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.isGuest, false), isNotNull(users.email)))
    .limit(1);
  return u ?? null;
}

export function stripeCustomerUrl(customerId: string | null): string | null {
  if (!customerId) return null;
  const test = env.STRIPE_SECRET_KEY?.includes('_test_') ?? false;
  return `https://dashboard.stripe.com/${test ? 'test/' : ''}customers/${encodeURIComponent(customerId)}`;
}

export async function customerDetail(db: Db, u: UserRow, viewerId: string | null, now = new Date()): Promise<AdminCustomerDetail> {
  const [[counts], sessions, events] = await Promise.all([
    query<{ lists: number; list_items: number; watches: number; receipts: number }>(
      db,
      sql`SELECT
            (SELECT count(*)::int FROM shopping_lists WHERE user_id = ${u.id}) AS lists,
            (SELECT count(*)::int FROM shopping_list_items i JOIN shopping_lists l ON l.id = i.list_id WHERE l.user_id = ${u.id}) AS list_items,
            (SELECT count(*)::int FROM watchlist WHERE user_id = ${u.id}) AS watches,
            (SELECT count(*)::int FROM receipts WHERE user_id = ${u.id}) AS receipts`,
    ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, u.id), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, now))),
    db.select().from(adminEvents).where(eq(adminEvents.userId, u.id)).orderBy(desc(adminEvents.createdAt), desc(adminEvents.id)).limit(50),
  ]);

  return {
    id: u.id,
    email: u.email!,
    createdAt: u.createdAt.toISOString(),
    lastSeenAt: u.lastSeenAt.toISOString(),
    emailVerifiedAt: iso(u.emailVerifiedAt),
    termsAcceptedAt: iso(u.termsAcceptedAt),
    termsVersion: u.termsVersion,
    zipCode: u.zipCode,
    radiusKm: u.radiusKm,
    preferredStoreIds: u.preferredStoreIds ?? [],
    access: accessFor(u, now),
    isAdmin: u.role === 'admin',
    isSelf: viewerId === u.id,
    billing: {
      stripeCustomerId: u.stripeCustomerId,
      subscriptionId: u.subscriptionId,
      subscriptionStatus: u.subscriptionStatus,
      subscriptionStartedAt: iso(u.subscriptionStartedAt),
      currentPeriodEnd: iso(u.currentPeriodEnd),
      cancelAtPeriodEnd: u.cancelAtPeriodEnd,
      paymentFailedAt: iso(u.paymentFailedAt),
      stripeUrl: stripeCustomerUrl(u.stripeCustomerId),
    },
    counts: {
      lists: counts?.lists ?? 0,
      listItems: counts?.list_items ?? 0,
      watches: counts?.watches ?? 0,
      receipts: counts?.receipts ?? 0,
      activeSessions: sessions[0]?.n ?? 0,
    },
    events: events.map((e): AdminCustomerEvent => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      adminEmail: e.adminEmail,
      action: e.action as AdminCustomerAction,
      details: e.details,
    })),
  };
}

/** Skriver i kundens historik, hvem der gjorde hvad. */
export async function logAdminEvent(
  db: Db,
  userId: string,
  adminId: string | null,
  action: AdminCustomerAction,
  details: Record<string, unknown> = {},
): Promise<void> {
  let adminEmail: string | null = null;
  if (adminId) {
    const [admin] = await db.select({ email: users.email }).from(users).where(eq(users.id, adminId)).limit(1);
    adminEmail = admin?.email ?? null;
  }
  await db.insert(adminEvents).values({ userId, adminId: adminEmail ? adminId : null, adminEmail, action, details });
}
