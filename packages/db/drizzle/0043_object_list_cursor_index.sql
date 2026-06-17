CREATE INDEX IF NOT EXISTS "entities_team_type_status_active_updated_id_idx"
ON "entities" USING btree ("team_id","type","status","updated_at","id")
WHERE "entities"."archived_at" IS NULL AND "entities"."merged_into_id" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "entities_team_type_active_updated_id_idx"
ON "entities" USING btree ("team_id","type","updated_at","id")
WHERE "entities"."archived_at" IS NULL AND "entities"."merged_into_id" IS NULL;--> statement-breakpoint
