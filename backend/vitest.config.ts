import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Testnøgler – Stripe-kald går til en falsk klient, og signaturer laves med Stripes testhjælper.
    env: {
      APP_URL: 'https://tilbudsradar.test',
      STRIPE_SECRET_KEY: 'sk_test_unused',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
      STRIPE_PRICE_ID: 'price_test_49',
      CONTACT_EMAIL: 'kontakt@tilbudsradar.test',
    },
  },
});
