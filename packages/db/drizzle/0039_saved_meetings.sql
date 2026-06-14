-- Saved meetings + quick meeting capture confirmations.

ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'completed_partial';
ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'skipped';
ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'no_show';
ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'cancelled';

DO $$ BEGIN
  CREATE TYPE "public"."meeting_capture_confirmation_status" AS ENUM (
    'pending',
    'confirmed',
    'cancelled',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."meeting_capture_confirmation_source" AS ENUM (
    'slack',
    'telegram',
    'web'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "saved_meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "description" text,
  "platform" "meeting_platform" NOT NULL,
  "meeting_url" text NOT NULL,
  "default_visibility" "event_visibility" NOT NULL DEFAULT 'team',
  "visibility_user_ids" uuid[],
  "permission_confirmed_at" timestamp with time zone NOT NULL,
  "permission_confirmed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "schedule_config" jsonb,
  "duration_minutes" integer NOT NULL DEFAULT 30,
  "auto_join_enabled" boolean NOT NULL DEFAULT false,
  "auto_join_paused_at" timestamp with time zone,
  "auto_join_paused_reason" text,
  "consecutive_failure_count" integer NOT NULL DEFAULT 0,
  "archived_at" timestamp with time zone,
  "archived_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "saved_meetings_team_active_idx"
  ON "saved_meetings" ("team_id", "archived_at");

CREATE INDEX IF NOT EXISTS "saved_meetings_team_auto_join_idx"
  ON "saved_meetings" ("team_id", "auto_join_enabled");

CREATE TABLE IF NOT EXISTS "saved_meeting_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "saved_meeting_id" uuid NOT NULL REFERENCES "saved_meetings"("id") ON DELETE CASCADE,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "alias" text NOT NULL,
  "normalized_alias" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "saved_meeting_aliases_team_norm_unq"
  ON "saved_meeting_aliases" ("team_id", "normalized_alias");

CREATE INDEX IF NOT EXISTS "saved_meeting_aliases_saved_idx"
  ON "saved_meeting_aliases" ("saved_meeting_id");

ALTER TABLE "meetings"
  ADD COLUMN IF NOT EXISTS "saved_meeting_id" uuid REFERENCES "saved_meetings"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "scheduled_start_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "scheduled_end_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "linked_calendar_event_id" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "meetings_team_saved_scheduled_unq"
  ON "meetings" ("team_id", "saved_meeting_id", "scheduled_start_at")
  WHERE "saved_meeting_id" IS NOT NULL AND "scheduled_start_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "meetings_team_calendar_idx"
  ON "meetings" ("team_id", "linked_calendar_event_id");

CREATE TABLE IF NOT EXISTS "meeting_capture_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source" "meeting_capture_confirmation_source" NOT NULL,
  "status" "meeting_capture_confirmation_status" NOT NULL DEFAULT 'pending',
  "platform" "meeting_platform" NOT NULL,
  "meeting_url" text NOT NULL,
  "title" text,
  "default_visibility" "event_visibility" NOT NULL DEFAULT 'team',
  "visibility_user_ids" uuid[],
  "source_context" jsonb NOT NULL DEFAULT '{}',
  "meeting_id" uuid REFERENCES "meetings"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meeting_capture_confirmations_team_status_idx"
  ON "meeting_capture_confirmations" ("team_id", "status");

CREATE INDEX IF NOT EXISTS "meeting_capture_confirmations_expires_idx"
  ON "meeting_capture_confirmations" ("expires_at");
