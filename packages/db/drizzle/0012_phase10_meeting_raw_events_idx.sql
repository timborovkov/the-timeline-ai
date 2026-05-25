-- Phase 10 raw_events idempotency: the unsigned Recall transcript webhook
-- retries on 5xx, and we want the partial unique index on
-- (team_id, source_metadata->>'meeting_chunk_provider_id') to make those
-- retries a no-op at the audit-event layer.
--
-- The WHERE clause intentionally does NOT filter `source = 'meeting'`:
--   1. Drizzle-orm wraps all pending migrations in a single transaction,
--      and the `meeting` enum value added in 0011 cannot be referenced
--      in the same tx without tripping check_safe_enum_use (55P04).
--   2. A `source::text = 'meeting'` cast bypasses that check but is
--      STABLE, which Postgres rejects in an index predicate (42P17 —
--      functions in index predicate must be marked IMMUTABLE).
-- The JSONB-key existence check alone is sufficient because
-- `meeting_chunk_provider_id` is only ever set by the meeting ingest
-- path (see packages/shared/src/meetings/scope.ts).

CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_meeting_chunk_id_unq" ON "raw_events" USING btree ("team_id", ((source_metadata ->> 'meeting_chunk_provider_id'))) WHERE "raw_events"."source_metadata" ? 'meeting_chunk_provider_id';
