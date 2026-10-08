import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { emailTokens } from '../db/schema';

export type TokenPurpose = 'verify_email' | 'reset_password' | 'change_email';

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify_email: 48 * 3_600_000,
  change_email: 48 * 3_600_000,
  reset_password: 3_600_000,
};

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Opretter et engangslink-token. Kun hashen gemmes, og tidligere ubrugte
 * tokens til samme formål annulleres, så kun det nyeste link virker.
 */
export async function createEmailToken(db: Db, userId: string, purpose: TokenPurpose, email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)));
  await db.insert(emailTokens).values({
    userId,
    purpose,
    email,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
  });
  return token;
}

/** Bruger et token atomisk: virker kun én gang og kun inden udløb. */
export async function consumeEmailToken(db: Db, token: string, purpose: TokenPurpose) {
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, sha256(token)),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}

/** Hvornår der sidst blev sendt et link – bruges til at undgå mailbomber. */
export async function lastTokenSentAt(db: Db, userId: string, purpose: TokenPurpose): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)))
    .orderBy(desc(emailTokens.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** Oprydning: brugte og udløbne tokens ældre end en dag. */
export async function cleanupEmailTokens(db: Db): Promise<void> {
  await db.delete(emailTokens).where(sql`${emailTokens.expiresAt} < now() - interval '1 day'`);
}
