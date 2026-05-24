-- Narrow the entities canonical-name unique index so tasks, follow-ups,
-- and deals can share names across rows. Lives in its own migration
-- because the predicate references enum values (vendor/document/decision)
-- added by 0007 — Postgres forbids using a new enum value in the same
-- transaction as the ALTER TYPE ADD VALUE that introduced it
-- (SQLSTATE 55P04, "unsafe use of new value"). Splitting the work
-- across migrations lets 0007's ADD VALUE statements commit first.
--
-- The bare text literals 'person', 'company', ... in an index predicate
-- force Postgres to call `enum_in(cstring) -> entity_type` to coerce
-- them; `enum_in` is STABLE, not IMMUTABLE, so Postgres rejects the
-- whole predicate with SQLSTATE 42P17 ("functions in index expression
-- must be marked IMMUTABLE"). Explicit `::entity_type` casts on each
-- literal turn the coercion into a parse-time constant, eliminating the
-- function call from the stored predicate. (`pg_catalog.lower` is also
-- schema-qualified for the same robustness reason — search_path can
-- otherwise pick a STABLE overload on managed Postgres.)
DROP INDEX IF EXISTS "entities_team_type_canonical_name_unq";--> statement-breakpoint
CREATE UNIQUE INDEX "entities_team_type_canonical_name_unq" ON "entities" USING btree ("team_id","type",pg_catalog.lower("canonical_name")) WHERE "merged_into_id" IS NULL AND "type" IN ('person'::entity_type,'company'::entity_type,'project'::entity_type,'topic'::entity_type,'other'::entity_type,'vendor'::entity_type,'document'::entity_type,'decision'::entity_type);
