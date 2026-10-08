import type { BillingStatusDTO, UrlResponse, WithdrawalResponse } from '@tilbudsradar/shared';
import { PLAN, TERMS_VERSION } from '@tilbudsradar/shared';
import { eq } from 'drizzle-orm';
import express, { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import Stripe from 'stripe';
import { z } from 'zod';
import { users } from '../../db/schema';
import { env, log } from '../../env';
import { accessFor } from '../../services/auth';
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeEvent,
  receiptScansThisMonth,
  withdrawSubscription,
} from '../../services/billing';
import type { AppContext } from '../app';
import { requireAccount, userId } from '../auth';
import { HttpError, parse } from '../errors';

export function billingRoutes({ db, stripe }: AppContext): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: env.isTest ? 1000 : 10, standardHeaders: 'draft-8', legacyHeaders: false });

  async function loadUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new HttpError(404, 'Brugeren findes ikke');
    return user;
  }

  /** Status virker også uden login (så prissiden kan vise "Prøv gratis"). */
  r.get('/status', async (req, res) => {
    const user = req.auth ? await loadUser(req.auth.sub).catch(() => null) : null;
    res.json({
      access: accessFor(user),
      emailVerified: Boolean(user?.emailVerifiedAt),
      billingEnabled: env.billingEnabled,
      priceDkk: PLAN.priceDkk,
      trialDays: PLAN.trialDays,
      termsVersion: TERMS_VERSION,
      receiptScans: { used: user ? await receiptScansThisMonth(db, user.id) : 0, limit: env.RECEIPT_SCANS_PER_MONTH },
    } satisfies BillingStatusDTO);
  });

  r.post('/checkout', requireAccount, limiter, async (req, res) => {
    const body = parse(
      z.object({
        acceptTerms: z.literal(true, { error: 'Du skal acceptere handelsbetingelserne' }),
        termsVersion: z.string().max(40),
      }),
      req.body,
    );
    if (!stripe || !env.billingEnabled) {
      throw new HttpError(503, 'Betaling er ikke sat op endnu. Prøv igen senere.', undefined, 'BILLING_UNAVAILABLE');
    }
    if (body.termsVersion !== TERMS_VERSION) {
      throw new HttpError(400, 'Handelsbetingelserne er opdateret. Genindlæs siden og accepter de nye.', undefined, 'TERMS_REQUIRED');
    }
    const user = await loadUser(userId(req));
    if (!user.emailVerifiedAt) {
      throw new HttpError(403, 'Bekræft din e-mail, før du tegner et abonnement.', undefined, 'EMAIL_NOT_VERIFIED');
    }
    if (accessFor(user).subscribed) {
      throw new HttpError(409, 'Du har allerede et abonnement. Administrér det under Konto.', undefined, 'ALREADY_SUBSCRIBED');
    }
    await db.update(users).set({ termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION }).where(eq(users.id, user.id));
    res.json({ url: await createCheckoutSession(db, stripe, user) } satisfies UrlResponse);
  });

  r.post('/portal', requireAccount, limiter, async (req, res) => {
    if (!stripe) throw new HttpError(503, 'Betaling er ikke sat op endnu.', undefined, 'BILLING_UNAVAILABLE');
    res.json({ url: await createPortalSession(stripe, await loadUser(userId(req))) } satisfies UrlResponse);
  });

  /** "Fortryd aftale" – virker både for indloggede og via e-mail på /fortryd. */
  r.post('/withdraw', limiter, async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2, 'Skriv dit navn').max(120),
        email: z
          .email('Ugyldig e-mail')
          .max(254)
          .transform((v) => v.trim().toLowerCase()),
      }),
      req.body,
    );
    const user = req.auth && !req.auth.guest ? await loadUser(req.auth.sub) : null;
    const result = await withdrawSubscription(db, stripe, { user, name: body.name, email: body.email });
    res.status(201).json({ submittedAt: result.submittedAt.toISOString(), refundDkk: result.refundDkk } satisfies WithdrawalResponse);
  });

  return r;
}

/**
 * Stripe-webhook. Skal monteres FØR express.json, fordi signaturen beregnes
 * på den rå body. Svarer 200 på ukendte hændelser og 400 på forkert signatur.
 */
export function stripeWebhook({ db, stripe }: AppContext): RequestHandler[] {
  return [
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new HttpError(503, 'Webhook er ikke konfigureret', undefined, 'BILLING_UNAVAILABLE');
      const signature = req.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) throw new HttpError(400, 'Mangler signatur');
      let event: Stripe.Event;
      try {
        event = Stripe.webhooks.constructEvent(req.body, signature, secret);
      } catch {
        throw new HttpError(400, 'Ugyldig signatur');
      }
      const result = await handleStripeEvent(db, stripe, event);
      log.info('Stripe-hændelse', { type: event.type, id: event.id, result });
      res.json({ received: true, result });
    },
  ];
}
