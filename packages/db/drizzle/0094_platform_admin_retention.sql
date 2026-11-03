CREATE TABLE platform_admin_retention_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid REFERENCES teams(id), user_id uuid REFERENCES users(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL, "reference" text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz,
 CONSTRAINT platform_retention_hold_scope CHECK ((team_id IS NULL) <> (user_id IS NULL))
);
CREATE INDEX platform_retention_hold_team_idx ON platform_admin_retention_holds(team_id) WHERE released_at IS NULL;
CREATE INDEX platform_retention_hold_user_idx ON platform_admin_retention_holds(user_id) WHERE released_at IS NULL;
CREATE INDEX platform_impersonation_retention_idx ON platform_impersonation_sessions (LEAST(expires_at, COALESCE(ended_at, expires_at)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_platform_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND OLD.created_at < now() - interval '12 months'
 AND NOT EXISTS (
  SELECT 1 FROM platform_admin_retention_holds h WHERE h.released_at IS NULL AND (
   h.team_id = OLD.team_id OR h.team_id = OLD.target_id OR
   h.user_id = OLD.actor_user_id OR h.user_id = OLD.effective_user_id OR h.user_id = OLD.target_id
  )
 ) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Platform admin audit is append-only within retention or legal hold';
END $$;
