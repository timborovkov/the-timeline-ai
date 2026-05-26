-- Phase 11 — Calendar raw_events dedup index.
--
-- Split from 0017 because Postgres rejects use of a freshly-added enum
-- value inside the same transaction (55P04). The 'calendar' value was
-- added to event_source in 0017; this index references it via the
-- JSONB key check pattern (same approach as meeting/integration indexes).
--
-- Idempotency: the calendar scope stamps sourceMetadata.calendar_event_id
-- + sourceMetadata.action on every raw_events row it creates. The design
-- produces TWO raw_events per calendar event (action='scheduled' at
-- creation, action='event' at start_at). These two are idempotent and
-- protected by this dedup index.
--
-- Additional audit rows (action='updated', 'cancelled') are NOT covered
-- by this index because a single calendar event can be updated many
-- times, each producing an audit row with action='updated'. The audit
-- inserts are transactional (same tx as the mutation) so retry-dedup is
-- unnecessary -- a failed tx rolls back the audit row too.

CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_calendar_event_dedup_unq"
  ON "raw_events" ("team_id", ((source_metadata ->> 'calendar_event_id')), ((source_metadata ->> 'action')))
  WHERE source_metadata ? 'calendar_event_id'
    AND (source_metadata ->> 'action') IN ('scheduled', 'event');
