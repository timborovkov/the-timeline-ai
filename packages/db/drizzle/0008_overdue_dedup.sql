-- Phase 8 follow-up: per-day dedup for the overdue notification scan.
--
-- The hourly worker emits one `task_overdue` / `follow_up_overdue` row per
-- (team, user, entity) when an object's due_at is in the past. Without a
-- dedup index, every hourly tick on the same calendar day would emit a
-- duplicate notification, burying the inbox. A partial unique index on the
-- calendar-date of `created_at` lets us write `ON CONFLICT DO NOTHING` and
-- have Postgres silently swallow the repeats.
--
-- Scoped to overdue kinds only so other notification kinds (object_changed,
-- mentions, etc.) can fire multiple times per day without colliding.

-- `(created_at AT TIME ZONE 'UTC')::date` rather than `created_at::date`:
-- the bare timestamptz->date cast depends on the session's TimeZone GUC
-- so Postgres marks it STABLE, not IMMUTABLE, and rejects it in an index
-- expression with SQLSTATE 42P17. Pinning the conversion to UTC first
-- yields an IMMUTABLE expression with the same dedup semantics (one row
-- per calendar day, evaluated in UTC).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_overdue_dedup_idx
ON notifications (team_id, user_id, entity_id, kind, ((created_at AT TIME ZONE 'UTC')::date))
WHERE kind IN ('task_overdue', 'follow_up_overdue');
