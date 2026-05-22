-- Phase 7: email ingest.
--
-- Adds `teams.inbound_email` (per-team inbound address) and a partial unique
-- index on `raw_events.source_metadata->>'message_id'` scoped by `team_id` for
-- Postmark webhook idempotency. The index is team-scoped (not global) so a
-- forged Message-ID from one team cannot silently drop another team's
-- legitimate inbound. ON CONFLICT DO NOTHING in the dispatcher dedups within
-- a single team.
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "inbound_email" text;--> statement-breakpoint
-- Backfill placeholder for any existing teams. New teams set this column from
-- the team creation action using `<slug>@<INBOUND_EMAIL_DOMAIN>`. The
-- placeholder ensures the unique index can be built; teams created pre-Phase 7
-- can be hand-updated to the production domain via a future settings UI.
UPDATE "teams" SET "inbound_email" = "slug" || '@inbound.invalid' WHERE "inbound_email" IS NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_inbound_email_unique" UNIQUE ("inbound_email");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_email_message_id_unq" ON "raw_events" USING btree ("team_id", (("source_metadata" ->> 'message_id'))) WHERE "raw_events"."source" = 'email' AND "raw_events"."source_metadata" ? 'message_id';
