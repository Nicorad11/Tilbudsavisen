CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" text,
	"purchased_at" timestamp with time zone,
	"source" text NOT NULL,
	"total" double precision NOT NULL,
	"printed_total" double precision,
	"saved" double precision NOT NULL,
	"item_count" integer NOT NULL,
	"possible_errors" integer DEFAULT 0 NOT NULL,
	"possible_refund" double precision DEFAULT 0 NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_user_idx" ON "receipts" USING btree ("user_id","created_at");