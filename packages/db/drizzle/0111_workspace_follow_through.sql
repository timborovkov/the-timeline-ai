ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'calendar_reminder';
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_calendar_reminder_unq
  ON notifications (team_id, user_id, (payload->>'event_id'), (payload->>'start_at'))
  WHERE payload ? 'calendar_reminder';
--> statement-breakpoint
CREATE TABLE google_calendar_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  tag bytea NOT NULL,
  calendar_id text,
  calendar_name text,
  timezone text,
  sync_token text,
  last_full_sync_at timestamptz,
  last_sync_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  sync_status text,
  revision integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX google_calendar_imports_team_user_unq ON google_calendar_imports(team_id, user_id);
CREATE INDEX google_calendar_imports_due_idx ON google_calendar_imports(next_sync_at) WHERE calendar_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE calendar_reminder_preferences (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_minutes integer NOT NULL CONSTRAINT calendar_reminder_preferences_lead_check CHECK (lead_minutes BETWEEN 1 AND 1440),
  PRIMARY KEY (team_id, event_id, user_id)
);
CREATE TABLE calendar_reminder_blocks (
  event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  series boolean NOT NULL DEFAULT false,
  PRIMARY KEY (event_id, series)
);
--> statement-breakpoint
ALTER TABLE team_billing_accounts ADD COLUMN vision_budget_cents integer;
CREATE TABLE document_extraction_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  model text,
  representations jsonb,
  previous jsonb,
  applied_by uuid REFERENCES users(id) ON DELETE SET NULL,
  applied_at timestamptz,
  index_queued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_extraction_attempts_version_idx ON document_extraction_attempts(team_id, version_id, created_at);
--> statement-breakpoint
CREATE TABLE source_index_receipts (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind text NOT NULL,
  source_id uuid NOT NULL,
  model text NOT NULL,
  source_updated_at timestamptz NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, kind, source_id)
);
--> statement-breakpoint
CREATE TABLE handoff_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  turn_id uuid NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX handoff_snapshots_team_turn_unq ON handoff_snapshots(team_id, turn_id);
--> statement-breakpoint
CREATE TABLE saved_work_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  collection text NOT NULL,
  target_id uuid,
  filters jsonb NOT NULL,
  notify boolean NOT NULL DEFAULT false,
  opted_in_at timestamptz,
  baseline jsonb NOT NULL DEFAULT '[]',
  evaluated_through timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_work_views_owner_idx ON saved_work_views(team_id, user_id);
CREATE TABLE saved_work_view_digests (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_end timestamptz NOT NULL,
  changes jsonb NOT NULL
);
CREATE UNIQUE INDEX saved_work_view_digests_window_unq ON saved_work_view_digests(team_id, user_id, window_end);
