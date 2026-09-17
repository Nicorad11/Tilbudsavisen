CREATE TABLE "community_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_votes" (
	"report_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "community_votes_report_id_user_id_pk" PRIMARY KEY("report_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meal_plan_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"meal_plan_id" integer NOT NULL,
	"day_index" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"servings" integer NOT NULL,
	"estimated_cost" double precision NOT NULL,
	"ingredients" jsonb NOT NULL,
	"steps" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"household_size" integer NOT NULL,
	"budget" double precision,
	"days" integer NOT NULL,
	"preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_by" text NOT NULL,
	"summary" text NOT NULL,
	"total_cost" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"watch_id" integer,
	"offer_id" integer,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"product_id" integer,
	"raw_offer_id" integer,
	"title" text NOT NULL,
	"description" text,
	"normalized_name" text NOT NULL,
	"brand" text,
	"category" text NOT NULL,
	"offer_price" double precision NOT NULL,
	"original_price" double precision,
	"unit" text NOT NULL,
	"quantity_min" double precision,
	"quantity_max" double precision,
	"pieces" integer DEFAULT 1 NOT NULL,
	"unit_price" double precision,
	"unit_price_max" double precision,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"image_url" text,
	"source_url" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"store_id" text NOT NULL,
	"observed_on" date NOT NULL,
	"price" double precision NOT NULL,
	"unit_price" double precision,
	"is_offer" boolean NOT NULL,
	"source_id" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"unit" text NOT NULL,
	"product_id" integer NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"brand" text,
	"ean" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"context" jsonb,
	"content_hash" text NOT NULL,
	"run_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"raw_count" integer DEFAULT 0 NOT NULL,
	"offers_found" integer DEFAULT 0 NOT NULL,
	"offers_saved" integer DEFAULT 0 NOT NULL,
	"baseline_saved" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"message" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "scrape_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"product_id" integer,
	"text" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"street" text,
	"city" text,
	"zip_code" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#8A8A8A' NOT NULL,
	"logo_url" text,
	"category" text DEFAULT 'supermarked' NOT NULL,
	"website" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"password_hash" text,
	"is_guest" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"preferred_store_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diet_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allergies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zip_code" text,
	"radius_km" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"product_id" integer,
	"target_price" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_report_id_community_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."community_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_recipes" ADD CONSTRAINT "meal_plan_recipes_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_watch_id_watchlist_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watchlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_raw_offer_id_raw_offers_id_fk" FOREIGN KEY ("raw_offer_id") REFERENCES "public"."raw_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_source_id_scrape_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."scrape_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_sources" ADD CONSTRAINT "scrape_sources_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_reports_user_offer_idx" ON "community_reports" USING btree ("offer_id","user_id");--> statement-breakpoint
CREATE INDEX "meal_plan_recipes_plan_idx" ON "meal_plan_recipes" USING btree ("meal_plan_id");--> statement-breakpoint
CREATE INDEX "meal_plans_user_idx" ON "meal_plans" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_watch_offer_idx" ON "notifications" USING btree ("watch_id","offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_source_ext_idx" ON "offers" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "offers_validity_idx" ON "offers" USING btree ("valid_to","valid_from");--> statement-breakpoint
CREATE INDEX "offers_product_idx" ON "offers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "offers_store_idx" ON "offers" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "offers_category_idx" ON "offers" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_point_idx" ON "price_history" USING btree ("product_id","store_id","observed_on","is_offer");--> statement-breakpoint
CREATE INDEX "price_history_product_idx" ON "price_history" USING btree ("product_id","observed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "product_aliases_alias_idx" ON "product_aliases" USING btree ("alias","unit");--> statement-breakpoint
CREATE UNIQUE INDEX "products_norm_unit_idx" ON "products" USING btree ("normalized_name","unit");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_offers_hash_idx" ON "raw_offers" USING btree ("source_id","external_id","content_hash");--> statement-breakpoint
CREATE INDEX "raw_offers_seen_idx" ON "raw_offers" USING btree ("source_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_source_idx" ON "scrape_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "shopping_list_items_list_idx" ON "shopping_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_user_idx" ON "shopping_lists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_locations_ext_idx" ON "store_locations" USING btree ("store_id","external_id");--> statement-breakpoint
CREATE INDEX "store_locations_zip_idx" ON "store_locations" USING btree ("zip_code");--> statement-breakpoint
CREATE INDEX "watchlist_user_idx" ON "watchlist" USING btree ("user_id");