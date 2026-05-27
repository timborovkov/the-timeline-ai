-- Phase 13.4 — async team export jobs and trust audit rows.

CREATE TYPE "team_export_status" AS ENUM ('queued', 'running', 'ready', 'failed', 'expired');

CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_exports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "requested_by_user_id" uuid,
  "status" "team_export_status" DEFAULT 'queued' NOT NULL,
  "object_key" text,
  "error" text,
  "manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "omissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_exports" ADD CONSTRAINT "team_exports_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_exports" ADD CONSTRAINT "team_exports_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "audit_log_team_created_idx" ON "audit_log" USING btree ("team_id","created_at");
--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log" USING btree ("actor_user_id","created_at");
--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");
--> statement-breakpoint
CREATE INDEX "team_exports_team_created_idx" ON "team_exports" USING btree ("team_id","created_at");
--> statement-breakpoint
CREATE INDEX "team_exports_status_expires_idx" ON "team_exports" USING btree ("status","expires_at");
