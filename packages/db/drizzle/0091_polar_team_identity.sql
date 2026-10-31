ALTER TABLE team_billing_accounts ADD COLUMN polar_organization_id text;
--> statement-breakpoint
ALTER TABLE team_billing_accounts ADD COLUMN polar_server text;
--> statement-breakpoint
CREATE TABLE billing_polar_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 member_id text,
 polar_external_id text,
 role text,
 pending_role text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX billing_polar_members_team_user_unq ON billing_polar_members(team_id,user_id);
