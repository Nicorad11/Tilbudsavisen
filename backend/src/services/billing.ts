import { PLAN, TERMS_VERSION } from '@tilbudsradar/shared';
import { and, eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { queryOne, type Db } from '../db/client';
import { stripeEvents, users, withdrawals } from '../db/schema';
import { env, log } from '../env';
import { HttpError } from '../http/errors';
import { accessFor } from './auth';
import {
  paymentFailedMail,
  subscriptionCanceledMail,
  subscriptionStartedMail,
  withdrawalReceiptMail,
} from './emails';
import { sendMail } from './mailer';

/** Den del af Stripe-klienten vi bruger – så testene kan give en falsk klient. */
export type StripeClient = Pick<
  Stripe,
  'checkout' | 'billingPortal' | 'customers' | 'subscriptions' | 'invoices' | 'invoicePayments' | 'refunds'
>;

export function createStripeClient(): StripeClient | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, { appInfo: { name: 'Tilbudsradar' }, maxNetworkRetries: 2 });
}

type UserRow = typeof users.$inferSelect;

const RUNNING = new Set(['active', 'trialing', 'past_due']);
const isRunning = (u: Pick<UserRow, 'subscriptionId' | 'subscriptionStatus'>) =>
  Boolean(u.subscriptionId && u.subscriptionStatus && RUNNING.has(u.subscriptionStatus));
const fromUnix = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);
const idOf = (v: string | { id: string } | null | undefined) => (v ? (typeof v === 'string' ? v : v.id) : null);

/* ------------------------------------------------------------------ */
/* Checkout og portal                                                 */
/* ------------------------------------------------------------------ */

/** " inkl. moms" når virksomheden er momsregistreret – ellers ingenting (prisen er den samlede pris). */
const vat = () => (env.VAT_REGISTERED ? ' inkl. moms' : '');

/** Tekst ved betalingsknappen i Stripe Checkout (forbrugeraftaleloven § 12). */
const checkoutNotice = () =>
  `Du bestiller et abonnement med betalingsforpligtelse: ${PLAN.priceDkk} kr. pr. måned${vat()}, ` +
  'som fornyes automatisk hver måned, indtil du opsiger. Ingen binding – du kan opsige når som helst under Konto, ' +
  'og opsigelsen gælder fra udløbet af den betalte måned. Du har 14 dages fortrydelsesret.';

async function ensureCustomer(db: Db, stripe: StripeClient, user: UserRow): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create(
    { email: user.email ?? undefined, metadata: { userId: user.id } },
    { idempotencyKey: `customer-${user.id}` },
  );
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, user.id));
  return customer.id;
}

export async function createCheckoutSession(db: Db, stripe: StripeClient, user: UserRow, now = new Date()): Promise<string> {
  if (!env.STRIPE_PRICE_ID) throw new HttpError(503, 'Betaling er ikke sat op endnu', undefined, 'BILLING_UNAVAILABLE');
  const customer = await ensureCustomer(db, stripe, user);
  // Abonnerer man i prøveperioden, trækkes første betaling først når den slutter (Stripe kræver ≥ 48 timer).
  const trialEnd = user.trialEndsAt && user.trialEndsAt.getTime() > now.getTime() + 49 * 3_600_000 ? user.trialEndsAt : null;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    locale: 'da',
    // MobilePay understøtter ikke tilbagevendende betalinger i Stripe – kort dækker også Apple Pay og Google Pay.
    allowed_payment_method_types: ['card'],
    // 'pay' er ikke tilladt i abonnements-tilstand; 'subscribe' giver knappen "Abonner".
    submit_type: 'subscribe',
    billing_address_collection: 'auto',
    custom_text: { submit: { message: checkoutNotice() } },
    // Vi er selv sælger (og har egne handelsbetingelser) – ikke Stripe som "merchant of record".
    // Managed Payments er slået til som standard på nye Stripe-konti og afviser custom_text.
    managed_payments: { enabled: false },
    subscription_data: {
      description: `Tilbudsradar – ${PLAN.priceDkk} kr/md${vat()}, ingen binding`,
      metadata: { userId: user.id, termsVersion: TERMS_VERSION },
      ...(trialEnd ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {}),
      ...(env.STRIPE_TAX_RATE_ID ? { default_tax_rates: [env.STRIPE_TAX_RATE_ID] } : {}),
    },
    metadata: { userId: user.id, termsVersion: TERMS_VERSION },
    success_url: `${env.APP_URL}/app/betaling/gennemfoert?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}/app/betaling/afbrudt`,
  });
  if (!session.url) throw new HttpError(502, 'Stripe returnerede ingen betalingsside');
  return session.url;
}

