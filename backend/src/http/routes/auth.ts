import type { AuthResponse } from '@tilbudsradar/shared';
import { TERMS_VERSION } from '@tilbudsradar/shared';
import { and, eq, ne } from 'drizzle-orm';
import { Router, type CookieOptions, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  adminEvents,
  communityReports,
  mealPlanRecipes,
  mealPlans,
  notifications,
  receipts,
  receiptScans,
  shoppingListItems,
  shoppingLists,
  users,
  watchlist,
  withdrawals,
} from '../../db/schema';
import { env } from '../../env';
import {
  hashPassword,
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  roleForEmail,
  rotateRefreshToken,
  signAccessToken,
  toUserDTO,
  verifyPassword,
} from '../../services/auth';
import { cancelForAccountDeletion } from '../../services/billing';
import {
  appLink,
  changeEmailMail,
  emailChangedMail,
  passwordChangedMail,
  resetPasswordMail,
  verifyEmailMail,
} from '../../services/emails';
import { sendMail, sendMailInBackground } from '../../services/mailer';
import { consumeEmailToken, createEmailToken, lastTokenSentAt } from '../../services/tokens';
import { claimTrial } from '../../services/trial';
import type { AppContext } from '../app';
import { REFRESH_COOKIE, requireAccount, requireAuth, userId } from '../auth';
import { HttpError, parse } from '../errors';

const cookieOptions = (expires: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/auth',
  expires,
});
const clearCookieOptions = (): CookieOptions => ({ path: '/api/auth', secure: env.isProd, sameSite: env.COOKIE_SAMESITE });

const email = z
  .email('Ugyldig e-mail')
  .max(254)
  .transform((v) => v.trim().toLowerCase());
const password = z.string().min(8, 'Adgangskoden skal være mindst 8 tegn').max(200);

const credentials = z.object({ email, password });
const registration = credentials.extend({
  acceptTerms: z.literal(true, { error: 'Du skal acceptere handelsbetingelserne' }),
  termsVersion: z.string().max(40).optional(),
});

const preferences = z.object({
  preferredStoreIds: z.array(z.string().max(50)).max(30).optional(),
  dietPreferences: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  allergies: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  zipCode: z
    .string()
    .regex(/^\d{4}$/, 'Postnummer skal være 4 cifre')
    .nullable()
    .optional(),
  radiusKm: z.number().int().min(1).max(200).nullable().optional(),
});

/** Højst én mail med link pr. bruger pr. 2 minutter (mod mailbomber). */
const RESEND_INTERVAL_MS = 2 * 60_000;

