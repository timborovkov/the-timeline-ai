ALTER TABLE "entities" ADD COLUMN "task_category" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_mode" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_source" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_status" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_applied_input_hash" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_requested_input_hash" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_taxonomy_version" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "task_category_updated_at" timestamp with time zone;--> statement-breakpoint
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
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_team_entity_fk" FOREIGN KEY ("team_id","entity_id") REFERENCES "public"."entities"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_source_chk" CHECK ("task_category_assignments"."source" IN ('llm', 'user'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_category_chk" CHECK ("task_category_assignments"."category" IS NULL OR "task_category_assignments"."category" IN ('engineering', 'product', 'design', 'research', 'sales', 'marketing', 'customer_success', 'operations', 'finance', 'legal_compliance', 'people_recruiting', 'it_security', 'strategy_planning', 'administrative', 'other'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_mode_chk" CHECK ("task_category_assignments"."mode" IN ('automatic', 'manual'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_outcome_chk" CHECK ("task_category_assignments"."outcome" IN ('applied', 'discarded_stale', 'discarded_human_override', 'failed'));--> statement-breakpoint
ALTER TABLE "task_category_assignments" ADD CONSTRAINT "task_category_assignments_confidence_chk" CHECK ("task_category_assignments"."confidence" IS NULL OR ("task_category_assignments"."confidence" >= 0 AND "task_category_assignments"."confidence" <= 1));--> statement-breakpoint
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
CREATE INDEX "task_category_assignments_team_entity_created_idx" ON "task_category_assignments" USING btree ("team_id","entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_category_assignments_team_versions_outcome_idx" ON "task_category_assignments" USING btree ("team_id","taxonomy_version","prompt_version","model","outcome");--> statement-breakpoint
CREATE INDEX "task_category_assignments_input_hash_idx" ON "task_category_assignments" USING btree ("team_id","entity_id","input_hash") WHERE "input_hash" IS NOT NULL;