export async function createPortalSession(stripe: StripeClient, user: UserRow): Promise<string> {
  if (!user.stripeCustomerId) throw new HttpError(400, 'Du har ikke noget abonnement endnu');
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${env.APP_URL}/app/konto#abonnement`,
    locale: 'da',
    ...(env.STRIPE_PORTAL_CONFIG_ID ? { configuration: env.STRIPE_PORTAL_CONFIG_ID } : {}),
  });
  return session.url;
}

/* ------------------------------------------------------------------ */
/* Synkronisering fra webhooks                                        */
/* ------------------------------------------------------------------ */

async function findUser(db: Db, opts: { userId?: string | null; customerId?: string | null }): Promise<UserRow | null> {
  if (opts.userId) {
    const [u] = await db.select().from(users).where(eq(users.id, opts.userId)).limit(1);
    if (u) return u;
  }
  if (opts.customerId) {
    const [u] = await db.select().from(users).where(eq(users.stripeCustomerId, opts.customerId)).limit(1);
    if (u) return u;
  }
  return null;
}

function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = sub.items.data.map((i) => i.current_period_end).filter((n): n is number => typeof n === 'number');
  let end = ends.length ? fromUnix(Math.max(...ends)) : null;
  // Opsagt til en bestemt dato (fx fra portalen) eller allerede afsluttet: adgangen slutter dér.
  const stop = fromUnix(sub.cancel_at) ?? (sub.status === 'canceled' ? fromUnix(sub.ended_at) : null);
  if (stop && (!end || stop < end)) end = stop;
  return end;
}

/**
 * Kopierer et abonnements tilstand til brugeren og sender de mails, der
 * følger af ændringen. Hændelser ældre end den senest anvendte ignoreres.
 */
export async function syncSubscription(db: Db, sub: Stripe.Subscription, eventCreated: number): Promise<void> {
  const user = await findUser(db, { userId: sub.metadata?.userId, customerId: idOf(sub.customer) });
  if (!user) {
    log.warn('Stripe-abonnement uden kendt bruger', { subscription: sub.id });
    return;
  }
  const eventAt = new Date(eventCreated * 1000);
  if (user.subscriptionEventAt && user.subscriptionEventAt > eventAt) return;

  const nextRunning = RUNNING.has(sub.status);
  // En gammel abonnements afslutning må ikke overskrive et nyere, løbende abonnement.
  if (user.subscriptionId && user.subscriptionId !== sub.id && isRunning(user) && !nextRunning) return;

  const isNew = user.subscriptionId !== sub.id;
  const cancelAtPeriodEnd = nextRunning && (sub.cancel_at_period_end || Boolean(sub.cancel_at));
  const next = {
    stripeCustomerId: user.stripeCustomerId ?? idOf(sub.customer),
    subscriptionId: sub.id,
    subscriptionStatus: sub.status,
    currentPeriodEnd: periodEndOf(sub),
    cancelAtPeriodEnd,
    subscriptionStartedAt: isNew ? new Date(sub.created * 1000) : user.subscriptionStartedAt,
    paymentFailedAt: sub.status === 'past_due' ? (user.paymentFailedAt ?? eventAt) : null,
    subscriptionEventAt: eventAt,
  };
  await db.update(users).set(next).where(eq(users.id, user.id));

  if (!user.email) return;
  const wasRunning = !isNew && isRunning(user);
  if (nextRunning && !wasRunning && sub.status !== 'past_due') {
    await sendMail(
      subscriptionStartedMail(user.email, {
        startedAt: next.subscriptionStartedAt ?? new Date(),
        firstChargeAt: sub.status === 'trialing' ? fromUnix(sub.trial_end) : null,
        currentPeriodEnd: next.currentPeriodEnd,
      }),
    );
  } else if (wasRunning && !user.cancelAtPeriodEnd && (cancelAtPeriodEnd || !nextRunning)) {
    await sendMail(subscriptionCanceledMail(user.email, next.currentPeriodEnd));
  }
}