export function authRoutes({ db, stripe }: AppContext): Router {
  const r = Router();
  const limit = (perMinute: number, windowMs = 60_000) =>
    rateLimit({ windowMs, limit: env.isTest ? 1000 : perMinute, standardHeaders: 'draft-8', legacyHeaders: false });
  const limiter = limit(20);
  // Mails med links: få pr. IP, så de ikke kan bruges til spam.
  const mailLimiter = limit(5, 15 * 60_000);

  async function respond(res: Response, user: typeof users.$inferSelect, status = 200) {
    const refresh = await issueRefreshToken(db, user.id);
    res.cookie(REFRESH_COOKIE, refresh.token, cookieOptions(refresh.expiresAt));
    const body: AuthResponse = { accessToken: signAccessToken(user), user: toUserDTO(user) };
    res.status(status).json(body);
  }

  async function currentUser(req: Request) {
    const [user] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
    if (!user) throw new HttpError(404, 'Brugeren findes ikke');
    return user;
  }

  async function sendVerification(user: { id: string }, to: string, purpose: 'verify_email' | 'change_email') {
    const token = await createEmailToken(db, user.id, purpose, to);
    const link = appLink(`/app/bekraeft-email?token=${encodeURIComponent(token)}`);
    await sendMail(purpose === 'verify_email' ? verifyEmailMail(to, link) : changeEmailMail(to, link));
  }

  r.post('/guest', limiter, async (_req, res) => {
    const [user] = await db.insert(users).values({ isGuest: true }).returning();
    await respond(res, user!, 201);
  });

  r.post('/register', limiter, async (req, res) => {
    const body = parse(registration, req.body);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) throw new HttpError(409, 'Der findes allerede en konto med den e-mail');
    const now = new Date();
    const values = {
      email: body.email,
      passwordHash: await hashPassword(body.password),
      isGuest: false,
      role: roleForEmail(body.email),
      lastSeenAt: now,
      termsAcceptedAt: now,
      termsVersion: body.termsVersion ?? TERMS_VERSION,
      // Én prøveperiode pr. e-mail – også efter kontosletning.
      trialEndsAt: await claimTrial(db, body.email, now),
    };

    // En gæst der opretter konto beholder sine lister, kvitteringer og overvågninger.
    let user: typeof users.$inferSelect | undefined;
    if (req.auth?.guest) {
      [user] = await db.update(users).set(values).where(eq(users.id, req.auth.sub)).returning();
    }
    user ??= (await db.insert(users).values(values).returning())[0]!;
    await sendVerification(user, body.email, 'verify_email');
    await respond(res, user, 201);
  });

  r.post('/login', limiter, async (req, res) => {
    const { email: mail, password: pw } = parse(credentials, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, mail)).limit(1);
    if (!user || !(await verifyPassword(pw, user.passwordHash))) {
      throw new HttpError(401, 'Forkert e-mail eller adgangskode');
    }
    const role = roleForEmail(user.email);
    const [updated] = await db.update(users).set({ lastSeenAt: new Date(), role }).where(eq(users.id, user.id)).returning();
    await respond(res, updated!);
  });

  r.post('/refresh', limiter, async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    // Ingen cookie = besøgende uden konto. Ikke en fejl – så konsollen ikke fyldes med 401 på forsiden.
    if (!token) {
      res.status(204).end();
      return;
    }
    const rotated = await rotateRefreshToken(db, token);
    if (!rotated) {
      res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
      throw new HttpError(401, 'Sessionen er udløbet');
    }
    const [user] = await db.select().from(users).where(eq(users.id, rotated.userId)).limit(1);
    if (!user) throw new HttpError(401, 'Brugeren findes ikke længere');
    res.cookie(REFRESH_COOKIE, rotated.token, cookieOptions(rotated.expiresAt));
    const body: AuthResponse = { accessToken: signAccessToken(user), user: toUserDTO(user) };
    res.json(body);
  });

  r.post('/logout', async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) await revokeRefreshToken(db, token);
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    res.status(204).end();
  });

  /* ---------------- Glemt adgangskode ---------------- */

  /** Svarer altid ens og lige hurtigt, uanset om e-mailen findes (mailen sendes i baggrunden). */
  r.post('/forgot-password', mailLimiter, async (req, res) => {
    const { email: mail } = parse(z.object({ email }), req.body);
    const [user] = await db.select().from(users).where(eq(users.email, mail)).limit(1);
    if (user && !user.isGuest) {
      const last = await lastTokenSentAt(db, user.id, 'reset_password');
      if (!last || Date.now() - last.getTime() > RESEND_INTERVAL_MS) {
        const token = await createEmailToken(db, user.id, 'reset_password', mail);
        sendMailInBackground(resetPasswordMail(mail, appLink(`/app/nulstil-adgangskode?token=${encodeURIComponent(token)}`)));
      }
    }
    res.json({ ok: true, message: 'Hvis der findes en konto med den e-mail, har vi sendt et link til at nulstille adgangskoden.' });
  });

  r.post('/reset-password', limiter, async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
    const row = await consumeEmailToken(db, body.token, 'reset_password');
    if (!row) throw new HttpError(400, 'Linket er udløbet eller allerede brugt. Bed om et nyt.');
    const [user] = await db
      .update(users)
      .set({
        passwordHash: await hashPassword(body.password),
        // At kunne modtage linket beviser, at e-mailen er brugerens.
        emailVerifiedAt: new Date(),
        lastSeenAt: new Date(),
      })
      .where(and(eq(users.id, row.userId), eq(users.email, row.email)))
      .returning();
    if (!user) throw new HttpError(400, 'Linket er ikke længere gyldigt. Bed om et nyt.');
    // Ny adgangskode lukker alle andre sessioner; denne enhed logges ind på ny.
    await revokeAllForUser(db, user.id);
    sendMailInBackground(passwordChangedMail(user.email!));
    await respond(res, user);
  });

  /* ---------------- E-mailbekræftelse ---------------- */

  r.post('/verify-email', limiter, async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const row = (await consumeEmailToken(db, token, 'verify_email')) ?? (await consumeEmailToken(db, token, 'change_email'));
    if (!row) throw new HttpError(400, 'Linket er udløbet eller allerede brugt. Bed om et nyt under Konto.');

    if (row.purpose === 'change_email') {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, row.email), ne(users.id, row.userId)))
        .limit(1);
      if (taken) throw new HttpError(409, 'E-mailen bruges allerede af en anden konto');
      const [before] = await db.select({ email: users.email, customer: users.stripeCustomerId }).from(users).where(eq(users.id, row.userId));
      const [updated] = await db
        .update(users)
        .set({ email: row.email, emailVerifiedAt: new Date(), role: roleForEmail(row.email) })
        .where(eq(users.id, row.userId))
        .returning();
      if (!updated) throw new HttpError(404, 'Brugeren findes ikke');
      if (before?.email && before.email !== row.email) sendMailInBackground(emailChangedMail(before.email));
      // Kvitteringer fra Stripe skal gå til den nye adresse.
      if (before?.customer && stripe) await stripe.customers.update(before.customer, { email: row.email }).catch(() => undefined);
      res.json({ ok: true, user: toUserDTO(updated) });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, row.userId), eq(users.email, row.email)))
      .returning();
    if (!updated) throw new HttpError(400, 'E-mailen er ændret siden linket blev sendt. Bed om et nyt under Konto.');
    res.json({ ok: true, user: toUserDTO(updated) });
  });

  r.post('/verify-email/resend', requireAccount, mailLimiter, async (req, res) => {
    const user = await currentUser(req);
    if (user.emailVerifiedAt) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }
    const last = await lastTokenSentAt(db, user.id, 'verify_email');
    if (last && Date.now() - last.getTime() < RESEND_INTERVAL_MS) {
      throw new HttpError(429, 'Vi har lige sendt en mail. Vent et par minutter, og tjek også spam-mappen.');
    }
    await sendVerification(user, user.email!, 'verify_email');
    res.json({ ok: true });
  });

  /* ---------------- Skift adgangskode og e-mail ---------------- */

  r.post('/change-password', requireAccount, limiter, async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }), req.body);
    const user = await currentUser(req);
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'Den nuværende adgangskode er forkert');
    }
    const [updated] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword) })
      .where(eq(users.id, user.id))
      .returning();
    await revokeAllForUser(db, user.id);
    sendMailInBackground(passwordChangedMail(user.email!));
    await respond(res, updated!);
  });

  r.post('/change-email', requireAccount, mailLimiter, async (req, res) => {
    const body = parse(z.object({ newEmail: email, password: z.string().min(1).max(200) }), req.body);
    const user = await currentUser(req);
    if (!(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(400, 'Adgangskoden er forkert');
    if (body.newEmail === user.email) throw new HttpError(400, 'Det er allerede din e-mail');
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.newEmail)).limit(1);
    if (taken) throw new HttpError(409, 'E-mailen bruges allerede af en anden konto');
    await sendVerification(user, body.newEmail, 'change_email');
    res.json({ ok: true, message: `Vi har sendt et link til ${body.newEmail}. E-mailen skiftes, når du klikker på det.` });
  });

  /* ---------------- Profil ---------------- */

  r.get('/me', requireAuth, async (req, res) => {
    res.json(toUserDTO(await currentUser(req)));
  });

  r.patch('/me', requireAuth, async (req, res) => {
    const body = parse(preferences, req.body);
    const [user] = await db
      .update(users)
      .set({
        ...(body.preferredStoreIds !== undefined && { preferredStoreIds: body.preferredStoreIds }),
        ...(body.dietPreferences !== undefined && { dietPreferences: body.dietPreferences }),
        ...(body.allergies !== undefined && { allergies: body.allergies }),
        ...(body.zipCode !== undefined && { zipCode: body.zipCode }),
        ...(body.radiusKm !== undefined && { radiusKm: body.radiusKm }),
        lastSeenAt: new Date(),
      })
      .where(eq(users.id, userId(req)))
      .returning();
    if (!user) throw new HttpError(404, 'Brugeren findes ikke');
    res.json(toUserDTO(user));
  });

  /** GDPR: ret til indsigt – alle data om brugeren som JSON. */
  r.get('/me/export', requireAuth, async (req, res) => {
    const id = userId(req);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    const lists = await db.select().from(shoppingLists).where(eq(shoppingLists.userId, id));
    const items = lists.length
      ? (await Promise.all(lists.map((l) => db.select().from(shoppingListItems).where(eq(shoppingListItems.listId, l.id))))).flat()
      : [];
    const plans = await db.select().from(mealPlans).where(eq(mealPlans.userId, id));
    const recipes = (
      await Promise.all(plans.map((p) => db.select().from(mealPlanRecipes).where(eq(mealPlanRecipes.mealPlanId, p.id))))
    ).flat();
    res.setHeader('Content-Disposition', 'attachment; filename="tilbudsradar-data.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      user: user
        ? {
            ...toUserDTO(user),
            lastSeenAt: user.lastSeenAt,
            emailVerifiedAt: user.emailVerifiedAt,
            termsAcceptedAt: user.termsAcceptedAt,
            subscription: {
              trialEndsAt: user.trialEndsAt,
              stripeCustomerId: user.stripeCustomerId,
              subscriptionId: user.subscriptionId,
              status: user.subscriptionStatus,
              startedAt: user.subscriptionStartedAt,
              currentPeriodEnd: user.currentPeriodEnd,
              cancelAtPeriodEnd: user.cancelAtPeriodEnd,
              paymentFailedAt: user.paymentFailedAt,
            },
          }
        : null,
      shoppingLists: lists.map((l) => ({ ...l, items: items.filter((i) => i.listId === l.id) })),
      watchlist: await db.select().from(watchlist).where(eq(watchlist.userId, id)),
      notifications: await db.select().from(notifications).where(eq(notifications.userId, id)),
      communityReports: await db.select().from(communityReports).where(eq(communityReports.userId, id)),
      mealPlans: plans.map((p) => ({ ...p, recipes: recipes.filter((r) => r.mealPlanId === p.id) })),
      receipts: await db.select().from(receipts).where(eq(receipts.userId, id)),
      receiptScans: await db.select().from(receiptScans).where(eq(receiptScans.userId, id)),
      withdrawals: await db.select().from(withdrawals).where(eq(withdrawals.userId, id)),
      // Hvad support/administratorer har gjort ved kontoen – uden administratorens id.
      adminEvents: (await db.select().from(adminEvents).where(eq(adminEvents.userId, id))).map((e) => ({
        createdAt: e.createdAt,
        action: e.action,
        details: e.details,
      })),
    });
  });

  /**
   * GDPR: ret til sletning – alt knyttet til brugeren slettes via cascade.
   * Et løbende abonnement opsiges i Stripe først; fejler det, slettes intet.
   */
  r.delete('/me', requireAuth, async (req, res) => {
    const user = await currentUser(req);
    await cancelForAccountDeletion(stripe, user);
    await revokeAllForUser(db, user.id);
    await db.delete(users).where(eq(users.id, user.id));
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    res.status(204).end();
  });

  return r;
}
