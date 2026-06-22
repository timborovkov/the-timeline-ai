ALTER TABLE "team_calendar_settings" ALTER COLUMN "default_timezone" SET DEFAULT 'Europe/Helsinki';--> statement-breakpoint
ALTER TABLE "message_preferences" ALTER COLUMN "timezone" SET DEFAULT 'Europe/Helsinki';--> statement-breakpoint
INSERT INTO "team_calendar_settings" (
  "team_id",
  "default_reminder_minutes",
  "default_visibility",
  "default_timezone",
  "updated_at"
)
SELECT
  "teams"."id",
  15,
  'team',
  'Europe/Helsinki',
  now()
FROM "teams"
LEFT JOIN "team_calendar_settings"
  ON "team_calendar_settings"."team_id" = "teams"."id"
WHERE "team_calendar_settings"."team_id" IS NULL;--> statement-breakpoint
UPDATE "team_calendar_settings"
SET
  "default_timezone" = 'Europe/Helsinki',
  "updated_at" = now()
WHERE "default_timezone" = 'UTC';--> statement-breakpoint
UPDATE "message_preferences"
SET
  "timezone" = 'Europe/Helsinki',
  "updated_at" = now()
WHERE "timezone" = 'UTC';
