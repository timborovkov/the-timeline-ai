CREATE TYPE "public"."team_invite_send_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "removed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "accepted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "revoked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "send_status" "team_invite_send_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_invites" ADD COLUMN "send_error" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_team_active_idx" ON "team_members" USING btree ("team_id","removed_at");--> statement-breakpoint
CREATE INDEX "team_members_user_active_idx" ON "team_members" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE INDEX "team_invites_team_created_idx" ON "team_invites" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "team_invites_team_email_idx" ON "team_invites" USING btree ("team_id","email");
