CREATE TYPE "public"."object_summary_status" AS ENUM('pending', 'ready', 'stale', 'failed');--> statement-breakpoint
CREATE TYPE "public"."object_summary_run_status" AS ENUM('pending', 'ready', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "object_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "object_summary_status" DEFAULT 'pending' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_fingerprint" text,
	"model" text,
	"prompt_version" text,
	"generated_at" timestamp with time zone,
	"stale_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"last_error_code" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "object_summary_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "object_summary_run_status" DEFAULT 'pending' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_fingerprint" text,
	"source_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "object_summaries" ADD CONSTRAINT "object_summaries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_summaries" ADD CONSTRAINT "object_summaries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_summary_runs" ADD CONSTRAINT "object_summary_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_summary_runs" ADD CONSTRAINT "object_summary_runs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "object_summaries_team_entity_unq" ON "object_summaries" USING btree ("team_id","entity_id");--> statement-breakpoint
CREATE INDEX "object_summaries_team_status_idx" ON "object_summaries" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "object_summary_runs_team_entity_started_idx" ON "object_summary_runs" USING btree ("team_id","entity_id","started_at");--> statement-breakpoint
CREATE INDEX "object_summary_runs_team_status_idx" ON "object_summary_runs" USING btree ("team_id","status");
