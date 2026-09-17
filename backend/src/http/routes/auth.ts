import type { AuthResponse } from '@tilbudsradar/shared';
import { eq } from 'drizzle-orm';
import { Router, type CookieOptions, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  communityReports,
  mealPlanRecipes,
  mealPlans,
  notifications,
  shoppingListItems,
  shoppingLists,
  users,
  watchlist,
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
import type { AppContext } from '../app';
import { REFRESH_COOKIE, requireAuth, userId } from '../auth';
import { HttpError, parse } from '../errors';

const cookieOptions = (expires: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.isProd,
  // Frontend og API kan ligge på hver sit domæne i produktion (fx Vercel + Render).
  sameSite: env.isProd ? 'none' : 'lax',
  path: '/api/auth',
  expires,
});

const credentials = z.object({
  email: z.email('Ugyldig e-mail').transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, 'Adgangskoden skal være mindst 8 tegn').max(200),
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

export function authRoutes({ db }: AppContext): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: env.isTest ? 1000 : 20, standardHeaders: 'draft-8', legacyHeaders: false });

  async function respond(res: Response, user: typeof users.$inferSelect, status = 200) {
    const refresh = await issueRefreshToken(db, user.id);
    res.cookie(REFRESH_COOKIE, refresh.token, cookieOptions(refresh.expiresAt));
    const body: AuthResponse = { accessToken: signAccessToken(user), user: toUserDTO(user) };
    res.status(status).json(body);
  }

  r.post('/guest', limiter, async (_req, res) => {
    const [user] = await db.insert(users).values({ isGuest: true }).returning();
    await respond(res, user!, 201);
  });

  r.post('/register', limiter, async (req, res) => {
    const { email, password } = parse(credentials, req.body);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new HttpError(409, 'Der findes allerede en konto med den e-mail');
    const passwordHash = await hashPassword(password);
    const role = roleForEmail(email);

    // En gæst der opretter konto beholder sine lister, madplaner og overvågninger.
    if (req.auth?.guest) {
      const [upgraded] = await db
        .update(users)
        .set({ email, passwordHash, isGuest: false, role, lastSeenAt: new Date() })
        .where(eq(users.id, req.auth.sub))
        .returning();
      if (upgraded) return respond(res, upgraded, 201);
    }
    const [user] = await db.insert(users).values({ email, passwordHash, role }).returning();
    await respond(res, user!, 201);
  });

  r.post('/login', limiter, async (req, res) => {
    const { email, password } = parse(credentials, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, 'Forkert e-mail eller adgangskode');
    }
    const role = roleForEmail(user.email);
    const [updated] = await db.update(users).set({ lastSeenAt: new Date(), role }).where(eq(users.id, user.id)).returning();
    await respond(res, updated!);
  });

  r.post('/refresh', limiter, async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const rotated = token ? await rotateRefreshToken(db, token) : null;
    if (!rotated) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
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
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).end();
  });

  r.get('/me', requireAuth, async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
    if (!user) throw new HttpError(404, 'Brugeren findes ikke');
    res.json(toUserDTO(user));
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
      user: user ? { ...toUserDTO(user), lastSeenAt: user.lastSeenAt } : null,
      shoppingLists: lists.map((l) => ({ ...l, items: items.filter((i) => i.listId === l.id) })),
      watchlist: await db.select().from(watchlist).where(eq(watchlist.userId, id)),
      notifications: await db.select().from(notifications).where(eq(notifications.userId, id)),
      communityReports: await db.select().from(communityReports).where(eq(communityReports.userId, id)),
      mealPlans: plans.map((p) => ({ ...p, recipes: recipes.filter((r) => r.mealPlanId === p.id) })),
    });
  });

  /** GDPR: ret til sletning – alt knyttet til brugeren slettes via cascade. */
  r.delete('/me', requireAuth, async (req, res) => {
    const id = userId(req);
    await revokeAllForUser(db, id);
    await db.delete(users).where(eq(users.id, id));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).end();
  });

  return r;
}

