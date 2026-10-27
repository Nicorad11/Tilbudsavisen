import type { AuthResponse, BillingStatusDTO, UserDTO } from '@tilbudsradar/shared';
import { TERMS_VERSION } from '@tilbudsradar/shared';
import { silentLogger } from '@tilbudsradar/scrapers';
import { eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { receiptScans, users } from '../src/db/schema';
import { createApp } from '../src/http/app';
import type { StripeClient } from '../src/services/billing';
import { runBillingCron } from '../src/services/billingCron';
import { testOutbox } from '../src/services/mailer';
import { ScrapeManager } from '../src/services/scrapeJobs';

const WEBHOOK_SECRET = 'whsec_test_secret';
const DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Falsk Stripe-klient                                                */
/* ------------------------------------------------------------------ */

interface Call {
  method: string;
  args: unknown[];
}

function fakeStripe() {
  const calls: Call[] = [];
  const subscriptions = new Map<string, Stripe.Subscription>();
  let n = 0;
  const rec =
    <T,>(method: string, result: (...args: never[]) => T) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(result(...(args as never[])));
    };
  const client = {
    customers: {
      create: rec('customers.create', () => ({ id: `cus_test_${++n}` })),
      update: rec('customers.update', () => ({})),
    },
    checkout: {
      sessions: { create: rec('checkout.sessions.create', () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })) },
    },
    billingPortal: { sessions: { create: rec('billingPortal.sessions.create', () => ({ url: 'https://billing.stripe.com/p/session/test' })) } },
    subscriptions: {
      retrieve: rec('subscriptions.retrieve', (id: string) => subscriptions.get(id)),
      cancel: rec('subscriptions.cancel', (id: string) => ({ ...subscriptions.get(id), status: 'canceled' })),
    },
    invoices: { list: rec('invoices.list', () => ({ data: [{ id: 'in_test_1', amount_paid: 4900 }] })) },
    invoicePayments: {
      list: rec('invoicePayments.list', () => ({
        data: [{ status: 'paid', amount_paid: 4900, payment: { type: 'payment_intent', payment_intent: 'pi_test_1' } }],
      })),
    },
    refunds: { create: rec('refunds.create', () => ({ id: 're_test_1' })) },
  };
  return { client: client as unknown as StripeClient, calls, subscriptions };
}

function subscription(over: Record<string, unknown> & { metadata?: Record<string, string> }): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: 'sub_test_1',
    object: 'subscription',
    customer: 'cus_test_1',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    ended_at: null,
    created: now,
    trial_end: null,
    metadata: {},
    items: { object: 'list', data: [{ current_period_end: now + 30 * 86_400 }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

/* ------------------------------------------------------------------ */
/* Opsætning                                                          */
/* ------------------------------------------------------------------ */

let database: Database;
let app: ReturnType<typeof createApp>;
let stripe: ReturnType<typeof fakeStripe>;

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  stripe = fakeStripe();
  app = createApp({ db: database.db, scrape, stripe: stripe.client });
});

afterAll(async () => {
  await database?.close();
});

beforeEach(() => {
  testOutbox.length = 0;
  stripe.calls.length = 0;
});

let seq = 0;
async function register(email = `bruger${++seq}@example.dk`) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hemmelig123', acceptTerms: true }).expect(201);
  const body = res.body as AuthResponse;
  return {
    email,
    user: body.user,
    auth: { Authorization: `Bearer ${body.accessToken}` },
    cookie: res.headers['set-cookie'] as unknown as string[],
  };
}

const linkToken = (text: string) => decodeURIComponent(/token=([^\s&]+)/.exec(text)?.[1] ?? '');
const mailTo = (to: string) => testOutbox.filter((m) => m.to === to);
const dbUser = async (id: string) => (await database.db.select().from(users).where(eq(users.id, id)))[0]!;
const setUser = (id: string, values: Partial<typeof users.$inferInsert>) => database.db.update(users).set(values).where(eq(users.id, id));

let eventSeq = 0;
function signedEvent(type: string, object: unknown, created = Math.floor(Date.now() / 1000), id = `evt_test_${++eventSeq}`) {
  const payload = JSON.stringify({ id, object: 'event', type, created, api_version: '2026-09-30.endive', livemode: false, data: { object } });
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }), id };
}
const postEvent = (e: { payload: string; signature: string }) =>
  request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', e.signature).send(e.payload);

