import { PLAN, TERMS_VERSION } from '@tilbudsradar/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { queryOne, type Db } from '../db/client';
import { stripeEvents, users, withdrawals } from '../db/schema';
import { env, log } from '../env';
import { HttpError } from '../http/errors';
import { accessFor } from './auth';
import {
  appLink,
  paymentFailedMail,
  subscriptionCanceledMail,
  subscriptionStartedMail,
  withdrawalConfirmMail,
  withdrawalReceiptMail,
} from './emails';
import { sendMail } from './mailer';
import { consumeEmailToken, createEmailToken, lastTokenSentAt, restoreEmailToken } from './tokens';

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
 * "Fortryd aftale" (forbrugeraftaleloven § 20 a). Tre veje:
 *
 * - Logget ind: abonnementet stoppes og refunderes med det samme (`withdrawSubscription`).
 * - Uden login (`requestWithdrawal`): fortrydelsen registreres med tidspunktet, og
 *   kontoens e-mail får en kvittering med et bekræftelseslink. Først når kontoens ejer
 *   bekræfter (`confirmWithdrawal`), stoppes og refunderes abonnementet – ellers kunne
 *   alle, der kender en kundes e-mail, opsige og refundere kundens abonnement.
 *   Fristen regnes fra indsendelsen, ikke fra bekræftelsen.
 * - Kan kontoen ikke matches, eller er fristen udløbet, registreres fortrydelsen til
 *   manuel behandling, og der sker intet automatisk.
 *
 * Statusser i `withdrawals`: processed, pending (Stripe ikke sat op), manual,
 * unconfirmed (venter på bekræftelse) og superseded (afløst af en anden fortrydelse).
 */

/** Stopper abonnementet i Stripe og refunderer det betalte. Kun for en bekræftet konto. */
async function stopAndRefund(db: Db, stripe: StripeClient | null, user: UserRow, now: Date): Promise<{ status: 'processed' | 'pending'; refundDkk: number }> {
  if (!stripe || !user.subscriptionId) return { status: 'pending', refundDkk: 0 };
  try {
    await stripe.subscriptions.cancel(user.subscriptionId, { prorate: false, invoice_now: false });
  } catch (err) {
    if ((err as { code?: string }).code !== 'resource_missing') {
      // Allerede stoppet ved et tidligere forsøg, hvor refunderingen fejlede? Så fortsæt.
      const current = await stripe.subscriptions.retrieve(user.subscriptionId).catch(() => null);
      if (current?.status !== 'canceled') throw err;
    }
  }
  const refundDkk = await refundSubscription(stripe, user.subscriptionId);
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
  // Fortrydelser, der venter på bekræftelse, er nu overflødige.
  await db
    .update(withdrawals)
    .set({ status: 'superseded' })
    .where(and(eq(withdrawals.userId, user.id), eq(withdrawals.status, 'unconfirmed')));
  return { status: 'processed', refundDkk };
}

/** Kvittering til forbrugeren og – når der ikke er stoppet noget automatisk – besked til os. */
async function sendWithdrawalMails(
  to: string[],
  receipt: { name: string; submittedAt: Date; accountEmail: string | null; refundDkk: number; matched: boolean },
  status: string,
  verified: boolean,
) {
  for (const address of new Set(to.map((a) => a.toLowerCase()))) await sendMail(withdrawalReceiptMail(address, receipt));
  if (!receipt.matched) {
    await sendMail({
      ...withdrawalReceiptMail(env.CONTACT_EMAIL, receipt),
      subject: `Fortrydelse til manuel behandling (${status}${verified ? '' : ', afsender ikke logget ind – identitet ikke bekræftet'})`,
    });
  }
}

/** Logget ind: kontoen er bekræftet, så abonnementet stoppes og refunderes med det samme. */
export async function withdrawSubscription(
  db: Db,
  stripe: StripeClient | null,
  input: { user: UserRow; name: string; email: string },
  now = new Date(),
): Promise<{ submittedAt: Date; refundDkk: number; matched: boolean }> {
  const { user } = input;
  const withdrawable = Boolean(user.subscriptionId && accessFor(user, now).withdrawableUntil);
  const { status, refundDkk } = withdrawable ? await stopAndRefund(db, stripe, user, now) : { status: 'manual', refundDkk: 0 };

  await db.insert(withdrawals).values({
    userId: user.id,
    name: input.name,
    email: input.email,
    subscriptionId: user.subscriptionId ?? null,
    status,
    refundDkk,
    submittedAt: now,
  });
  log.info('Fortrydelse modtaget', { status, refundDkk });

  const matched = status === 'processed';
  const receipt = { name: input.name, submittedAt: now, accountEmail: user.email ?? null, refundDkk, matched };
  await sendWithdrawalMails([input.email, ...(user.email ? [user.email] : [])], receipt, status, true);
  return { submittedAt: now, refundDkk, matched };
}

