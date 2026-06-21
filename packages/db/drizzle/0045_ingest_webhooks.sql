ALTER TYPE "public"."event_source" ADD VALUE 'ingest_webhook';--> statement-breakpoint
CREATE TABLE "ingest_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"visibility_default" "event_visibility" DEFAULT 'team' NOT NULL,
	"proposal_generation_enabled" boolean DEFAULT true NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "ingest_webhook_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ingest_webhooks" ADD CONSTRAINT "ingest_webhooks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_webhooks" ADD CONSTRAINT "ingest_webhooks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_webhook_credentials" ADD CONSTRAINT "ingest_webhook_credentials_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_webhook_credentials" ADD CONSTRAINT "ingest_webhook_credentials_webhook_id_ingest_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."ingest_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_webhook_credentials" ADD CONSTRAINT "ingest_webhook_credentials_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_webhooks_team_idx" ON "ingest_webhooks" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ingest_webhooks_team_disabled_idx" ON "ingest_webhooks" USING btree ("team_id","disabled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_webhook_credentials_hash_unq" ON "ingest_webhook_credentials" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "ingest_webhook_credentials_team_idx" ON "ingest_webhook_credentials" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ingest_webhook_credentials_webhook_idx" ON "ingest_webhook_credentials" USING btree ("webhook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_ingest_webhook_dedup_unq" ON "raw_events" USING btree ("team_id", (("source_metadata" ->> 'ingest_webhook_dedup_key'))) WHERE "raw_events"."source_metadata" ? 'ingest_webhook_dedup_key';
