ALTER TABLE teams ADD COLUMN evaluation_tracing jsonb NOT NULL DEFAULT '{"enabled":false,"sources":[],"revision":"0","policyVersion":""}';
CREATE TABLE evaluation_trace_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
 name text NOT NULL UNIQUE,
 endpoint text NOT NULL,
 workspace_id text NOT NULL,
 reconcile_after timestamptz NOT NULL,
 next_cleanup_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX evaluation_trace_projects_expiry_idx ON evaluation_trace_projects(expires_at);
