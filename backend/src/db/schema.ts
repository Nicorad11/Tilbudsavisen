import type { ReceiptLine } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ------------------------------------------------------------------ */
/* Kæder, filialer og kilder                                          */
/* ------------------------------------------------------------------ */

/** Kæder. `enabled` er feature-flaget der slår en kæde helt fra. */
export const stores = pgTable('stores', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#8A8A8A'),
  logoUrl: text('logo_url'),
  category: text('category').notNull().default('supermarked'),
  website: text('website'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});

/** Fysiske butikker (geolokation) pr. kæde. */
export const storeLocations = pgTable(
  'store_locations',
  {
    id: serial('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    street: text('street'),
    city: text('city'),
    zipCode: text('zip_code'),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('store_locations_ext_idx').on(t.storeId, t.externalId),
    index('store_locations_zip_idx').on(t.zipCode),
  ],
);

/** Hver scraper-kilde kan slås fra individuelt. */
export const scrapeSources = pgTable('scrape_sources', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: ts('last_run_at'),
  lastSuccessAt: ts('last_success_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

export const scrapeRuns = pgTable(
  'scrape_runs',
  {
    id: serial('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => scrapeSources.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull().default('manual'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    status: text('status').notNull().default('running'),
    rawCount: integer('raw_count').notNull().default(0),
    offersFound: integer('offers_found').notNull().default(0),
    offersSaved: integer('offers_saved').notNull().default(0),
    baselineSaved: integer('baseline_saved').notNull().default(0),
    rejected: integer('rejected').notNull().default(0),
    message: text('message'),
    durationMs: integer('duration_ms'),
  },
  (t) => [index('scrape_runs_source_idx').on(t.sourceId, t.startedAt)],
);

/**
 * Rå data præcis som kilden leverede dem. Unik pr. indholds-hash, så uændrede
 * data ikke gemmes igen – men historikken kan altid re-processeres.
 */
export const rawOffers = pgTable(
  'raw_offers',
  {
    id: serial('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    context: jsonb('context'),
    contentHash: text('content_hash').notNull(),
    runId: integer('run_id'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_offers_hash_idx').on(t.sourceId, t.externalId, t.contentHash),
    index('raw_offers_seen_idx').on(t.sourceId, t.lastSeenAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Kanoniske varer og tilbud                                          */
/* ------------------------------------------------------------------ */

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** Kernenavn uden mærke og mængde – nøglen der matches på. */
    normalizedName: text('normalized_name').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull(),
    brand: text('brand'),
    ean: text('ean'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('products_norm_unit_idx').on(t.normalizedName, t.unit)],
);

/** Manuel (og lært) mapping fra et normaliseret navn til en kanonisk vare. */
export const productAliases = pgTable(
  'product_aliases',
  {
    id: serial('id').primaryKey(),
    alias: text('alias').notNull(),
    unit: text('unit').notNull(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('auto'),
    score: real('score'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('product_aliases_alias_idx').on(t.alias, t.unit)],
);

export const offers = pgTable(
  'offers',
  {
    id: serial('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    externalId: text('external_id').notNull(),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    rawOfferId: integer('raw_offer_id').references(() => rawOffers.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    normalizedName: text('normalized_name').notNull(),
    brand: text('brand'),
    category: text('category').notNull(),
    offerPrice: doublePrecision('offer_price').notNull(),
    originalPrice: doublePrecision('original_price'),
    unit: text('unit').notNull(),
    quantityMin: doublePrecision('quantity_min'),
    quantityMax: doublePrecision('quantity_max'),
    pieces: integer('pieces').notNull().default(1),
    unitPrice: doublePrecision('unit_price'),
    unitPriceMax: doublePrecision('unit_price_max'),
    validFrom: ts('valid_from').notNull(),
    validTo: ts('valid_to').notNull(),
    imageUrl: text('image_url'),
    sourceUrl: text('source_url').notNull(),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('offers_source_ext_idx').on(t.sourceId, t.externalId),
    index('offers_validity_idx').on(t.validTo, t.validFrom),
    index('offers_product_idx').on(t.productId),
    index('offers_store_idx').on(t.storeId),
    index('offers_category_idx').on(t.category),
  ],
);

/** Tidsserie pr. vare/butik/dag. is_offer=false er normal hyldepris. */
export const priceHistory = pgTable(
  'price_history',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    observedOn: date('observed_on', { mode: 'string' }).notNull(),
    price: doublePrecision('price').notNull(),
    unitPrice: doublePrecision('unit_price'),
    isOffer: boolean('is_offer').notNull(),
    sourceId: text('source_id').notNull(),
    synthetic: boolean('synthetic').notNull().default(false),
  },
  (t) => [
    uniqueIndex('price_history_point_idx').on(t.productId, t.storeId, t.observedOn, t.isOffer),
    index('price_history_product_idx').on(t.productId, t.observedOn),
  ],
);

/* ------------------------------------------------------------------ */
/* Brugere                                                            */
/* ------------------------------------------------------------------ */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  isGuest: boolean('is_guest').notNull().default(false),
  role: text('role').notNull().default('user'),
  preferredStoreIds: jsonb('preferred_store_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  dietPreferences: jsonb('diet_preferences').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  allergies: jsonb('allergies').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  zipCode: text('zip_code'),
  radiusKm: integer('radius_km'),
  createdAt: createdAt(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId)],
);

export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('shopping_lists_user_idx').on(t.userId)],
);

export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: serial('id').primaryKey(),
    listId: integer('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    quantity: integer('quantity').notNull().default(1),
    checked: boolean('checked').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('shopping_list_items_list_idx').on(t.listId)],
);

/* ------------------------------------------------------------------ */
/* Community, watchlist, madplaner                                    */
/* ------------------------------------------------------------------ */

export const communityReports = pgTable(
  'community_reports',
  {
    id: serial('id').primaryKey(),
    offerId: integer('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verdict: text('verdict').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('community_reports_user_offer_idx').on(t.offerId, t.userId)],
);

export const communityVotes = pgTable(
  'community_votes',
  {
    reportId: integer('report_id')
      .notNull()
      .references(() => communityReports.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: integer('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.userId] })],
);

export const watchlist = pgTable(
  'watchlist',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    targetPrice: doublePrecision('target_price').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('watchlist_user_idx').on(t.userId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchId: integer('watch_id').references(() => watchlist.id, { onDelete: 'cascade' }),
    offerId: integer('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    message: text('message').notNull(),
    createdAt: createdAt(),
    readAt: ts('read_at'),
    emailedAt: ts('emailed_at'),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_watch_offer_idx').on(t.watchId, t.offerId),
  ],
);

/**
 * Madplan-funktionen er fjernet fra appen for nu. Tabellerne bevares, så gemte
 * planer ikke går tabt, og de er stadig med i GDPR-udtræk og -sletning.
 */
export const mealPlans = pgTable(
  'meal_plans',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdSize: integer('household_size').notNull(),
    budget: doublePrecision('budget'),
    days: integer('days').notNull(),
    preferences: jsonb('preferences').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    generatedBy: text('generated_by').notNull(),
    summary: text('summary').notNull(),
    totalCost: doublePrecision('total_cost').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('meal_plans_user_idx').on(t.userId, t.createdAt)],
);

export interface StoredIngredient {
  name: string;
  amount: string;
  offerId: number | null;
  price: number | null;
  storeName: string | null;
}

export const mealPlanRecipes = pgTable(
  'meal_plan_recipes',
  {
    id: serial('id').primaryKey(),
    mealPlanId: integer('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    dayIndex: integer('day_index').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    servings: integer('servings').notNull(),
    estimatedCost: doublePrecision('estimated_cost').notNull(),
    ingredients: jsonb('ingredients').$type<StoredIngredient[]>().notNull(),
    steps: jsonb('steps').$type<string[]>().notNull(),
  },
  (t) => [index('meal_plan_recipes_plan_idx').on(t.mealPlanId)],
);

/* ------------------------------------------------------------------ */
/* Kvitteringer                                                       */
/* ------------------------------------------------------------------ */

/**
 * Scannede kvitteringer. Billedet gemmes aldrig – kun linjerne, så tjekket kan
 * genberegnes. Summerne er et øjebliksbillede til oversigten.
 */
export const receipts = pgTable(
  'receipts',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storeId: text('store_id').references(() => stores.id, { onDelete: 'set null' }),
    purchasedAt: ts('purchased_at'),
    source: text('source').notNull(),
    total: doublePrecision('total').notNull(),
    printedTotal: doublePrecision('printed_total'),
    saved: doublePrecision('saved').notNull(),
    itemCount: integer('item_count').notNull(),
    possibleErrors: integer('possible_errors').notNull().default(0),
    possibleRefund: doublePrecision('possible_refund').notNull().default(0),
    lines: jsonb('lines').$type<ReceiptLine[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('receipts_user_idx').on(t.userId, t.createdAt)],
);