async function onPaymentFailed(db: Db, invoice: Stripe.Invoice): Promise<void> {
  if (invoice.billing_reason === 'subscription_create') return; // Checkout håndterer første betaling selv
  const user = await findUser(db, { customerId: idOf(invoice.customer) });
  if (!user || user.paymentFailedAt) return; // kun én mail pr. rykkerrunde
  const failedAt = new Date();
  await db.update(users).set({ paymentFailedAt: failedAt }).where(eq(users.id, user.id));
  if (user.email) {
    const graceEnd = new Date(failedAt.getTime() + env.PAST_DUE_GRACE_DAYS * 86_400_000);
    await sendMail(paymentFailedMail(user.email, graceEnd));
  }
}

async function onInvoicePaid(db: Db, invoice: Stripe.Invoice): Promise<void> {
  const user = await findUser(db, { customerId: idOf(invoice.customer) });
  if (user?.paymentFailedAt) await db.update(users).set({ paymentFailedAt: null }).where(eq(users.id, user.id));
}

/**
 * Behandler en verificeret Stripe-hændelse præcis én gang. Fejler behandlingen,
 * fjernes markeringen igen, så Stripes automatiske gentagelse prøver igen.
 */
export async function handleStripeEvent(db: Db, stripe: StripeClient | null, event: Stripe.Event): Promise<'processed' | 'duplicate'> {
  const claimed = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  if (!claimed.length) return 'duplicate';
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const user = await findUser(db, { userId: session.client_reference_id, customerId: idOf(session.customer) });
        if (user && !user.stripeCustomerId && session.customer) {
          await db.update(users).set({ stripeCustomerId: idOf(session.customer) }).where(eq(users.id, user.id));
        }
        // Hent abonnementet med det samme, så siden "Betaling gennemført" viser den nye status.
        const subId = idOf(session.subscription);
        if (subId && stripe) await syncSubscription(db, await stripe.subscriptions.retrieve(subId), event.created);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(db, event.data.object, event.created);
        break;
      case 'invoice.paid':
        await onInvoicePaid(db, event.data.object);
        break;
      case 'invoice.payment_failed':
        await onPaymentFailed(db, event.data.object);
        break;
      default:
        break;
    }
    return 'processed';
  } catch (err) {
    await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Opsigelse ved sletning og fortrydelse                              */
/* ------------------------------------------------------------------ */

/** Kontosletning: et løbende abonnement opsiges med det samme, før brugeren slettes. */
export async function cancelForAccountDeletion(stripe: StripeClient | null, user: UserRow): Promise<void> {
  if (!user.subscriptionId || !isRunning(user)) return;
  if (!stripe) {
    throw new HttpError(503, 'Dit abonnement kunne ikke opsiges lige nu, så kontoen er ikke slettet. Prøv igen om lidt.');
  }
  try {
    await stripe.subscriptions.cancel(user.subscriptionId, { prorate: false, invoice_now: false });
  } catch (err) {
    if ((err as { code?: string }).code === 'resource_missing') return;
    log.error('Abonnement kunne ikke opsiges ved kontosletning', { subscription: user.subscriptionId, err: (err as Error).message });
    throw new HttpError(502, 'Dit abonnement kunne ikke opsiges lige nu, så kontoen er ikke slettet. Prøv igen om lidt.');
  }
}

/** Refunderer alle betalte fakturaer på abonnementet (fuld refusion ved fortrydelse). Returnerer kroner. */
async function refundSubscription(stripe: StripeClient, subscriptionId: string): Promise<number> {
  let refunded = 0;
  const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 10 });
  for (const invoice of invoices.data) {
    if (!invoice.id || invoice.amount_paid <= 0) continue;
    const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 10 });
    for (const p of payments.data) {
      const intent = idOf(p.payment.payment_intent ?? null);
      if (!intent || p.status !== 'paid') continue;
      await stripe.refunds.create({ payment_intent: intent, reason: 'requested_by_customer' }, { idempotencyKey: `withdraw-${intent}` });
      refunded += p.amount_paid ?? 0;
    }
  }
  return refunded / 100;
}

