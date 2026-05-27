CREATE TYPE "public"."agent_suggestion_item_status" AS ENUM('pending', 'accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_suggestion_operation" AS ENUM('create', 'update', 'archive_or_cancel');--> statement-breakpoint
CREATE TYPE "public"."agent_suggestion_source" AS ENUM('chat', 'background');--> statement-breakpoint
CREATE TYPE "public"."agent_suggestion_status" AS ENUM('pending', 'partially_resolved', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."agent_suggestion_target_kind" AS ENUM('object', 'task', 'calendar_event');--> statement-breakpoint
ALTER TABLE "team_calendar_settings" ADD COLUMN "default_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
CREATE TABLE "agent_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"source" "agent_suggestion_source" NOT NULL,
	"status" "agent_suggestion_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"reason" text,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"dedupe_key" text NOT NULL,
	"visibility" "event_visibility" DEFAULT 'team' NOT NULL,
	"visibility_owner_user_id" uuid,
	"visibility_user_ids" uuid[],
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_suggestion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"status" "agent_suggestion_item_status" DEFAULT 'pending' NOT NULL,
	"operation" "agent_suggestion_operation" NOT NULL,
	"target_kind" "agent_suggestion_target_kind" NOT NULL,
	"target_id" uuid,
	"result_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"dedupe_key" text NOT NULL,
	"proposed_payload" jsonb NOT NULL,
	"failure_reason" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_suggestion_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"quote" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "agent_suggestion_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "agent_suggestion_item_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_visibility_owner_user_id_users_id_fk" FOREIGN KEY ("visibility_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestion_items" ADD CONSTRAINT "agent_suggestion_items_suggestion_id_agent_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."agent_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestion_items" ADD CONSTRAINT "agent_suggestion_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestion_items" ADD CONSTRAINT "agent_suggestion_items_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestion_evidence" ADD CONSTRAINT "agent_suggestion_evidence_suggestion_id_agent_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."agent_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestion_evidence" ADD CONSTRAINT "agent_suggestion_evidence_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_suggestion_evidence" ADD CONSTRAINT "agent_suggestion_evidence_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agent_suggestion_id_agent_suggestions_id_fk" FOREIGN KEY ("agent_suggestion_id") REFERENCES "public"."agent_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agent_suggestion_item_id_agent_suggestion_items_id_fk" FOREIGN KEY ("agent_suggestion_item_id") REFERENCES "public"."agent_suggestion_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_suggestions_team_dedupe_unq" ON "agent_suggestions" USING btree ("team_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "agent_suggestions_team_status_idx" ON "agent_suggestions" USING btree ("team_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_suggestions_team_visibility_owner_idx" ON "agent_suggestions" USING btree ("team_id","visibility_owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_suggestion_items_suggestion_dedupe_unq" ON "agent_suggestion_items" USING btree ("suggestion_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "agent_suggestion_items_team_status_idx" ON "agent_suggestion_items" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "agent_suggestion_items_team_target_idx" ON "agent_suggestion_items" USING btree ("team_id","target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_suggestion_evidence_suggestion_event_unq" ON "agent_suggestion_evidence" USING btree ("suggestion_id","raw_event_id");--> statement-breakpoint
CREATE INDEX "agent_suggestion_evidence_team_event_idx" ON "agent_suggestion_evidence" USING btree ("team_id","raw_event_id");--> statement-breakpoint
CREATE INDEX "agent_suggestion_evidence_quote_idx" ON "agent_suggestion_evidence" USING gin (to_tsvector('simple', "quote"));--> statement-breakpoint
CREATE INDEX "notifications_team_suggestion_idx" ON "notifications" USING btree ("team_id","agent_suggestion_id");
