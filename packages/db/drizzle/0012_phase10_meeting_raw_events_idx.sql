-- Phase 10 raw_events idempotency: the unsigned Recall transcript webhook
-- retries on 5xx, and we want the partial unique index on
-- (team_id, source_metadata->>'meeting_chunk_provider_id') to make those
-- retries a no-op at the audit-event layer.
--
-- The WHERE clause casts `source` to text instead of comparing it as the
-- event_source enum. Drizzle-orm wraps all pending migrations in a single
-- transaction, so a direct `source = 'meeting'` comparison would trip
-- Postgres's check_safe_enum_use (55P04) on the freshly-added enum value
-- from 0011. Comparing as text sidesteps the new-enum-value binding.

CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_meeting_chunk_id_unq" ON "raw_events" USING btree ("team_id", ((source_metadata ->> 'meeting_chunk_provider_id'))) WHERE "raw_events"."source"::text = 'meeting' AND "raw_events"."source_metadata" ? 'meeting_chunk_provider_id';
