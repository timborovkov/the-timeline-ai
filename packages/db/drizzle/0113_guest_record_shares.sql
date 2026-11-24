CREATE TABLE "guest_record_shares" (
  "team_id" uuid NOT NULL,
  "invitation_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "revision" uuid DEFAULT gen_random_uuid() NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_by_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  PRIMARY KEY ("team_id", "invitation_id", "record_id"),
  CONSTRAINT "guest_record_shares_invitation_fk"
    FOREIGN KEY ("team_id", "invitation_id") REFERENCES "guest_invitations" ("team_id", "id") ON DELETE CASCADE,
  CONSTRAINT "guest_record_shares_record_fk"
    FOREIGN KEY ("team_id", "record_id") REFERENCES "entities" ("team_id", "id") ON DELETE CASCADE,
  CONSTRAINT "guest_record_shares_title_check" CHECK (char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT "guest_record_shares_body_check" CHECK (char_length("body") BETWEEN 1 AND 8000)
);
--> statement-breakpoint
CREATE INDEX "guest_record_shares_record_idx" ON "guest_record_shares" ("team_id", "record_id");
--> statement-breakpoint
CREATE TRIGGER guest_record_shares_active_team BEFORE INSERT OR UPDATE ON guest_record_shares
  FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
--> statement-breakpoint
CREATE FUNCTION revoke_guest_records_on_invitation_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM guest_record_shares WHERE team_id = NEW.team_id AND invitation_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guest_invitations_revoke_guest_records
  AFTER UPDATE OF revoked_at ON guest_invitations
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION revoke_guest_records_on_invitation_revocation();
--> statement-breakpoint
CREATE FUNCTION revoke_guest_shares_on_record_retirement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM guest_record_shares WHERE team_id = NEW.team_id AND record_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entities_revoke_guest_shares
  AFTER UPDATE OF archived_at, merged_into_id, type ON entities
  FOR EACH ROW WHEN (NEW.archived_at IS NOT NULL OR NEW.merged_into_id IS NOT NULL OR NEW.type::text NOT IN ('project', 'task'))
  EXECUTE FUNCTION revoke_guest_shares_on_record_retirement();
