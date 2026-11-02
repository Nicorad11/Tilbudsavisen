CREATE TABLE "gsc_inspection_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_metrics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"search_type" text NOT NULL,
	"country" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_sitemaps" (
	"path" text PRIMARY KEY NOT NULL,
	"last_submitted" timestamp with time zone,
	"last_downloaded" timestamp with time zone,
	"is_pending" boolean DEFAULT false NOT NULL,
	"is_index" boolean DEFAULT false NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"warnings" integer DEFAULT 0 NOT NULL,
	"submitted" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"inspected" integer DEFAULT 0 NOT NULL,
	"range_start" date,
	"range_end" date,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "gsc_url_inspections" (
	"url" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"in_sitemap" boolean DEFAULT true NOT NULL,
	"inspected_at" timestamp with time zone,
	"verdict" text,
	"coverage_state" text,
	"robots_txt_state" text,
	"indexing_state" text,
	"page_fetch_state" text,
	"last_crawl_time" timestamp with time zone,
	"google_canonical" text,
	"user_canonical" text,
	"crawled_as" text,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "gsc_inspection_calls_at_idx" ON "gsc_inspection_calls" USING btree ("called_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_metrics_key_idx" ON "gsc_metrics" USING btree ("date","kind","search_type","country","query","page","device");--> statement-breakpoint
CREATE INDEX "gsc_metrics_kind_date_idx" ON "gsc_metrics" USING btree ("kind","search_type","country","date");--> statement-breakpoint
CREATE INDEX "gsc_sync_runs_started_idx" ON "gsc_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "gsc_url_inspections_inspected_idx" ON "gsc_url_inspections" USING btree ("inspected_at");