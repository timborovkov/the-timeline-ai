CREATE TABLE "object_pins" (
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entity_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "object_pins_team_entity_fk"
    FOREIGN KEY ("team_id", "entity_id")
    REFERENCES "entities"("team_id", "id")
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "object_pins_team_user_entity_unq"
  ON "object_pins" ("team_id", "user_id", "entity_id");
--> statement-breakpoint
CREATE INDEX "object_pins_team_user_position_idx"
  ON "object_pins" ("team_id", "user_id", "position");
