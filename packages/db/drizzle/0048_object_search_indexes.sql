CREATE INDEX IF NOT EXISTS "entities_team_lower_canonical_name_pattern_idx"
ON "entities" USING btree ("team_id", lower("canonical_name") text_pattern_ops)
WHERE "entities"."merged_into_id" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "entities_canonical_name_tsv_idx"
ON "entities" USING gin (to_tsvector('simple', "canonical_name"))
WHERE "entities"."merged_into_id" IS NULL;--> statement-breakpoint
