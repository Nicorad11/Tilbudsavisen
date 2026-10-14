import { describe, expect, it } from 'vitest';
import { productionProblems, type RawEnv } from '../src/env';
import { computeAccess, type AccessUser } from '../src/services/access';
import { normalizeEmailForTrial, trialEmailHash } from '../src/services/trial';

const now = new Date('2026-10-08T12:00:00Z');
const day = 86_400_000;
const at = (days: number) => new Date(now.getTime() + days * day);

const base: AccessUser = {
  isGuest: false,
  role: 'user',
  email: 'a@example.dk',
  trialEndsAt: null,
  subscriptionId: null,
  subscriptionStatus: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  subscriptionStartedAt: null,
  paymentFailedAt: null,
};
const access = (u: Partial<AccessUser> | null) => computeAccess(u ? { ...base, ...u } : null, { now, graceDays: 5 });

describe('computeAccess', () => {
  it('free: ikke logget ind eller gæst', () => {
    expect(access(null)).toMatchObject({ status: 'free', hasAccess: false });
    expect(access({ isGuest: true, trialEndsAt: at(10) })).toMatchObject({ status: 'free', hasAccess: false });
  });

  it('trial: i prøveperioden, med dage tilbage', () => {
    expect(access({ trialEndsAt: at(3.2) })).toMatchObject({ status: 'trial', hasAccess: true, trialDaysLeft: 4, trialUsed: true });
  });

  it('expired: prøveperioden er slut, eller den er brugt på e-mailen', () => {
    expect(access({ trialEndsAt: at(-1) })).toMatchObject({ status: 'expired', hasAccess: false, trialUsed: true, trialDaysLeft: null });
    expect(access({})).toMatchObject({ status: 'expired', hasAccess: false, trialUsed: false });
  });

  it('active: løbende abonnement med næste betaling og fortrydelsesfrist', () => {
    const a = access({
      subscriptionId: 'sub_1',
      subscriptionStatus: 'active',
      currentPeriodEnd: at(20),
      subscriptionStartedAt: at(-10),
    });
    expect(a).toMatchObject({ status: 'active', hasAccess: true, subscribed: true, nextPaymentAt: at(20).toISOString() });
    expect(a.withdrawableUntil).toBe(at(4).toISOString());
    expect(access({ subscriptionId: 'sub_1', subscriptionStatus: 'active', currentPeriodEnd: at(20), subscriptionStartedAt: at(-15) }).withdrawableUntil).toBeNull();
  });

  it('active: Stripes "trialing" (første træk udskudt) og kort slæk ved fornyelse', () => {
    expect(access({ subscriptionId: 's', subscriptionStatus: 'trialing', currentPeriodEnd: at(5) })).toMatchObject({ status: 'active', nextPaymentAt: at(5).toISOString() });
    expect(access({ subscriptionId: 's', subscriptionStatus: 'active', currentPeriodEnd: at(-1) }).status).toBe('active');
    expect(access({ subscriptionId: 's', subscriptionStatus: 'active', currentPeriodEnd: at(-3) }).status).toBe('expired');
  });

  it('past_due: adgang i henstanden, derefter udløbet', () => {
    const inGrace = access({ subscriptionId: 's', subscriptionStatus: 'past_due', currentPeriodEnd: at(29), paymentFailedAt: at(-2) });
    expect(inGrace).toMatchObject({ status: 'past_due', hasAccess: true, graceEndsAt: at(3).toISOString() });
    const after = access({ subscriptionId: 's', subscriptionStatus: 'past_due', currentPeriodEnd: at(29), paymentFailedAt: at(-6) });
    expect(after).toMatchObject({ status: 'expired', hasAccess: false });
  });

  it('canceled: opsagt men betalt periode løber stadig', () => {
    const c = access({ subscriptionId: 's', subscriptionStatus: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: at(9) });
    expect(c).toMatchObject({ status: 'canceled', hasAccess: true, nextPaymentAt: null, cancelAtPeriodEnd: true });
    expect(access({ subscriptionId: 's', subscriptionStatus: 'canceled', currentPeriodEnd: at(2) })).toMatchObject({ status: 'canceled', hasAccess: true });
    expect(access({ subscriptionId: 's', subscriptionStatus: 'canceled', currentPeriodEnd: at(-1) })).toMatchObject({ status: 'expired', hasAccess: false });
  });

  it('udløbet abonnement falder tilbage på en aktiv prøveperiode', () => {
    expect(access({ subscriptionId: 's', subscriptionStatus: 'incomplete_expired', trialEndsAt: at(2) }).status).toBe('trial');
    expect(access({ subscriptionId: 's', subscriptionStatus: 'unpaid', currentPeriodEnd: at(10) }).status).toBe('expired');
  });

  it('administratorer har altid fuld adgang', () => {
    expect(access({ role: 'admin' })).toMatchObject({ status: 'active', hasAccess: true, isAdmin: true });
  });
});

