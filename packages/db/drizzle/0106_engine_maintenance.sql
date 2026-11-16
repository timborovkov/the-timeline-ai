CREATE TABLE engine_maintenance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  engine_version text NOT NULL,
  cursor uuid,
  lease_owner uuid,
  lease_expires_at timestamptz,
  examined integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX engine_maintenance_team_kind_idx ON engine_maintenance_runs(team_id, kind, started_at);
CREATE UNIQUE INDEX engine_maintenance_active_idx ON engine_maintenance_runs(team_id,kind) WHERE status IN ('running','paused','failed');
