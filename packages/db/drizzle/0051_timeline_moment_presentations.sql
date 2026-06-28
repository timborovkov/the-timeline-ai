CREATE TABLE "timeline_moment_presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"moment_key" text NOT NULL,
	"cache_fingerprint" text NOT NULL,
	"visibility_scope_hash" text NOT NULL,
	"visible_source_event_ids_hash" text NOT NULL,
	"visible_source_content_hash" text NOT NULL,
	"impact_hydration_hash" text NOT NULL,
	"artifact_cluster_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"suggestion" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timeline_moment_presentations" ADD CONSTRAINT "timeline_moment_presentations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_moment_presentations_team_cache_unq" ON "timeline_moment_presentations" USING btree ("team_id","cache_fingerprint");
--> statement-breakpoint
CREATE INDEX "timeline_moment_presentations_team_moment_idx" ON "timeline_moment_presentations" USING btree ("team_id","moment_key");
--> statement-breakpoint
CREATE INDEX "timeline_moment_presentations_team_model_prompt_idx" ON "timeline_moment_presentations" USING btree ("team_id","model","prompt_version");
