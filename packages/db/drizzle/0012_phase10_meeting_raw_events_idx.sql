-- Phase 10 raw_events idempotency: the unsigned Recall transcript webhook
-- retries on 5xx, and we want the partial unique index on
-- (team_id, source_metadata->>'meeting_chunk_provider_id') to make those
-- retries a no-op at the audit-event layer.
--
-- This index lives in its own migration so the `meeting` enum value added
-- in 0011 is committed before being referenced here. Postgres rejects use
-- of a freshly-added enum value inside the same transaction (55P04).

CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_meeting_chunk_id_unq" ON "raw_events" USING btree ("team_id", ((source_metadata ->> 'meeting_chunk_provider_id'))) WHERE "raw_events"."source" = 'meeting' AND "raw_events"."source_metadata" ? 'meeting_chunk_provider_id';
