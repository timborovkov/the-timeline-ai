CREATE TABLE "job_recovery_dismissals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "job_kind" text NOT NULL,
  "artifact_kind" text NOT NULL,
  "artifact_id" uuid NOT NULL,
  "dismissed_by_user_id" uuid,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "job_recovery_dismissals" ADD CONSTRAINT "job_recovery_dismissals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recovery_dismissals" ADD CONSTRAINT "job_recovery_dismissals_dismissed_by_user_id_users_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_recovery_dismissals_target_unq" ON "job_recovery_dismissals" USING btree ("team_id","job_kind","artifact_kind","artifact_id");--> statement-breakpoint
CREATE INDEX "job_recovery_dismissals_team_created_idx" ON "job_recovery_dismissals" USING btree ("team_id","created_at");
