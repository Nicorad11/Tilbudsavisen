import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { UserDTO } from '@tilbudsradar/shared';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Db } from '../db/client';
import { refreshTokens, users } from '../db/schema';
import { env } from '../env';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface AccessClaims {
  sub: string;
  role: 'user' | 'admin';
  guest: boolean;
}

export function signAccessToken(user: { id: string; role: string; isGuest: boolean }): string {
  const claims: AccessClaims = { sub: user.id, role: user.role === 'admin' ? 'admin' : 'user', guest: user.isGuest };
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: 'tilbudsradar',
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'tilbudsradar' });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, role: payload.role === 'admin' ? 'admin' : 'user', guest: Boolean(payload.guest) };
  } catch {
    return null;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Et netop roteret token må genbruges i kort tid (samtidige faner/requests). */
const REUSE_GRACE_MS = 60_000;

export async function issueRefreshToken(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokens).values({ userId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

/**
 * Roterer et refresh token. Genbrug af et allerede tilbagekaldt token tolkes
 * som tyveri, og alle brugerens sessioner lukkes.
 */
export async function rotateRefreshToken(
  db: Db,
  token: string,
): Promise<{ userId: string; token: string; expiresAt: Date } | null> {
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token))).limit(1);
  if (!row) return null;
  if (row.revokedAt) {
    // To faner der fornyer samtidig bruger samme cookie – det er ikke tyveri.
    if (Date.now() - row.revokedAt.getTime() < REUSE_GRACE_MS && row.expiresAt.getTime() > Date.now()) {
      const next = await issueRefreshToken(db, row.userId);
      return { userId: row.userId, ...next };
    }
    await revokeAllForUser(db, row.userId);
    return null;
  }
  if (row.expiresAt.getTime() < Date.now()) return null;
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
  const next = await issueRefreshToken(db, row.userId);
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, row.userId));
  return { userId: row.userId, ...next };
}

/**
 * Logout og tvungen lukning sletter tokens helt. Kun rotation markerer et token
 * som tilbagekaldt – så henstanden for samtidige faner ikke kan genoplive en
 * session der bevidst er lukket.
 */
export async function revokeRefreshToken(db: Db, token: string): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token)));
}

export async function revokeAllForUser(db: Db, userId: string): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
}

export function roleForEmail(email: string | null): 'user' | 'admin' {
  return email && env.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
}

export function toUserDTO(u: typeof users.$inferSelect): UserDTO {
  return {
    id: u.id,
    email: u.email,
    isGuest: u.isGuest,
    role: u.role === 'admin' ? 'admin' : 'user',
    preferredStoreIds: u.preferredStoreIds ?? [],
    dietPreferences: u.dietPreferences ?? [],
    allergies: u.allergies ?? [],
    zipCode: u.zipCode,
    radiusKm: u.radiusKm,
    createdAt: u.createdAt.toISOString(),
  };
}

/** GDPR-dataminimering: ryd udløbne tokens og gæster uden aktivitet i 30 dage. */
export async function cleanupAuth(db: Db): Promise<{ guests: number }> {
  await db
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, new Date()), lt(refreshTokens.revokedAt, sql`now() - interval '7 days'`)));
  const deleted = await db
    .delete(users)
    .where(and(eq(users.isGuest, true), lt(users.lastSeenAt, sql`now() - interval '30 days'`)))
    .returning({ id: users.id });
  return { guests: deleted.length };
}
