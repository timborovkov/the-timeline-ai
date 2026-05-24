-- Narrow the entities canonical-name unique index so tasks, follow-ups,
-- and deals can share names across rows. Lives in its own migration
-- because the predicate references enum values (vendor/document/decision)
-- added by 0007 — Postgres forbids using a new enum value in the same
-- transaction as the ALTER TYPE ADD VALUE that introduced it
-- (SQLSTATE 55P04, "unsafe use of new value"). Splitting the work
-- across migrations lets 0007's ADD VALUE statements commit first.
DROP INDEX IF EXISTS "entities_team_type_canonical_name_unq";--> statement-breakpoint
CREATE UNIQUE INDEX "entities_team_type_canonical_name_unq" ON "entities" USING btree ("team_id","type",lower("canonical_name")) WHERE "merged_into_id" IS NULL AND "type" IN ('person','company','project','topic','other','vendor','document','decision');
