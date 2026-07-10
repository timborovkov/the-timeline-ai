ALTER TABLE "entities" DROP CONSTRAINT IF EXISTS "entities_legacy_source_event_id_null_chk";--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT IF EXISTS "entities_legacy_agent_suggested_false_chk";--> statement-breakpoint
CREATE FUNCTION "public"."guard_entities_legacy_provenance_write"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."source_event_id" IS NOT NULL THEN
			RAISE EXCEPTION 'entities.source_event_id is legacy provenance and must remain null' USING ERRCODE = '23514';
		END IF;
		IF NEW."agent_suggested" = true THEN
			RAISE EXCEPTION 'entities.agent_suggested is legacy provenance and must remain false' USING ERRCODE = '23514';
		END IF;
	ELSE
		IF NEW."source_event_id" IS NOT NULL AND NEW."source_event_id" IS DISTINCT FROM OLD."source_event_id" THEN
			RAISE EXCEPTION 'entities.source_event_id is legacy provenance and cannot be introduced or changed' USING ERRCODE = '23514';
		END IF;
		IF NEW."agent_suggested" = true AND OLD."agent_suggested" = false THEN
			RAISE EXCEPTION 'entities.agent_suggested is legacy provenance and cannot be enabled' USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "entities_legacy_provenance_write_guard"
BEFORE INSERT OR UPDATE ON "entities"
FOR EACH ROW EXECUTE FUNCTION "public"."guard_entities_legacy_provenance_write"();