/**
 * "Fortryd aftale" (forbrugeraftaleloven § 20 a): stopper abonnementet med det
 * samme, refunderer det betalte og sender en kvittering på e-mail. Kan
 * kontoen ikke matches, registreres fortrydelsen til manuel behandling.
 */
export async function withdrawSubscription(
  db: Db,
  stripe: StripeClient | null,
  input: { user: UserRow | null; name: string; email: string },
  now = new Date(),
): Promise<{ submittedAt: Date; refundDkk: number; matched: boolean }> {
  const user =
    input.user ??
    (await findUserByEmail(db, input.email)) ??
    null;
  const withdrawable = user && accessFor(user, now).withdrawableUntil;

  let refundDkk = 0;
  let status = 'manual';
  if (user && withdrawable && user.subscriptionId) {
    if (stripe) {
      try {
        await stripe.subscriptions.cancel(user.subscriptionId, { prorate: false, invoice_now: false });
      } catch (err) {
        if ((err as { code?: string }).code !== 'resource_missing') throw err;
      }
      refundDkk = await refundSubscription(stripe, user.subscriptionId);
      status = 'processed';
      await db
        .update(users)
        .set({
          subscriptionStatus: 'canceled',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: now,
          paymentFailedAt: null,
          subscriptionEventAt: now,
        })
        .where(eq(users.id, user.id));
    } else {
      status = 'pending';
    }
  }

  await db.insert(withdrawals).values({
    userId: user?.id ?? null,
    name: input.name,
    email: input.email,
    subscriptionId: user?.subscriptionId ?? null,
    status,
    refundDkk,
    submittedAt: now,
  });
  log.info('Fortrydelse modtaget', { status, refundDkk });

  const matched = status === 'processed';
  const receipt = { name: input.name, submittedAt: now, accountEmail: user?.email ?? null, refundDkk, matched };
  await sendMail(withdrawalReceiptMail(input.email, receipt));
  if (user?.email && user.email !== input.email.toLowerCase()) await sendMail(withdrawalReceiptMail(user.email, receipt));
  if (!matched) {
    await sendMail({
      ...withdrawalReceiptMail(env.CONTACT_EMAIL, receipt),
      subject: `Fortrydelse til manuel behandling (${status})`,
    });
  }
  return { submittedAt: now, refundDkk, matched };
}

async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email.trim().toLowerCase()), eq(users.isGuest, false)))
    .limit(1);
  return u ?? null;
}

/** Antal kvitteringsscanninger i indeværende kalendermåned (dansk tid). */
export async function receiptScansThisMonth(db: Db, userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM receipt_scans
        WHERE user_id = ${userId}::uuid
          AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Europe/Copenhagen') AT TIME ZONE 'Europe/Copenhagen')`,
  );
  return row?.n ?? 0;
}
