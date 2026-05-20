CREATE TYPE "public"."entity_type" AS ENUM('person', 'company', 'project', 'topic', 'other');--> statement-breakpoint
CREATE TYPE "public"."fact_entity_role" AS ENUM('subject', 'object', 'topic');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"type" "entity_type" NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_entities" (
	"fact_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" "fact_entity_role" NOT NULL,
	CONSTRAINT "fact_entities_fact_id_entity_id_role_pk" PRIMARY KEY("fact_id","entity_id","role")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"confidence" real NOT NULL,
	"model_version" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_confidence_range" CHECK ("facts"."confidence" >= 0 AND "facts"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_id_entities_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_entities" ADD CONSTRAINT "fact_entities_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_entities" ADD CONSTRAINT "fact_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_team_idx" ON "entities" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "entities_team_type_idx" ON "entities" USING btree ("team_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_team_type_canonical_name_unq" ON "entities" USING btree ("team_id","type",lower("canonical_name")) WHERE "entities"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "entities_aliases_gin" ON "entities" USING gin ("aliases" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "fact_entities_entity_idx" ON "fact_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "facts_team_idx" ON "facts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "facts_raw_event_idx" ON "facts" USING btree ("raw_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_raw_event_model_statement_unq" ON "facts" USING btree ("raw_event_id","model_version",md5("statement"));