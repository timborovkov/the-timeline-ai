CREATE TYPE "public"."pin_target_kind" AS ENUM(
  'object',
  'board',
  'document',
  'meeting',
  'saved_meeting',
  'calendar_event',
  'timeline_moment'
);
--> statement-breakpoint
CREATE TABLE "user_pins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "target_kind" "pin_target_kind" NOT NULL,
  "target_key" text NOT NULL,
  "sort_key" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_pins_target_key_length_chk" CHECK (char_length("target_key") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "user_pins" ADD CONSTRAINT "user_pins_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "user_pins" ADD CONSTRAINT "user_pins_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_pins_team_user_target_unq"
  ON "user_pins" ("team_id", "user_id", "target_kind", "target_key");
--> statement-breakpoint
CREATE INDEX "user_pins_team_user_sort_idx"
  ON "user_pins" ("team_id", "user_id", "sort_key", "id");
--> statement-breakpoint
CREATE INDEX "user_pins_team_user_kind_sort_idx"
  ON "user_pins" ("team_id", "user_id", "target_kind", "sort_key", "id");
--> statement-breakpoint
INSERT INTO "user_pins" (
  "team_id", "user_id", "target_kind", "target_key", "sort_key", "created_at", "updated_at"
)
SELECT
  "team_id",
  "user_id",
  'board'::"pin_target_kind",
  "board_id"::text,
  (row_number() OVER (PARTITION BY "team_id", "user_id" ORDER BY "position", "created_at", "board_id") - 1) * 1024,
  "created_at",
  "created_at"
FROM "board_pins"
ON CONFLICT ("team_id", "user_id", "target_kind", "target_key") DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.object_pins') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO "user_pins" (
        "team_id", "user_id", "target_kind", "target_key", "sort_key", "created_at", "updated_at"
      )
      SELECT
        object_pin."team_id",
        object_pin."user_id",
        'object'::"pin_target_kind",
        object_pin."entity_id"::text,
        COALESCE(
          (
            SELECT MAX(existing."sort_key") + 1024
            FROM "user_pins" existing
            WHERE existing."team_id" = object_pin."team_id"
              AND existing."user_id" = object_pin."user_id"
          ),
          -1024
        ) +
          (row_number() OVER (
            PARTITION BY object_pin."team_id", object_pin."user_id"
            ORDER BY object_pin."position", object_pin."created_at", object_pin."entity_id"
          ) - 1) * 1024,
        object_pin."created_at",
        object_pin."created_at"
      FROM "object_pins" object_pin
      ON CONFLICT ("team_id", "user_id", "target_kind", "target_key") DO NOTHING
    $sql$;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION delete_user_pins_for_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "user_pins"
  WHERE "team_id" = OLD."team_id"
    AND "target_kind" = TG_ARGV[0]::"pin_target_kind"
    AND "target_key" = OLD."id"::text;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "entities_delete_user_pins"
  AFTER DELETE ON "entities"
  FOR EACH ROW EXECUTE FUNCTION delete_user_pins_for_target('object');
--> statement-breakpoint
CREATE TRIGGER "boards_delete_user_pins"
  AFTER DELETE ON "boards"
  FOR EACH ROW EXECUTE FUNCTION delete_user_pins_for_target('board');
--> statement-breakpoint
CREATE TRIGGER "documents_delete_user_pins"
  AFTER DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION delete_user_pins_for_target('document');
--> statement-breakpoint
CREATE TRIGGER "meetings_delete_user_pins"
  AFTER DELETE ON "meetings"
  FOR EACH ROW EXECUTE FUNCTION delete_user_pins_for_target('meeting');
--> statement-breakpoint
CREATE TRIGGER "saved_meetings_delete_user_pins"
  AFTER DELETE ON "saved_meetings"
  FOR EACH ROW EXECUTE FUNCTION delete_user_pins_for_target('saved_meeting');
--> statement-breakpoint
CREATE TRIGGER "calendar_events_delete_user_pins"
  AFTER DELETE ON "calendar_events"
  FOR EACH ROW EXECUTE FUNCTION delete_user_pins_for_target('calendar_event');