/* ------------------------------------------------------------------ */
/* Konti                                                              */
/* ------------------------------------------------------------------ */

describe('konto og prøveperiode', () => {
  it('opretter konto med prøveperiode, gemmer accept af betingelser og sender bekræftelse', async () => {
    const a = await register();
    expect(a.user.access).toMatchObject({ status: 'trial', hasAccess: true, trialDaysLeft: 14 });
    expect(a.user.termsVersion).toBe(TERMS_VERSION);
    const row = await dbUser(a.user.id);
    expect(row.termsAcceptedAt).toBeInstanceOf(Date);
    const [mail] = mailTo(a.email);
    expect(mail?.subject).toMatch(/Bekræft din e-mail/);
    expect(mail?.html).toContain('https://tilbudsradar.test/app/bekraeft-email?token=');
  });

  it('kræver aktiv accept af handelsbetingelserne', async () => {
    await request(app).post('/api/auth/register').send({ email: 'nej@example.dk', password: 'hemmelig123' }).expect(400);
    await request(app).post('/api/auth/register').send({ email: 'nej@example.dk', password: 'hemmelig123', acceptTerms: false }).expect(400);
  });

  it('én prøveperiode pr. e-mail – også efter sletning og med +tag/Gmail-punktummer', async () => {
    const first = await register('anna.hansen@gmail.com');
    await request(app).delete('/api/auth/me').set(first.auth).expect(204);
    const again = await register('anna.hansen@gmail.com');
    expect(again.user.access).toMatchObject({ status: 'expired', hasAccess: false, trialUsed: false });
    const variant = await register('annahansen+tilbud@gmail.com');
    expect(variant.user.access.status).toBe('expired');
    await request(app).post('/api/lists').set(variant.auth).send({ name: 'x' }).expect(402);
  });

  it('bekræfter e-mail med engangslink og kan sende igen', async () => {
    const a = await register();
    await request(app).post('/api/auth/verify-email/resend').set(a.auth).expect(429); // lige sendt
    const token = linkToken(mailTo(a.email)[0]!.text);
    const res = await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
    expect((res.body.user as UserDTO).emailVerified).toBe(true);
    await request(app).post('/api/auth/verify-email').send({ token }).expect(400); // kun én gang
    const resend = await request(app).post('/api/auth/verify-email/resend').set(a.auth).expect(200);
    expect(resend.body.alreadyVerified).toBe(true);
  });

  it('glemt adgangskode: samme svar uanset e-mail, engangslink, udløb og lukker andre sessioner', async () => {
    const a = await register();
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'findes-ikke@example.dk' }).expect(200);
    const known = await request(app).post('/api/auth/forgot-password').send({ email: a.email }).expect(200);
    expect(known.body).toEqual(unknown.body);
    await new Promise((r) => setTimeout(r, 20)); // mailen sendes i baggrunden
    const mail = mailTo(a.email).find((m) => /Nulstil/.test(m.subject))!;
    expect(mail.text).toContain('https://tilbudsradar.test/app/nulstil-adgangskode?token=');
    expect(testOutbox.some((m) => m.to === 'findes-ikke@example.dk')).toBe(false);

    const token = linkToken(mail.text);
    await request(app).post('/api/auth/reset-password').send({ token, password: 'kort' }).expect(400);
    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'ny-hemmelig-kode' }).expect(200);
    expect((reset.body as AuthResponse).user.emailVerified).toBe(true);
    await request(app).post('/api/auth/reset-password').send({ token, password: 'endnu-en-kode' }).expect(400);
    // Den gamle session (refresh-cookie fra oprettelsen) er lukket.
    await request(app).post('/api/auth/refresh').set('Cookie', a.cookie).expect(401);
    await request(app).post('/api/auth/login').send({ email: a.email, password: 'hemmelig123' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: a.email, password: 'ny-hemmelig-kode' }).expect(200);

    // Udløbne links virker ikke.
    await new Promise((r) => setTimeout(r, 20));
    await database.db.execute(sql`UPDATE email_tokens SET created_at = now() - interval '1 hour'`);
    await request(app).post('/api/auth/forgot-password').send({ email: a.email }).expect(200);
    await new Promise((r) => setTimeout(r, 20));
    const second = linkToken(mailTo(a.email).filter((m) => /Nulstil/.test(m.subject)).at(-1)!.text);
    await database.db.execute(sql`UPDATE email_tokens SET expires_at = now() - interval '1 minute' WHERE purpose = 'reset_password'`);
    await request(app).post('/api/auth/reset-password').send({ token: second, password: 'ny-kode-123' }).expect(400);
  });

  it('skift adgangskode og e-mail (med ny bekræftelse)', async () => {
    const a = await register();
    await request(app).post('/api/auth/change-password').set(a.auth).send({ currentPassword: 'forkert', newPassword: 'ny-kode-123' }).expect(400);
    const changed = await request(app)
      .post('/api/auth/change-password')
      .set(a.auth)
      .send({ currentPassword: 'hemmelig123', newPassword: 'ny-kode-123' })
      .expect(200);
    const auth = { Authorization: `Bearer ${(changed.body as AuthResponse).accessToken}` };

    await request(app).post('/api/auth/change-email').set(auth).send({ newEmail: 'ny@example.dk', password: 'forkert' }).expect(400);
    await request(app).post('/api/auth/change-email').set(auth).send({ newEmail: 'ny@example.dk', password: 'ny-kode-123' }).expect(200);
    expect((await dbUser(a.user.id)).email).toBe(a.email); // først efter bekræftelse
    const token = linkToken(mailTo('ny@example.dk')[0]!.text);
    const res = await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
    expect((res.body.user as UserDTO).email).toBe('ny@example.dk');
    await new Promise((r) => setTimeout(r, 20));
    expect(mailTo(a.email).some((m) => /e-mail på Tilbudsradar er ændret/.test(m.subject))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Adgang til betalte funktioner                                      */
/* ------------------------------------------------------------------ */

describe('betalingsmur', () => {
  it('afviser gæster og brugere uden adgang; data er skrivebeskyttede', async () => {
    const guest = (await request(app).post('/api/auth/guest').expect(201)).body as AuthResponse;
    const g = { Authorization: `Bearer ${guest.accessToken}` };
    const gRes = await request(app).post('/api/lists').set(g).send({ name: 'x' }).expect(402);
    expect(gRes.body.code).toBe('ACCOUNT_REQUIRED');

    const a = await register();
    const list = (await request(app).post('/api/lists').set(a.auth).send({ name: 'Min liste' }).expect(201)).body as { id: number };
    await request(app).post('/api/watchlist').set(a.auth).send({ query: 'kaffe', targetPrice: 30 }).expect(201);

    await setUser(a.user.id, { trialEndsAt: new Date(Date.now() - DAY) });
    const paid: [string, string, object?][] = [
      ['post', '/api/lists', { name: 'y' }],
      ['patch', `/api/lists/${list.id}`, { name: 'z' }],
      ['post', `/api/lists/${list.id}/items`, { text: 'mælk' }],
      ['get', `/api/lists/${list.id}/optimize`],
      ['post', '/api/watchlist', { query: 'smør', targetPrice: 10 }],
      ['get', '/api/products/1/history'],
      ['post', '/api/offers/1/reports', { verdict: 'real' }],
      ['post', '/api/reports/1/vote', { value: 1 }],
      ['post', '/api/receipts/parse-text', { text: 'NETTO\nMÆLK 10,00' }],
      ['post', '/api/receipts', { storeId: null, purchasedAt: null, total: null, lines: [], source: 'manual' }],
    ];
    for (const [method, path, body] of paid) {
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).set(a.auth).send(body);
      expect(res.status, `${method} ${path}`).toBe(402);
      expect(res.body.code).toBe('PLAN_REQUIRED');
    }
    // Læsning og sletning af egne data virker stadig.
    const lists = (await request(app).get('/api/lists').set(a.auth).expect(200)).body as unknown[];
    expect(lists).toHaveLength(1);
    await request(app).get('/api/watchlist').set(a.auth).expect(200);
    await request(app).delete(`/api/lists/${list.id}`).set(a.auth).expect(204);
  });

  it('kvitteringsscanneren har et månedsloft med en venlig besked', async () => {
    const a = await register();
    await database.db.insert(receiptScans).values(Array.from({ length: 20 }, () => ({ userId: a.user.id, method: 'claude' })));
    const res = await request(app).post('/api/receipts/scan').set(a.auth).set('Content-Type', 'image/jpeg').send(Buffer.from('x')).expect(429);
    expect(res.body.code).toBe('SCAN_QUOTA');
    expect(res.body.error).toMatch(/20 kvitteringsscanninger/);
    const status = (await request(app).get('/api/billing/status').set(a.auth).expect(200)).body as BillingStatusDTO;
    expect(status.receiptScans).toEqual({ used: 20, limit: 20 });
  });
});

/* ------------------------------------------------------------------ */
/* Checkout, portal og webhooks                                       */
/* ------------------------------------------------------------------ */

describe('abonnement', () => {
  it('Checkout kræver bekræftet e-mail og accept af den aktuelle version af betingelserne', async () => {
    const a = await register();
    const accept = { acceptTerms: true, termsVersion: TERMS_VERSION };
    const unverified = await request(app).post('/api/billing/checkout').set(a.auth).send(accept).expect(403);
    expect(unverified.body.code).toBe('EMAIL_NOT_VERIFIED');
    await setUser(a.user.id, { emailVerifiedAt: new Date() });
    await request(app).post('/api/billing/checkout').set(a.auth).send({ termsVersion: TERMS_VERSION }).expect(400);
    const old = await request(app).post('/api/billing/checkout').set(a.auth).send({ acceptTerms: true, termsVersion: '2020-01-01' }).expect(400);
    expect(old.body.code).toBe('TERMS_REQUIRED');

    const res = await request(app).post('/api/billing/checkout').set(a.auth).send(accept).expect(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    const params = stripe.calls.find((c) => c.method === 'checkout.sessions.create')!.args[0] as Record<string, any>;
    expect(params).toMatchObject({
      mode: 'subscription',
      locale: 'da',
      client_reference_id: a.user.id,
      line_items: [{ price: 'price_test_49', quantity: 1 }],
      allowed_payment_method_types: ['card'],
      managed_payments: { enabled: false },
      success_url: 'https://tilbudsradar.test/app/betaling/gennemfoert?session_id={CHECKOUT_SESSION_ID}',
    });
    // I prøveperioden udskydes første træk til prøveperiodens slut.
    expect(params.subscription_data.trial_end).toBeGreaterThan(Date.now() / 1000 + 13 * 86_400);
    expect(params.custom_text.submit.message).toMatch(/betalingsforpligtelse/);
    // Ikke momsregistreret i testmiljøet: ingen "inkl. moms" på Stripes betalingsside.
    expect(params.custom_text.submit.message).not.toContain('inkl. moms');
    expect(params.subscription_data.description).not.toContain('inkl. moms');
    expect((await dbUser(a.user.id)).stripeCustomerId).toMatch(/^cus_test_/);
  });

  it('webhook: afviser forkert signatur og behandler hver hændelse én gang', async () => {
    await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=forkert')
      .send('{"id":"evt_x"}')
      .expect(400);

    const a = await register();
    await setUser(a.user.id, { emailVerifiedAt: new Date(), stripeCustomerId: 'cus_flow' });
    const sub = subscription({ id: 'sub_flow', customer: 'cus_flow', metadata: { userId: a.user.id } });
    stripe.subscriptions.set('sub_flow', sub);

    const done = signedEvent('checkout.session.completed', {
      object: 'checkout.session',
      mode: 'subscription',
      client_reference_id: a.user.id,
      customer: 'cus_flow',
      subscription: 'sub_flow',
    });
    expect((await postEvent(done).expect(200)).body.result).toBe('processed');
    expect((await postEvent(done).expect(200)).body.result).toBe('duplicate');

    const me = (await request(app).get('/api/auth/me').set(a.auth).expect(200)).body as UserDTO;
    expect(me.access).toMatchObject({ status: 'active', hasAccess: true, subscribed: true });
    expect(me.access.withdrawableUntil).not.toBeNull();
    const confirmation = mailTo(a.email).filter((m) => /Ordrebekræftelse/.test(m.subject));
    expect(confirmation).toHaveLength(1);
    expect(confirmation[0]!.attachments?.[0]?.content).toMatch(/HANDELSBETINGELSER/);
    expect(confirmation[0]!.text).toMatch(/Fortrydelsesret/);

    // Allerede abonnent → ingen ny Checkout.
    const again = await request(app).post('/api/billing/checkout').set(a.auth).send({ acceptTerms: true, termsVersion: TERMS_VERSION }).expect(409);
    expect(again.body.code).toBe('ALREADY_SUBSCRIBED');
    const portal = await request(app).post('/api/billing/portal').set(a.auth).expect(200);
    expect(portal.body.url).toMatch(/billing\.stripe\.com/);
  });

  it('webhook: betaling fejler → henstand og én mail; betalt igen → ryddet', async () => {
    const a = await register();
    await setUser(a.user.id, { stripeCustomerId: 'cus_due', subscriptionId: 'sub_due', subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
    const invoice = { object: 'invoice', id: 'in_due', customer: 'cus_due', billing_reason: 'subscription_cycle', amount_paid: 0 };
    await postEvent(signedEvent('invoice.payment_failed', invoice)).expect(200);
    await postEvent(signedEvent('invoice.payment_failed', invoice)).expect(200); // Stripes nye forsøg
    expect(mailTo(a.email).filter((m) => /fejlede/.test(m.subject))).toHaveLength(1);

    await postEvent(signedEvent('customer.subscription.updated', subscription({ id: 'sub_due', customer: 'cus_due', status: 'past_due' }))).expect(200);
    let me = (await request(app).get('/api/auth/me').set(a.auth)).body as UserDTO;
    expect(me.access).toMatchObject({ status: 'past_due', hasAccess: true });
    expect(me.access.graceEndsAt).not.toBeNull();

    await postEvent(signedEvent('invoice.paid', { ...invoice, amount_paid: 4900 })).expect(200);
    await postEvent(signedEvent('customer.subscription.updated', subscription({ id: 'sub_due', customer: 'cus_due', status: 'active' }))).expect(200);
    me = (await request(app).get('/api/auth/me').set(a.auth)).body as UserDTO;
    expect(me.access.status).toBe('active');
    expect((await dbUser(a.user.id)).paymentFailedAt).toBeNull();
  });

  it('webhook: opsigelse i portalen sender én mail med slutdato; ældre hændelser ignoreres', async () => {
    const a = await register();
    await setUser(a.user.id, {
      stripeCustomerId: 'cus_cancel',
      subscriptionId: 'sub_cancel',
      subscriptionStatus: 'active',
      trialEndsAt: new Date(Date.now() - DAY),
    });
    const now = Math.floor(Date.now() / 1000);
    const canceled = subscription({ id: 'sub_cancel', customer: 'cus_cancel', cancel_at_period_end: true });
    await postEvent(signedEvent('customer.subscription.updated', canceled, now)).expect(200);
    // En forsinket, ældre hændelse må ikke "genoplive" abonnementet.
    await postEvent(signedEvent('customer.subscription.updated', subscription({ id: 'sub_cancel', customer: 'cus_cancel' }), now - 60)).expect(200);

    const me = (await request(app).get('/api/auth/me').set(a.auth)).body as UserDTO;
    expect(me.access).toMatchObject({ status: 'canceled', hasAccess: true, cancelAtPeriodEnd: true, nextPaymentAt: null });
    const mails = mailTo(a.email).filter((m) => /opsagt/.test(m.subject));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toMatch(/til og med/);

    // Ved periodens udløb sletter Stripe abonnementet – ingen ny mail.
    const ended = subscription({ id: 'sub_cancel', customer: 'cus_cancel', status: 'canceled', ended_at: now - 10, items: { object: 'list', data: [{ current_period_end: now - 10 }] } });
    await postEvent(signedEvent('customer.subscription.deleted', ended, now + 10)).expect(200);
    expect(((await request(app).get('/api/auth/me').set(a.auth)).body as UserDTO).access.status).toBe('expired');
    expect(mailTo(a.email).filter((m) => /opsagt/.test(m.subject))).toHaveLength(1);
  });

  it('kontosletning opsiger abonnementet i Stripe først', async () => {
    const a = await register();
    await setUser(a.user.id, { stripeCustomerId: 'cus_del', subscriptionId: 'sub_del', subscriptionStatus: 'active' });
    await request(app).delete('/api/auth/me').set(a.auth).expect(204);
    const cancel = stripe.calls.find((c) => c.method === 'subscriptions.cancel');
    expect(cancel?.args[0]).toBe('sub_del');
    expect(await database.db.select().from(users).where(eq(users.id, a.user.id))).toHaveLength(0);
  });

  it('kontosletning uden Stripe-forbindelse sletter ikke kontoen', async () => {
    const scrape = new ScrapeManager(database.db, silentLogger);
    const offline = createApp({ db: database.db, scrape, stripe: null });
    const a = await register();
    await setUser(a.user.id, { subscriptionId: 'sub_off', subscriptionStatus: 'active' });
    await request(offline).delete('/api/auth/me').set(a.auth).expect(503);
    expect(await database.db.select().from(users).where(eq(users.id, a.user.id))).toHaveLength(1);
  });

  it('"Fortryd aftale": stopper abonnementet, refunderer og sender kvittering', async () => {
    const a = await register();
    await setUser(a.user.id, {
      stripeCustomerId: 'cus_wd',
      subscriptionId: 'sub_wd',
      subscriptionStatus: 'active',
      subscriptionStartedAt: new Date(Date.now() - 3 * DAY),
      currentPeriodEnd: new Date(Date.now() + 27 * DAY),
      trialEndsAt: new Date(Date.now() - DAY),
    });
    const res = await request(app).post('/api/billing/withdraw').set(a.auth).send({ name: 'Anna Hansen', email: a.email }).expect(201);
    expect(res.body.refundDkk).toBe(49);
    expect(stripe.calls.map((c) => c.method)).toEqual(expect.arrayContaining(['subscriptions.cancel', 'refunds.create']));
    const receipt = mailTo(a.email).find((m) => /Kvittering for din fortrydelse/.test(m.subject))!;
    expect(receipt.text).toMatch(/Anna Hansen/);
    expect(receipt.text).toMatch(/Indsendt:/);
    expect(((await request(app).get('/api/auth/me').set(a.auth)).body as UserDTO).access.status).toBe('expired');

    // Efter fristen: registreres til manuel behandling og bekræftes stadig.
    const b = await register();
    await setUser(b.user.id, { subscriptionId: 'sub_old', subscriptionStatus: 'active', subscriptionStartedAt: new Date(Date.now() - 20 * DAY) });
    stripe.calls.length = 0;
    const late = await request(app).post('/api/billing/withdraw').set(b.auth).send({ name: 'Bo', email: b.email }).expect(201);
    expect(late.body.refundDkk).toBe(0);
    expect(stripe.calls.some((c) => c.method === 'subscriptions.cancel')).toBe(false);
    expect(mailTo('kontakt@tilbudsradar.test').some((m) => /manuel behandling/.test(m.subject))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Daglige mails                                                      */
/* ------------------------------------------------------------------ */

describe('cron-mails om prøveperioden', () => {
  it('sender "3 dage tilbage" og "slut" præcis én gang, og ikke til abonnenter', async () => {
    const soon = await register();
    const over = await register();
    const subscriber = await register();
    await setUser(soon.user.id, { trialEndsAt: new Date(Date.now() + 2.5 * DAY) });
    await setUser(over.user.id, { trialEndsAt: new Date(Date.now() - 0.5 * DAY) });
    await setUser(subscriber.user.id, {
      trialEndsAt: new Date(Date.now() + 2 * DAY),
      subscriptionId: 'sub_cron',
      subscriptionStatus: 'trialing',
      currentPeriodEnd: new Date(Date.now() + 2 * DAY),
    });
    testOutbox.length = 0;

    await runBillingCron(database.db);
    expect(mailTo(soon.email).map((m) => m.subject)).toEqual(['Din prøveperiode på Tilbudsradar slutter om 3 dage']);
    expect(mailTo(over.email).map((m) => m.subject)).toEqual(['Din prøveperiode på Tilbudsradar er slut']);
    expect(mailTo(subscriber.email)).toHaveLength(0);

    await runBillingCron(database.db);
    expect(mailTo(soon.email)).toHaveLength(1);
    expect(mailTo(over.email)).toHaveLength(1);
  });
});
