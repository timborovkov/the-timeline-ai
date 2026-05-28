-- Phase 12: Slack conversational capture.
--
-- Slack is a first-party Capture Surface, parallel to Telegram. Bot tokens
-- are AES-256-GCM encrypted at rest; sender, binding, conversation, thread,
-- edit/delete, and attachment provenance lives in raw_events.source_metadata.

ALTER TYPE "public"."event_source" ADD VALUE IF NOT EXISTS 'slack';--> statement-breakpoint
ALTER TYPE "public"."onboarding_step" ADD VALUE IF NOT EXISTS 'slack';--> statement-breakpoint
ALTER TYPE "public"."visibility_default_source" ADD VALUE IF NOT EXISTS 'slack';--> statement-breakpoint

CREATE TABLE "slack_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slack_team_id" text NOT NULL,
  "slack_enterprise_id" text,
  "name" text,
  "domain" text,
  "bot_user_id" text,
  "app_id" text,
  "scopes" text[],
  "token_ciphertext" bytea NOT NULL,
  "token_iv" bytea NOT NULL,
  "token_tag" bytea NOT NULL,
  "installed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "slack_workspaces" ADD CONSTRAINT "slack_workspaces_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_workspaces_team_unq" ON "slack_workspaces" USING btree ("slack_team_id");--> statement-breakpoint
CREATE INDEX "slack_workspaces_enterprise_idx" ON "slack_workspaces" USING btree ("slack_enterprise_id");--> statement-breakpoint

CREATE TABLE "slack_workspace_teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "installed_by_user_id" uuid,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "slack_workspace_teams" ADD CONSTRAINT "slack_workspace_teams_workspace_id_slack_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_workspace_teams" ADD CONSTRAINT "slack_workspace_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_workspace_teams" ADD CONSTRAINT "slack_workspace_teams_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_workspace_teams_unq" ON "slack_workspace_teams" USING btree ("workspace_id","team_id");--> statement-breakpoint
CREATE INDEX "slack_workspace_teams_team_idx" ON "slack_workspace_teams" USING btree ("team_id");--> statement-breakpoint

CREATE TABLE "slack_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "slack_user_id" text NOT NULL,
  "name" text,
  "real_name" text,
  "email" text,
  "avatar_url" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "slack_users" ADD CONSTRAINT "slack_users_workspace_id_slack_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_users_workspace_user_unq" ON "slack_users" USING btree ("workspace_id","slack_user_id");--> statement-breakpoint
CREATE INDEX "slack_users_email_idx" ON "slack_users" USING btree ("email");--> statement-breakpoint

CREATE TABLE "slack_user_teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slack_user_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "linked_by_user_id" uuid,
  "is_active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "slack_user_teams" ADD CONSTRAINT "slack_user_teams_slack_user_id_slack_users_id_fk" FOREIGN KEY ("slack_user_id") REFERENCES "public"."slack_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_teams" ADD CONSTRAINT "slack_user_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_teams" ADD CONSTRAINT "slack_user_teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_teams" ADD CONSTRAINT "slack_user_teams_linked_by_user_id_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_teams_user_team_unq" ON "slack_user_teams" USING btree ("slack_user_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_teams_active_unq" ON "slack_user_teams" USING btree ("slack_user_id") WHERE "slack_user_teams"."is_active";--> statement-breakpoint
CREATE INDEX "slack_user_teams_team_idx" ON "slack_user_teams" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "slack_user_teams_user_idx" ON "slack_user_teams" USING btree ("user_id");--> statement-breakpoint

CREATE TABLE "slack_conversation_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "slack_conversation_id" text NOT NULL,
  "conversation_type" text NOT NULL,
  "title" text,
  "bound_by_user_id" uuid,
  "visibility_default" "event_visibility" DEFAULT 'team' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "slack_conversation_bindings" ADD CONSTRAINT "slack_conversation_bindings_workspace_id_slack_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation_bindings" ADD CONSTRAINT "slack_conversation_bindings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversation_bindings" ADD CONSTRAINT "slack_conversation_bindings_bound_by_user_id_users_id_fk" FOREIGN KEY ("bound_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_conversation_bindings_workspace_conversation_unq" ON "slack_conversation_bindings" USING btree ("workspace_id","slack_conversation_id") WHERE "slack_conversation_bindings"."enabled";--> statement-breakpoint
CREATE INDEX "slack_conversation_bindings_team_idx" ON "slack_conversation_bindings" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_slack_event_id_unq" ON "raw_events" USING btree ((("source_metadata" ->> 'slack_event_id'))) WHERE "raw_events"."source_metadata" ? 'slack_event_id';--> statement-breakpoint
