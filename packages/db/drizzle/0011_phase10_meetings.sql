-- Phase 10: Meeting bots (Google Meet, Microsoft Teams, Zoom via Recall.ai).
-- Adds `meeting` to event_source so transcript chunks ride the existing
-- raw_events → extract → embed pipeline. Two new tables hold the structured
-- meeting/transcript record; a third (meeting_usage) tracks per-team minutes
-- for the monthly cost cap. team_meeting_settings is a sidecar to teams.
--
-- Idempotent webhook replay:
--   - meeting_transcript_chunks dedups on (meeting_id, provider_chunk_id).
--   - raw_events dedups on (team_id, source_metadata->>'meeting_chunk_provider_id').
-- Both partial indices skip rows that don't carry a provider id.

ALTER TYPE "public"."event_source" ADD VALUE IF NOT EXISTS 'meeting';--> statement-breakpoint

CREATE TYPE "public"."meeting_status" AS ENUM('pending','joining','active','processing','completed','failed');--> statement-breakpoint
CREATE TYPE "public"."meeting_platform" AS ENUM('meet','teams','zoom');--> statement-breakpoint

CREATE TABLE "meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "provider" text DEFAULT 'recall' NOT NULL,
  "provider_bot_id" text,
  "platform" "meeting_platform" NOT NULL,
  "meeting_url" text NOT NULL,
  "title" text,
  "status" "meeting_status" DEFAULT 'pending' NOT NULL,
  "default_visibility" "event_visibility" DEFAULT 'team' NOT NULL,
  "visibility_user_ids" uuid[],
  "participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_team_created_idx" ON "meetings" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "meetings_team_status_idx" ON "meetings" USING btree ("team_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_team_bot_unq" ON "meetings" USING btree ("team_id","provider_bot_id") WHERE "meetings"."provider_bot_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "meeting_transcript_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meeting_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "speaker" text,
  "text" text NOT NULL,
  "start_ms" integer NOT NULL,
  "end_ms" integer NOT NULL,
  "raw_event_id" uuid,
  "provider_chunk_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_transcript_chunks" ADD CONSTRAINT "meeting_transcript_chunks_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcript_chunks" ADD CONSTRAINT "meeting_transcript_chunks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcript_chunks" ADD CONSTRAINT "meeting_transcript_chunks_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_chunks_meeting_start_idx" ON "meeting_transcript_chunks" USING btree ("meeting_id","start_ms");--> statement-breakpoint
CREATE INDEX "meeting_chunks_team_idx" ON "meeting_transcript_chunks" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_chunks_provider_id_unq" ON "meeting_transcript_chunks" USING btree ("meeting_id","provider_chunk_id") WHERE "meeting_transcript_chunks"."provider_chunk_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "meeting_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "meeting_id" uuid NOT NULL,
  "minutes" integer NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_usage" ADD CONSTRAINT "meeting_usage_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_usage" ADD CONSTRAINT "meeting_usage_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_usage_team_recorded_idx" ON "meeting_usage" USING btree ("team_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_usage_meeting_unq" ON "meeting_usage" USING btree ("meeting_id");--> statement-breakpoint

CREATE TABLE "team_meeting_settings" (
  "team_id" uuid PRIMARY KEY NOT NULL,
  "meeting_minutes_cap" integer DEFAULT 600,
  "meeting_minutes_admin_override" boolean DEFAULT false NOT NULL,
  "require_host_consent" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_meeting_settings" ADD CONSTRAINT "team_meeting_settings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;

-- Note: the raw_events partial unique index that references the new
-- `meeting` enum value lives in migration 0012. Postgres rejects use of a
-- freshly-added enum value inside the same transaction
-- (ERROR 55P04: unsafe use of new value), so the index must run after this
-- migration commits.
