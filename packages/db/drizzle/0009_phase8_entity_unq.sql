-- Narrow the entities canonical-name unique index so tasks, follow-ups,
-- and deals can share names across rows. Lives in its own migration
-- because the predicate references enum values (vendor/document/decision)
-- added by 0007 — Postgres forbids using a new enum value in the same
-- transaction as the ALTER TYPE ADD VALUE that introduced it
-- (SQLSTATE 55P04, "unsafe use of new value"). Splitting the work
-- across migrations lets 0007's ADD VALUE statements commit first.
--
-- `pg_catalog.lower` is schema-qualified so Postgres always resolves to
-- the built-in IMMUTABLE function. Without the qualification, some
-- managed Postgres setups (notably Railway's) configure a search_path
-- that picks up a STABLE-marked `lower` overload and reject the index
-- expression with SQLSTATE 42P17 ("functions in index expression must be
-- marked IMMUTABLE"). The bare `lower(...)` worked in 0005 only because
-- that environment's search_path happened to resolve correctly; making
-- the qualification explicit removes the dependency.
DROP INDEX IF EXISTS "entities_team_type_canonical_name_unq";--> statement-breakpoint
CREATE UNIQUE INDEX "entities_team_type_canonical_name_unq" ON "entities" USING btree ("team_id","type",pg_catalog.lower("canonical_name")) WHERE "merged_into_id" IS NULL AND "type" IN ('person','company','project','topic','other','vendor','document','decision');
