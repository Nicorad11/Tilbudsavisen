/**
 * Opretter (eller finder) alt i Stripe, som Tilbudsradar skal bruge, og
 * udskriver de id'er der skal i .env. Kan køres igen uden at lave dubletter.
 *
 *   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup
 *   STRIPE_SECRET_KEY=sk_live_… APP_URL=https://tilbudsradar.dk npm run stripe:setup -- --tax
 *
 * --tax  opretter også en 25 % moms-sats (inklusiv), så fakturaerne viser momsen.
 *        Brug den først, når virksomheden er momsregistreret.
 */
import { PLAN } from '@tilbudsradar/shared';
import Stripe from 'stripe';
import { env } from '../env';

const PRODUCT_ID = 'tilbudsradar';
const LOOKUP_KEY = `tilbudsradar_maaned_${PLAN.priceDkk}`;
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

if (!env.STRIPE_SECRET_KEY) {
  console.error('Sæt STRIPE_SECRET_KEY (sk_test_… til test, sk_live_… til produktion) og kør igen.');
  process.exit(1);
}
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const live = env.STRIPE_SECRET_KEY.startsWith('sk_live_') || env.STRIPE_SECRET_KEY.startsWith('rk_live_');
const https = env.APP_URL.startsWith('https://');
const out: Record<string, string> = {};

console.log(`Stripe ${live ? 'LIVE' : 'test'}-konto · APP_URL=${env.APP_URL}\n`);

// 1. Produkt (fast id gør det idempotent)
let product: Stripe.Product;
try {
  product = await stripe.products.retrieve(PRODUCT_ID);
  console.log(`✓ Produkt findes: ${product.id}`);
} catch {
  product = await stripe.products.create({
    id: PRODUCT_ID,
    name: 'Tilbudsradar',
    description: 'Indkøbslister med butiks-splitting, prisalarmer, kvitteringsscanner, prishistorik og community-vurderinger.',
    statement_descriptor: 'TILBUDSRADAR',
    tax_code: 'txcd_10103000', // SaaS – personligt brug
  });
  console.log(`+ Produkt oprettet: ${product.id}`);
}

// 2. Månedlig pris i DKK inkl. moms (lookup_key gør det idempotent)
const prices = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
let price = prices.data[0];
if (price) {
  console.log(`✓ Pris findes: ${price.id} (${price.unit_amount! / 100} ${price.currency.toUpperCase()}/md)`);
} else {
  price = await stripe.prices.create({
    product: product.id,
    currency: 'dkk',
    unit_amount: PLAN.priceDkk * 100,
    recurring: { interval: 'month' },
    tax_behavior: 'inclusive',
    lookup_key: LOOKUP_KEY,
    nickname: `${PLAN.priceDkk} kr/md inkl. moms`,
  });
  console.log(`+ Pris oprettet: ${price.id}`);
}
out.STRIPE_PRICE_ID = price.id;

// 3. Moms-sats (valgfri)
if (process.argv.includes('--tax')) {
  const rates = await stripe.taxRates.list({ active: true, inclusive: true, limit: 100 });
  let rate = rates.data.find((r) => r.percentage === 25 && r.country === 'DK' && r.metadata?.app === 'tilbudsradar');
  if (rate) console.log(`✓ Moms-sats findes: ${rate.id}`);
  else {
    rate = await stripe.taxRates.create({
      display_name: 'Moms',
      description: 'Dansk moms 25 %',
      percentage: 25,
      inclusive: true,
      country: 'DK',
      jurisdiction: 'DK',
      tax_type: 'vat',
      metadata: { app: 'tilbudsradar' },
    });
    console.log(`+ Moms-sats oprettet: ${rate.id}`);
  }
  out.STRIPE_TAX_RATE_ID = rate.id;
}

// 4. Kundeportal: opsigelse ved periodens udløb, opdatering af kort og fakturahistorik
const portalParams: Stripe.BillingPortal.ConfigurationCreateParams = {
  name: 'Tilbudsradar',
  business_profile: {
    headline: 'Tilbudsradar – administrér dit abonnement',
    ...(https
      ? { privacy_policy_url: `${env.APP_URL}/privatlivspolitik`, terms_of_service_url: `${env.APP_URL}/handelsbetingelser` }
      : {}),
  },
  default_return_url: `${env.APP_URL}/app/konto#abonnement`,
  features: {
    // E-mailen styres i Tilbudsradar (med bekræftelse), så den kan ikke ændres i portalen.
    customer_update: { enabled: false },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',
      proration_behavior: 'none',
      cancellation_reason: {
        enabled: true,
        options: ['too_expensive', 'missing_features', 'unused', 'switched_service', 'other'],
      },
    },
    subscription_update: { enabled: false },
  },
  metadata: { app: 'tilbudsradar' },
};
const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
const existingPortal = configs.data.find((c) => c.metadata?.app === 'tilbudsradar');
const { metadata: _m, ...updatable } = portalParams;
const portal = existingPortal
  ? await stripe.billingPortal.configurations.update(existingPortal.id, updatable)
  : await stripe.billingPortal.configurations.create(portalParams);
console.log(`${existingPortal ? '✓ Portal opdateret' : '+ Portal oprettet'}: ${portal.id}`);
out.STRIPE_PORTAL_CONFIG_ID = portal.id;

// 5. Webhook – kun mod en offentlig https-adresse (lokalt bruges `stripe listen`)
if (https) {
  const url = `${env.APP_URL}/api/billing/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = endpoints.data.find((e) => e.url === url);
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events: WEBHOOK_EVENTS });
    console.log(`✓ Webhook findes: ${existing.id} – signeringsnøglen (whsec_…) står i Stripe Dashboard → Udviklere → Webhooks.`);
  } else {
    const created = await stripe.webhookEndpoints.create({
      url,
      enabled_events: WEBHOOK_EVENTS,
      api_version: Stripe.API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
      description: 'Tilbudsradar',
    });
    console.log(`+ Webhook oprettet: ${created.id}`);
    if (created.secret) out.STRIPE_WEBHOOK_SECRET = created.secret;
  }
} else {
  console.log('· Webhook springes over (APP_URL er ikke https). Lokalt: stripe listen --forward-to localhost:4000/api/billing/webhook');
}

console.log('\nSæt disse i .env / Render:\n');
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
console.log('');
