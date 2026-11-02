CREATE TABLE "admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_id" uuid,
	"admin_email" text,
	"action" text NOT NULL,
	"customer_id" uuid,
	"target_id" text,
	"status" integer NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_customer_idx" ON "admin_audit_log" USING btree ("customer_id","created_at");