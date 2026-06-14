CREATE TYPE "public"."daily_digest_status" AS ENUM('generated', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('email', 'in_app_digest');--> statement-breakpoint
CREATE TYPE "public"."message_delivery_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."message_intent" AS ENUM('team_invite', 'support_request', 'welcome', 'email_verification', 'daily_digest');--> statement-breakpoint
CREATE TABLE "message_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intent" "message_intent" NOT NULL,
  "channel" "message_channel" NOT NULL,
  "team_id" uuid,
  "user_id" uuid,
  "recipient_email" text,
  "subject" text,
  "status" "message_delivery_status" DEFAULT 'pending' NOT NULL,
  "provider" text,
  "provider_message_id" text,
  "error" text,
  "dedupe_key" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_digests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "summary" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "daily_digest_status" DEFAULT 'generated' NOT NULL,
  "delivery_id" uuid,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "error" text
);
--> statement-breakpoint
CREATE TABLE "message_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid,
  "user_id" uuid,
  "daily_digest_enabled" boolean DEFAULT true NOT NULL,
  "daily_digest_hour" integer DEFAULT 12 NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_digests" ADD CONSTRAINT "daily_digests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_digests" ADD CONSTRAINT "daily_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_digests" ADD CONSTRAINT "daily_digests_delivery_id_message_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."message_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_preferences" ADD CONSTRAINT "message_preferences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_preferences" ADD CONSTRAINT "message_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_deliveries_team_created_idx" ON "message_deliveries" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "message_deliveries_user_created_idx" ON "message_deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "message_deliveries_intent_status_idx" ON "message_deliveries" USING btree ("intent","status");--> statement-breakpoint
CREATE UNIQUE INDEX "message_deliveries_dedupe_unq" ON "message_deliveries" USING btree ("dedupe_key") WHERE "message_deliveries"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "daily_digests_team_user_generated_idx" ON "daily_digests" USING btree ("team_id","user_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_digests_team_user_window_unq" ON "daily_digests" USING btree ("team_id","user_id","window_start","window_end");--> statement-breakpoint
CREATE UNIQUE INDEX "message_preferences_team_user_unq" ON "message_preferences" USING btree ("team_id","user_id") WHERE "message_preferences"."team_id" IS NOT NULL AND "message_preferences"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_preferences_team_idx" ON "message_preferences" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "message_preferences_user_idx" ON "message_preferences" USING btree ("user_id");
