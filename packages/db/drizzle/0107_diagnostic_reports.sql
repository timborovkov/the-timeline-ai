ALTER TABLE teams ADD COLUMN diagnostic_sharing_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE diagnostic_reports (
 id uuid PRIMARY KEY,
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext text NOT NULL,
 iv text NOT NULL,
 tag text NOT NULL,
 consent_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX diagnostic_reports_expiry_idx ON diagnostic_reports(expires_at);
CREATE INDEX diagnostic_reports_author_idx ON diagnostic_reports(team_id, user_id, created_at);
