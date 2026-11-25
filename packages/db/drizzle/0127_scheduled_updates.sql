CREATE TABLE "update_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL REFERENCES "teams" ("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "schedule_key" text NOT NULL,
  "summary" text NOT NULL,
  "payload" jsonb DEFAULT '{}' NOT NULL,
  "status" "daily_digest_status" DEFAULT 'generated' NOT NULL,
  "delivery_id" uuid REFERENCES "message_deliveries" ("id") ON DELETE SET NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "error" text
);
--> statement-breakpoint
CREATE INDEX "update_runs_team_user_generated_idx" ON "update_runs" ("team_id", "user_id", "generated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "update_runs_schedule_slot_unq" ON "update_runs" ("team_id", "user_id", "schedule_key", "window_end");
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
