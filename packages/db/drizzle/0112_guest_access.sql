CREATE TABLE "guest_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams" ("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "invited_by_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "accepted_by_user_id" uuid REFERENCES "users" ("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_invitations_team_id_unique" UNIQUE ("team_id", "id"),
  CONSTRAINT "guest_invitations_team_email_unique" UNIQUE ("team_id", "email"),
  CONSTRAINT "guest_invitations_token_hash_check" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "guest_invitations_normalized_email_check" CHECK ("email" = lower(trim("email")))
);
--> statement-breakpoint
CREATE INDEX "guest_invitations_recipient_idx" ON "guest_invitations" ("accepted_by_user_id", "team_id");
--> statement-breakpoint
CREATE TABLE "guest_source_grants" (
  "team_id" uuid NOT NULL,
  "invitation_id" uuid NOT NULL,
  "raw_event_id" uuid NOT NULL,
  "revision" uuid DEFAULT gen_random_uuid() NOT NULL,
  "granted_by_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  PRIMARY KEY ("team_id", "invitation_id", "raw_event_id"),
  CONSTRAINT "guest_source_grants_invitation_fk"
    FOREIGN KEY ("team_id", "invitation_id") REFERENCES "guest_invitations" ("team_id", "id") ON DELETE CASCADE,
  CONSTRAINT "guest_source_grants_event_fk"
    FOREIGN KEY ("team_id", "raw_event_id") REFERENCES "raw_events" ("team_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "guest_source_grants_event_idx" ON "guest_source_grants" ("team_id", "raw_event_id");
--> statement-breakpoint
CREATE TRIGGER guest_invitations_active_team BEFORE INSERT OR UPDATE ON guest_invitations
  FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
--> statement-breakpoint
CREATE TRIGGER guest_source_grants_active_team BEFORE INSERT OR UPDATE ON guest_source_grants
  FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
--> statement-breakpoint
CREATE FUNCTION revoke_guest_grants_on_source_restriction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM guest_source_grants WHERE team_id = NEW.team_id AND raw_event_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER raw_events_revoke_guest_grants
  AFTER UPDATE OF visibility ON raw_events
  FOR EACH ROW WHEN (OLD.visibility = 'team' AND NEW.visibility <> 'team')
  EXECUTE FUNCTION revoke_guest_grants_on_source_restriction();
--> statement-breakpoint
CREATE FUNCTION revoke_guest_access_on_full_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  WITH revoked AS (
    UPDATE guest_invitations
    SET revoked_at = now()
    WHERE team_id = NEW.team_id
      AND revoked_at IS NULL
      AND (accepted_by_user_id = NEW.user_id OR email = (
        SELECT lower(email) FROM users WHERE id = NEW.user_id
      ))
    RETURNING id
  )
  DELETE FROM guest_source_grants
  USING revoked
  WHERE team_id = NEW.team_id AND invitation_id = revoked.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER team_members_revoke_guest_access
  AFTER INSERT OR UPDATE OF removed_at ON team_members
  FOR EACH ROW WHEN (NEW.removed_at IS NULL)
  EXECUTE FUNCTION revoke_guest_access_on_full_membership();
