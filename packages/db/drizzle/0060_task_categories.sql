DELETE FROM "entity_relationships" AS inverse
USING "entities" AS project, "entities" AS task
WHERE inverse."from_entity_id" = project."id"
	AND inverse."to_entity_id" = task."id"
	AND inverse."kind" = 'parent'
	AND project."team_id" = inverse."team_id"
	AND project."type" = 'project'
	AND task."team_id" = inverse."team_id"
	AND task."type" = 'task'
	AND EXISTS (
		SELECT 1
		FROM "entity_relationships" AS canonical
		WHERE canonical."team_id" = inverse."team_id"
			AND canonical."from_entity_id" = task."id"
			AND canonical."to_entity_id" = project."id"
			AND canonical."kind" = 'child'
	);--> statement-breakpoint
UPDATE "entity_relationships" AS inverse
SET "from_entity_id" = inverse."to_entity_id",
	"to_entity_id" = inverse."from_entity_id",
	"kind" = 'child'
FROM "entities" AS project, "entities" AS task
WHERE inverse."from_entity_id" = project."id"
	AND inverse."to_entity_id" = task."id"
	AND inverse."kind" = 'parent'
	AND project."team_id" = inverse."team_id"
	AND project."type" = 'project'
	AND task."team_id" = inverse."team_id"
	AND task."type" = 'task';--> statement-breakpoint
