ALTER TABLE "daily_digests" ADD COLUMN "schedule_key" text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_digests_scheduled_window_unq" ON "daily_digests" ("team_id", "user_id", "schedule_key", "window_end", "window_start");
--> statement-breakpoint
DROP INDEX "daily_digests_team_user_window_unq";
--> statement-breakpoint
CREATE TABLE "update_schedules" (
  "team_id" uuid NOT NULL REFERENCES "teams" ("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users" ("id") ON DELETE CASCADE,
  "schedule_key" text NOT NULL,
  "settings" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "update_schedules_workspace_default_chk" CHECK ("user_id" IS NOT NULL OR "schedule_key" = 'default')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "update_schedules_member_unq" ON "update_schedules" ("team_id", "user_id", "schedule_key") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "update_schedules_workspace_unq" ON "update_schedules" ("team_id") WHERE "user_id" IS NULL;
