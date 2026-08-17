ALTER TYPE "public"."message_channel" ADD VALUE IF NOT EXISTS 'slack';--> statement-breakpoint
ALTER TYPE "public"."message_channel" ADD VALUE IF NOT EXISTS 'telegram';--> statement-breakpoint
CREATE TYPE "public"."digest_destination_kind" AS ENUM(
  'email_members',
  'slack_channel',
  'slack_dm_members',
  'telegram_chat',
  'telegram_dm_members'
);--> statement-breakpoint
CREATE TABLE "team_digest_destinations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "kind" "digest_destination_kind" NOT NULL,
  "target_id" text,
  "label" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "team_digest_destinations_target_chk" CHECK ((
    ("kind" IN ('email_members', 'slack_dm_members', 'telegram_dm_members') AND "target_id" IS NULL)
    OR
    ("kind" IN ('slack_channel', 'telegram_chat') AND "target_id" IS NOT NULL)
  ))
);--> statement-breakpoint
ALTER TABLE "team_digest_destinations" ADD CONSTRAINT "team_digest_destinations_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_digest_destinations" ADD CONSTRAINT "team_digest_destinations_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_digest_destinations_fanout_unq"
  ON "team_digest_destinations" ("team_id", "kind")
  WHERE "target_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_digest_destinations_target_unq"
  ON "team_digest_destinations" ("team_id", "kind", "target_id")
  WHERE "target_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "team_digest_destinations_team_idx"
  ON "team_digest_destinations" ("team_id");--> statement-breakpoint
INSERT INTO "team_digest_destinations" ("team_id", "kind", "enabled")
SELECT "id", 'email_members', true
FROM "teams"
ON CONFLICT DO NOTHING;
