-- Phase 11 — Calendar tables.
--
-- Three tables:
--   calendar_events       — first-class calendar events (not entities)
--   calendar_event_entities — explicit links between events and entities
--   team_calendar_settings — per-team sidecar (PK = team_id)
--
-- Also adds 'calendar' to the event_source enum so raw_events can carry
-- source='calendar' rows.
--
-- The raw_events partial unique index that references the new 'calendar'
-- enum value lives in a separate migration (0018) because Postgres rejects
-- use of a freshly-added enum value inside the same transaction (55P04).

-- Extend event_source with 'calendar'.
ALTER TYPE "public"."event_source" ADD VALUE IF NOT EXISTS 'calendar';

-- Calendar event source (internal vs imported).
DO $$ BEGIN
  CREATE TYPE "public"."calendar_event_source" AS ENUM ('internal', 'google', 'caldav');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Main calendar events table.
CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id"                uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "created_by_user_id"     uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "title"                  text NOT NULL,
  "description"            text,
  "start_at"               timestamp with time zone NOT NULL,
  "end_at"                 timestamp with time zone NOT NULL,
  "timezone"               text NOT NULL DEFAULT 'UTC',
  "all_day"                boolean NOT NULL DEFAULT false,
  "location"               text,
  "show_as"                text NOT NULL DEFAULT 'busy',
  "visibility"             "event_visibility" NOT NULL DEFAULT 'team',
  "visibility_user_ids"    uuid[],
  "recurring_parent_id"    uuid REFERENCES "calendar_events"("id") ON DELETE CASCADE,
  "original_start_at"      timestamp with time zone,
  "is_exception"           boolean NOT NULL DEFAULT false,
  "rrule"                  text,
  "reminder_minutes"       integer,
  "source"                 "calendar_event_source" NOT NULL DEFAULT 'internal',
  "external_calendar_id"   uuid,
  "external_event_id"      text,
  "agent_suggested"        boolean NOT NULL DEFAULT false,
  "metadata"               jsonb NOT NULL DEFAULT '{}',
  "scheduled_raw_event_id" uuid,
  "start_at_raw_event_id"  uuid,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"             timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "calendar_events_team_start_idx"
  ON "calendar_events" ("team_id", "start_at");

CREATE INDEX IF NOT EXISTS "calendar_events_team_created_idx"
  ON "calendar_events" ("team_id", "created_at");

CREATE INDEX IF NOT EXISTS "calendar_events_team_parent_idx"
  ON "calendar_events" ("team_id", "recurring_parent_id")
  WHERE "recurring_parent_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_external_unq"
  ON "calendar_events" ("team_id", "external_calendar_id", "external_event_id")
  WHERE "external_event_id" IS NOT NULL;

-- Explicit links between calendar events and workspace entities.
CREATE TABLE IF NOT EXISTS "calendar_event_entities" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "calendar_event_id" uuid NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
  "entity_id"         uuid NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
  "team_id"           uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "relationship_type" text NOT NULL DEFAULT 'related',
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_event_entities_unq"
  ON "calendar_event_entities" ("calendar_event_id", "entity_id");

CREATE INDEX IF NOT EXISTS "calendar_event_entities_entity_idx"
  ON "calendar_event_entities" ("entity_id");

-- Per-team calendar settings (sidecar — one row per team, lazy-created).
CREATE TABLE IF NOT EXISTS "team_calendar_settings" (
  "team_id"                  uuid PRIMARY KEY REFERENCES "teams"("id") ON DELETE CASCADE,
  "default_reminder_minutes" integer NOT NULL DEFAULT 15,
  "default_visibility"       "event_visibility" NOT NULL DEFAULT 'team',
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now()
);