CREATE TABLE "task_project_source_locks" (
	"team_id" uuid NOT NULL,
	"source_entity_id" uuid NOT NULL,
	CONSTRAINT "task_project_source_locks_team_id_source_entity_id_pk" PRIMARY KEY("team_id","source_entity_id"),
	CONSTRAINT "task_project_source_locks_team_source_fk" FOREIGN KEY ("team_id","source_entity_id") REFERENCES "public"."entities"("team_id","id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
INSERT INTO "task_project_source_locks" ("team_id", "source_entity_id")
SELECT "team_id", "id"
FROM "entities";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "create_task_project_source_lock"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "task_project_source_locks" ("team_id", "source_entity_id")
	VALUES (NEW."team_id", NEW."id");
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "entities_task_project_source_lock_trg"
AFTER INSERT ON "entities"
FOR EACH ROW
EXECUTE FUNCTION "create_task_project_source_lock"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "lock_task_project_source"(lock_team_id uuid, lock_source_entity_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM 1
	FROM "task_project_source_locks"
	WHERE "team_id" = lock_team_id AND "source_entity_id" = lock_source_entity_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'Missing task-project source lock for entity %', lock_source_entity_id;
	END IF;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "canonicalize_task_project_relationship"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	from_type text;
	to_type text;
	original_from uuid;
BEGIN
	IF NEW."kind" = 'child' THEN
		SELECT "type" INTO to_type
		FROM "entities"
		WHERE "team_id" = NEW."team_id" AND "id" = NEW."to_entity_id"
		FOR UPDATE;

		PERFORM "lock_task_project_source"(NEW."team_id", NEW."from_entity_id");
		SELECT "type" INTO from_type
		FROM "entities"
		WHERE "team_id" = NEW."team_id" AND "id" = NEW."from_entity_id";
	ELSIF NEW."kind" = 'parent' THEN
		SELECT "type" INTO from_type
		FROM "entities"
		WHERE "team_id" = NEW."team_id" AND "id" = NEW."from_entity_id"
		FOR UPDATE;

		PERFORM "lock_task_project_source"(NEW."team_id", NEW."to_entity_id");
		SELECT "type" INTO to_type
		FROM "entities"
		WHERE "team_id" = NEW."team_id" AND "id" = NEW."to_entity_id";
	ELSE
		RETURN NEW;
	END IF;

	IF NEW."kind" = 'parent' AND from_type = 'project' AND to_type = 'task' THEN
		original_from := NEW."from_entity_id";
		NEW."from_entity_id" := NEW."to_entity_id";
		NEW."to_entity_id" := original_from;
		NEW."kind" := 'child';
		from_type := 'task';
		to_type := 'project';
	END IF;

	IF NEW."kind" = 'child' AND from_type = 'task' AND to_type = 'project' THEN
		IF EXISTS (
			SELECT 1
			FROM "entity_relationships" AS existing
			INNER JOIN "entities" AS existing_project
				ON existing_project."team_id" = existing."team_id"
				AND existing_project."id" = existing."to_entity_id"
				AND existing_project."type" = 'project'
				AND existing_project."merged_into_id" IS NULL
			WHERE existing."team_id" = NEW."team_id"
				AND existing."from_entity_id" = NEW."from_entity_id"
				AND existing."to_entity_id" <> NEW."to_entity_id"
				AND existing."kind" = 'child'
				AND existing."id" IS DISTINCT FROM NEW."id"
		) THEN
			RAISE EXCEPTION 'Task already has a primary project'
				USING ERRCODE = '23505',
					CONSTRAINT = 'entity_relationships_task_primary_project_unq';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "entity_relationships_task_project_canonicalize_trg"
BEFORE INSERT OR UPDATE ON "entity_relationships"
FOR EACH ROW
EXECUTE FUNCTION "canonicalize_task_project_relationship"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_task_project_type_promotion"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	linked_source_id uuid;
BEGIN
	IF OLD."type" <> 'task' AND NEW."type" = 'task' AND NEW."merged_into_id" IS NULL THEN
		PERFORM "lock_task_project_source"(NEW."team_id", NEW."id");
		IF EXISTS (
			SELECT 1
			FROM "entity_relationships" AS inverse_edge
			INNER JOIN "entities" AS project
				ON project."team_id" = inverse_edge."team_id"
				AND project."id" = inverse_edge."from_entity_id"
				AND project."type" = 'project'
				AND project."merged_into_id" IS NULL
			WHERE inverse_edge."team_id" = NEW."team_id"
				AND inverse_edge."to_entity_id" = NEW."id"
				AND inverse_edge."kind" = 'parent'
		) THEN
			RAISE EXCEPTION 'Remove inverse project parent relationships before changing this object to a task'
				USING ERRCODE = '23505',
					CONSTRAINT = 'entity_relationships_task_primary_project_unq';
		END IF;
		IF 1 < (
			SELECT count(*)
			FROM "entity_relationships" AS project_edge
			INNER JOIN "entities" AS project
				ON project."team_id" = project_edge."team_id"
				AND project."id" = project_edge."to_entity_id"
				AND project."type" = 'project'
				AND project."merged_into_id" IS NULL
			WHERE project_edge."team_id" = NEW."team_id"
				AND project_edge."from_entity_id" = NEW."id"
				AND project_edge."kind" = 'child'
		) THEN
			RAISE EXCEPTION 'Changing this object to a task would give it multiple primary projects'
				USING ERRCODE = '23505',
					CONSTRAINT = 'entity_relationships_task_primary_project_unq';
		END IF;
	END IF;

	IF OLD."type" = 'project' OR NEW."type" <> 'project' OR NEW."merged_into_id" IS NOT NULL THEN
		RETURN NEW;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "entity_relationships" AS inverse_edge
		INNER JOIN "entities" AS linked_task
			ON linked_task."team_id" = inverse_edge."team_id"
			AND linked_task."id" = inverse_edge."to_entity_id"
			AND linked_task."type" = 'task'
			AND linked_task."merged_into_id" IS NULL
		WHERE inverse_edge."team_id" = NEW."team_id"
			AND inverse_edge."from_entity_id" = NEW."id"
			AND inverse_edge."kind" = 'parent'
	) THEN
		RAISE EXCEPTION 'Remove inverse task parent relationships before changing this object to a project'
			USING ERRCODE = '23505',
				CONSTRAINT = 'entity_relationships_task_primary_project_unq';
	END IF;

	FOR linked_source_id IN
		SELECT DISTINCT promoted_edge."from_entity_id"
		FROM "entity_relationships" AS promoted_edge
		WHERE promoted_edge."team_id" = NEW."team_id"
			AND promoted_edge."to_entity_id" = NEW."id"
			AND promoted_edge."kind" = 'child'
		ORDER BY promoted_edge."from_entity_id"
	LOOP
		PERFORM "lock_task_project_source"(NEW."team_id", linked_source_id);
	END LOOP;

	IF EXISTS (
		SELECT 1
		FROM "entity_relationships" AS promoted_edge
		INNER JOIN "entities" AS linked_task
			ON linked_task."team_id" = promoted_edge."team_id"
			AND linked_task."id" = promoted_edge."from_entity_id"
			AND linked_task."type" = 'task'
			AND linked_task."merged_into_id" IS NULL
		INNER JOIN "entity_relationships" AS existing_edge
			ON existing_edge."team_id" = promoted_edge."team_id"
			AND existing_edge."from_entity_id" = promoted_edge."from_entity_id"
			AND existing_edge."to_entity_id" <> NEW."id"
			AND existing_edge."kind" = 'child'
		INNER JOIN "entities" AS existing_project
			ON existing_project."team_id" = existing_edge."team_id"
			AND existing_project."id" = existing_edge."to_entity_id"
			AND existing_project."type" = 'project'
			AND existing_project."merged_into_id" IS NULL
		WHERE promoted_edge."team_id" = NEW."team_id"
			AND promoted_edge."to_entity_id" = NEW."id"
			AND promoted_edge."kind" = 'child'
	) THEN
		RAISE EXCEPTION 'Changing this object to a project would give a task multiple primary projects'
			USING ERRCODE = '23505',
				CONSTRAINT = 'entity_relationships_task_primary_project_unq';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "entities_task_project_type_promotion_trg"
BEFORE UPDATE OF "type", "merged_into_id" ON "entities"
FOR EACH ROW
EXECUTE FUNCTION "guard_task_project_type_promotion"();--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_mode" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_source" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_status" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_applied_input_hash" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_requested_input_hash" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_taxonomy_version" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "task_category_filter_versions" (
	"team_id" uuid NOT NULL,
	"category" text NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "task_category_filter_versions_team_id_category_pk" PRIMARY KEY("team_id","category")
);--> statement-breakpoint
CREATE TABLE "task_category_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"category" text,
	"source" text NOT NULL,
	"mode" text NOT NULL,
	"actor_user_id" uuid,
	"confidence" double precision,
	"model" text,
	"prompt_version" text,
	"taxonomy_version" text,
	"input_hash" text,
	"outcome" text NOT NULL,
	"failure_code" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "task_category_project_invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_version" text NOT NULL,
	"after_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_filter_versions" ADD CONSTRAINT "task_category_filter_versions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_filter_versions" ADD CONSTRAINT "task_category_filter_versions_category_chk" CHECK ("task_category_filter_versions"."category" IN ('engineering', 'product', 'design', 'research', 'sales', 'marketing', 'customer_success', 'operations', 'finance', 'legal_compliance', 'people_recruiting', 'it_security', 'strategy_planning', 'administrative', 'other', 'uncategorized'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_team_entity_fk" FOREIGN KEY ("team_id","entity_id") REFERENCES "public"."entities"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_source_chk" CHECK ("task_category_assignments"."source" IN ('llm', 'user'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_category_chk" CHECK ("task_category_assignments"."category" IS NULL OR "task_category_assignments"."category" IN ('engineering', 'product', 'design', 'research', 'sales', 'marketing', 'customer_success', 'operations', 'finance', 'legal_compliance', 'people_recruiting', 'it_security', 'strategy_planning', 'administrative', 'other'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_mode_chk" CHECK ("task_category_assignments"."mode" IN ('automatic', 'manual'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_outcome_chk" CHECK ("task_category_assignments"."outcome" IN ('applied', 'discarded_stale', 'discarded_human_override', 'failed'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_confidence_chk" CHECK ("task_category_assignments"."confidence" IS NULL OR ("task_category_assignments"."confidence" >= 0 AND "task_category_assignments"."confidence" <= 1));--> statement-breakpoint
ALTER TABLE "task_category_project_invalidations" ADD CONSTRAINT "task_category_project_invalidations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_project_invalidations" ADD CONSTRAINT "task_category_project_invalidations_team_project_fk" FOREIGN KEY ("team_id","project_id") REFERENCES "public"."entities"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_non_task_null_chk" CHECK ("entities"."type" = 'task' OR (
	"entities"."task_category" IS NULL
	AND "entities"."task_category_mode" IS NULL
	AND "entities"."task_category_source" IS NULL
	AND "entities"."task_category_status" IS NULL
	AND "entities"."task_category_applied_input_hash" IS NULL
	AND "entities"."task_category_requested_input_hash" IS NULL
	AND "entities"."task_category_taxonomy_version" IS NULL
	AND "entities"."task_category_updated_at" IS NULL
));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_mode_chk" CHECK ("entities"."task_category_mode" IS NULL OR "entities"."task_category_mode" IN ('automatic', 'manual'));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_source_chk" CHECK ("entities"."task_category_source" IS NULL OR "entities"."task_category_source" IN ('llm', 'user'));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_status_chk" CHECK ("entities"."task_category_status" IS NULL OR "entities"."task_category_status" IN ('pending', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_value_chk" CHECK ("entities"."task_category" IS NULL OR "entities"."task_category" IN ('engineering', 'product', 'design', 'research', 'sales', 'marketing', 'customer_success', 'operations', 'finance', 'legal_compliance', 'people_recruiting', 'it_security', 'strategy_planning', 'administrative', 'other'));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_manual_state_chk" CHECK ("entities"."task_category_mode" IS DISTINCT FROM 'manual' OR (
  "entities"."task_category" IS NOT NULL
  AND "entities"."task_category_source" = 'user'
  AND "entities"."task_category_status" = 'ready'
  AND "entities"."task_category_requested_input_hash" IS NULL
  AND "entities"."task_category_applied_input_hash" IS NULL
  AND "entities"."task_category_taxonomy_version" IS NOT NULL
));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_automatic_ready_chk" CHECK (NOT ("entities"."task_category_mode" = 'automatic' AND "entities"."task_category_status" = 'ready') OR (
  "entities"."task_category" IS NOT NULL
  AND "entities"."task_category_source" = 'llm'
  AND "entities"."task_category_applied_input_hash" IS NOT NULL
  AND "entities"."task_category_requested_input_hash" IS NULL
  AND "entities"."task_category_taxonomy_version" IS NOT NULL
));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_task_category_request_state_chk" CHECK ((
  "entities"."task_category_mode" = 'automatic'
  AND "entities"."task_category_status" = 'pending'
  AND "entities"."task_category_requested_input_hash" IS NOT NULL
) OR "entities"."task_category_requested_input_hash" IS NULL);--> statement-breakpoint
CREATE INDEX "entities_team_task_category_active_updated_id_idx" ON "entities" USING btree ("team_id","type","task_category","updated_at","id") WHERE "entities"."archived_at" IS NULL AND "entities"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "entities_task_category_pending_recovery_idx" ON "entities" USING btree ("id","task_category_updated_at") WHERE "entities"."type" = 'task' AND "entities"."task_category_mode" = 'automatic' AND "entities"."task_category_status" = 'pending' AND "entities"."task_category_requested_input_hash" IS NOT NULL AND "entities"."archived_at" IS NULL AND "entities"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "entities_team_task_category_pending_idx" ON "entities" USING btree ("team_id","id") WHERE "entities"."type" = 'task' AND "entities"."task_category_status" = 'pending' AND "entities"."archived_at" IS NULL AND "entities"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "task_category_assignments_team_entity_created_idx" ON "task_category_assignments" USING btree ("team_id","entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_category_assignments_team_versions_outcome_idx" ON "task_category_assignments" USING btree ("team_id","taxonomy_version","prompt_version","model","outcome");--> statement-breakpoint
CREATE INDEX "task_category_assignments_input_hash_idx" ON "task_category_assignments" USING btree ("team_id","entity_id","input_hash") WHERE "input_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_category_project_invalidations_team_project_unq" ON "task_category_project_invalidations" USING btree ("team_id","project_id");--> statement-breakpoint
CREATE INDEX "task_category_project_invalidations_created_idx" ON "task_category_project_invalidations" USING btree ("created_at","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "bump_task_category_filter_versions"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_team_id uuid;
	new_team_id uuid;
	old_key text;
	new_key text;
BEGIN
	IF TG_OP = 'UPDATE' AND OLD."type" = 'task' THEN
		old_team_id := OLD."team_id";
		old_key := COALESCE(OLD."task_category", 'uncategorized');
	END IF;
	IF NEW."type" = 'task' THEN
		new_team_id := NEW."team_id";
		new_key := COALESCE(NEW."task_category", 'uncategorized');
	END IF;

	INSERT INTO "task_category_filter_versions" ("team_id", "category", "version")
	SELECT version_key."team_id", version_key."category", 1
	FROM (
		VALUES
			(CASE WHEN old_key IS DISTINCT FROM new_key THEN old_team_id END, old_key),
			(CASE WHEN TG_OP = 'INSERT' OR new_key IS DISTINCT FROM old_key THEN new_team_id END, new_key)
	) AS version_key("team_id", "category")
	WHERE version_key."team_id" IS NOT NULL AND version_key."category" IS NOT NULL
	GROUP BY version_key."team_id", version_key."category"
	ORDER BY version_key."team_id", version_key."category"
	ON CONFLICT ("team_id", "category") DO UPDATE
	SET "version" = "task_category_filter_versions"."version" + 1;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "entities_task_category_filter_versions_trg"
AFTER INSERT OR UPDATE OF "type", "task_category" ON "entities"
FOR EACH ROW
EXECUTE FUNCTION "bump_task_category_filter_versions"();