/** Mindst så lang tid mellem to bekræftelsesmails til samme konto (mod mailbomber). */
const WITHDRAW_MAIL_INTERVAL_MS = 2 * 60_000;

/**
 * Uden login: registrerer fortrydelsen med tidspunktet. Har kontoen med e-mailen et
 * abonnement, der kan fortrydes, får kontoens e-mail en kvittering med et
 * bekræftelseslink – intet stoppes, før det er bekræftet. Svaret er det samme,
 * uanset om e-mailen findes.
 */
export async function requestWithdrawal(db: Db, input: { name: string; email: string }, now = new Date()): Promise<{ submittedAt: Date }> {
  const user = await findUserByEmail(db, input.email);
  if (user?.email && user.subscriptionId && accessFor(user, now).withdrawableUntil) {
    await db.insert(withdrawals).values({
      userId: user.id,
      name: input.name,
      email: input.email,
      subscriptionId: user.subscriptionId,
      status: 'unconfirmed',
      refundDkk: 0,
      submittedAt: now,
    });
    log.info('Fortrydelse uden login afventer bekræftelse');
    const last = await lastTokenSentAt(db, user.id, 'withdraw');
    if (!last || now.getTime() - last.getTime() > WITHDRAW_MAIL_INTERVAL_MS) {
      const token = await createEmailToken(db, user.id, 'withdraw', user.email);
      const link = appLink(`/app/bekraeft-fortrydelse?token=${encodeURIComponent(token)}`);
      await sendMail(withdrawalConfirmMail(user.email, { name: input.name, submittedAt: now, link }));
    }
    return { submittedAt: now };
  }

  // Ingen konto med et abonnement, der kan fortrydes: til manuel behandling.
  await db.insert(withdrawals).values({
    userId: user?.id ?? null,
    name: input.name,
    email: input.email,
    subscriptionId: user?.subscriptionId ?? null,
    status: 'manual',
    refundDkk: 0,
    submittedAt: now,
  });
  log.info('Fortrydelse modtaget', { status: 'manual', refundDkk: 0 });
  const receipt = { name: input.name, submittedAt: now, accountEmail: user?.email ?? null, refundDkk: 0, matched: false };
  await sendWithdrawalMails([input.email], receipt, 'manual', false);
  return { submittedAt: now };
}

/**
 * Bekræftelseslinket fra mailen: stopper og refunderer abonnementet for den første
 * fortrydelse, der venter. Fristen vurderes ud fra indsendelsen. Fejler Stripe,
 * virker linket igen, så det kan prøves en gang til.
 */
export async function confirmWithdrawal(
  db: Db,
  stripe: StripeClient | null,
  token: string,
  now = new Date(),
): Promise<{ submittedAt: Date; refundDkk: number; matched: boolean }> {
  const link = await consumeEmailToken(db, token, 'withdraw');
  if (!link) {
    throw new HttpError(400, 'Linket er udløbet eller allerede brugt. Send fortrydelsen igen på /fortryd, eller skriv til os.');
  }
  try {
    const [first] = await db
      .select()
      .from(withdrawals)
      .where(and(eq(withdrawals.userId, link.userId), eq(withdrawals.status, 'unconfirmed')))
      .orderBy(asc(withdrawals.submittedAt))
      .limit(1);
    const [user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1);
    if (!first || !user) throw new HttpError(409, 'Fortrydelsen er allerede behandlet.');

    // Samme abonnement som ved indsendelsen, og indsendt inden fristen.
    const withdrawable = user.subscriptionId === first.subscriptionId && Boolean(accessFor(user, first.submittedAt).withdrawableUntil);
    const { status, refundDkk } = withdrawable ? await stopAndRefund(db, stripe, user, now) : { status: 'manual', refundDkk: 0 };
    await db.update(withdrawals).set({ status, refundDkk }).where(eq(withdrawals.id, first.id));
    // Flere indsendelser før bekræftelsen gælder som én.
    await db
      .update(withdrawals)
      .set({ status: 'superseded' })
      .where(and(eq(withdrawals.userId, user.id), eq(withdrawals.status, 'unconfirmed')));
    log.info('Fortrydelse bekræftet', { status, refundDkk });

    const matched = status === 'processed';
    const receipt = { name: first.name, submittedAt: first.submittedAt, accountEmail: user.email ?? null, refundDkk, matched };
    await sendWithdrawalMails([user.email ?? first.email], receipt, status, true);
    return { submittedAt: first.submittedAt, refundDkk, matched };
  } catch (err) {
    if (!(err instanceof HttpError)) await restoreEmailToken(db, link.id);
    throw err;
  }
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
