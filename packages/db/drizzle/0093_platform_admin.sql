ALTER TABLE users ADD COLUMN suspended_at timestamptz;
ALTER TABLE users ADD COLUMN suspension_reason text;
ALTER TABLE teams ADD COLUMN suspension_previous_state text;
--> statement-breakpoint
CREATE TABLE platform_admin_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES users(id),
 effective_user_id uuid REFERENCES users(id), team_id uuid REFERENCES teams(id), session_id uuid,
 action text NOT NULL, target_id uuid, reason text, metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_admin_audit_created_idx ON platform_admin_audit(created_at);
CREATE INDEX platform_admin_audit_actor_idx ON platform_admin_audit(actor_user_id);
CREATE TABLE platform_impersonation_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
 actor_user_id uuid NOT NULL REFERENCES users(id), effective_user_id uuid NOT NULL REFERENCES users(id),
 team_id uuid NOT NULL REFERENCES teams(id), authorization_epoch uuid NOT NULL,
 purpose text NOT NULL, "reference" text NOT NULL, "authorization" text NOT NULL,
 expires_at timestamptz NOT NULL, ended_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_impersonation_actor_idx ON platform_impersonation_sessions(actor_user_id);
--> statement-breakpoint
CREATE FUNCTION prevent_platform_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Platform admin audit is append-only'; END $$;
CREATE TRIGGER platform_admin_audit_immutable BEFORE UPDATE OR DELETE ON platform_admin_audit
 FOR EACH ROW EXECUTE FUNCTION prevent_platform_audit_mutation();