describe('én prøveperiode pr. e-mail', () => {
  it('normaliserer store bogstaver, +tags og Gmail-punktummer', () => {
    expect(normalizeEmailForTrial(' Anna.Hansen+tilbud@GMAIL.com ')).toBe('annahansen@gmail.com');
    expect(normalizeEmailForTrial('anna.hansen@googlemail.com')).toBe('annahansen@gmail.com');
    expect(normalizeEmailForTrial('anna.hansen+x@firma.dk')).toBe('anna.hansen@firma.dk');
    expect(trialEmailHash('a.b@gmail.com')).toBe(trialEmailHash('ab+test@gmail.com'));
    expect(trialEmailHash('a.b@firma.dk')).not.toBe(trialEmailHash('ab@firma.dk'));
  });
});

describe('produktionstjek', () => {
  const raw = { NODE_ENV: 'production', APP_URL: 'https://tilbudsradaren.dk', JWT_SECRET: 'x'.repeat(40), COOKIE_SAMESITE: 'lax' } as RawEnv;

  it('stopper opstarten, når nøgler mangler', () => {
    const problems = productionProblems(raw, { APP_URL: 'https://tilbudsradaren.dk' });
    for (const key of ['DATABASE_URL', 'ADMIN_EMAILS']) expect(problems).toContain(`${key} mangler`);
    // Betaling og e-mail kan komme senere.
    expect(problems.join()).not.toMatch(/STRIPE|SMTP/);
  });

  it('kræver Stripe-nøglerne samlet', () => {
    const base = { DATABASE_URL: 'postgres://x', APP_URL: 'https://tilbudsradaren.dk', ADMIN_EMAILS: 'a@b.dk' };
    const problems = productionProblems({ ...raw, STRIPE_SECRET_KEY: 'sk_live_x' }, { ...base, STRIPE_SECRET_KEY: 'sk_live_x' });
    expect(problems).toContain('STRIPE_WEBHOOK_SECRET mangler (de tre Stripe-nøgler skal sættes samlet)');
    expect(problems).toContain('STRIPE_PRICE_ID mangler (de tre Stripe-nøgler skal sættes samlet)');
    expect(productionProblems(raw, base)).toEqual([]);
  });

  it('godkender en komplet konfiguration og ignorerer udvikling', () => {
    const full = {
      DATABASE_URL: 'postgres://x',
      APP_URL: 'https://tilbudsradaren.dk',
      SMTP_URL: 'smtps://x',
      STRIPE_SECRET_KEY: 'sk_live_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_PRICE_ID: 'price_x',
      ADMIN_EMAILS: 'a@b.dk',
    };
    expect(
      productionProblems({ ...raw, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ID: 'price_x' }, full),
    ).toEqual([]);
    expect(productionProblems({ ...raw, NODE_ENV: 'development' }, {})).toEqual([]);
    expect(productionProblems({ ...raw, JWT_SECRET: 'kort' }, full)).toContain('JWT_SECRET skal være en tilfældig streng på mindst 32 tegn');
  });
});
