CREATE TYPE "public"."artifact_cluster_status" AS ENUM('open', 'active', 'blocked', 'resolved', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."artifact_evidence_role" AS ENUM('report', 'discussion', 'error', 'issue', 'implementation', 'review', 'release', 'document', 'approval', 'signature', 'payment', 'schedule', 'rsvp', 'decision', 'lifecycle_update', 'related_context');--> statement-breakpoint
CREATE TYPE "public"."artifact_evidence_strength" AS ENUM('hard', 'provider', 'structured', 'semantic', 'human');--> statement-breakpoint
CREATE TABLE "artifact_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"artifact_type" "entity_type" NOT NULL,
	"canonical_name" text NOT NULL,
	"status" "artifact_cluster_status" DEFAULT 'open' NOT NULL,
	"canonical_entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifact_cluster_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"entity_id" uuid,
	"suggestion_id" uuid,
	"provider" text,
	"external_object_id" text,
	"role" "artifact_evidence_role" NOT NULL,
	"strength" "artifact_evidence_strength" NOT NULL,
	"authoritative" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_cluster_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"anchor_type" text NOT NULL,
	"anchor_value" text NOT NULL,
	"strength" "artifact_evidence_strength" NOT NULL,
	"source_raw_event_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_clusters" ADD CONSTRAINT "artifact_clusters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_clusters" ADD CONSTRAINT "artifact_clusters_canonical_entity_id_entities_id_fk" FOREIGN KEY ("canonical_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_members" ADD CONSTRAINT "artifact_cluster_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_members" ADD CONSTRAINT "artifact_cluster_members_cluster_id_artifact_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."artifact_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_members" ADD CONSTRAINT "artifact_cluster_members_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_members" ADD CONSTRAINT "artifact_cluster_members_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_members" ADD CONSTRAINT "artifact_cluster_members_suggestion_id_agent_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."agent_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_anchors" ADD CONSTRAINT "artifact_cluster_anchors_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_anchors" ADD CONSTRAINT "artifact_cluster_anchors_cluster_id_artifact_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."artifact_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_cluster_anchors" ADD CONSTRAINT "artifact_cluster_anchors_source_raw_event_id_raw_events_id_fk" FOREIGN KEY ("source_raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_clusters_team_type_status_idx" ON "artifact_clusters" USING btree ("team_id","artifact_type","status");--> statement-breakpoint
CREATE INDEX "artifact_clusters_team_entity_idx" ON "artifact_clusters" USING btree ("team_id","canonical_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_clusters_team_entity_unq" ON "artifact_clusters" USING btree ("team_id","canonical_entity_id") WHERE "artifact_clusters"."canonical_entity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "artifact_cluster_members_team_cluster_idx" ON "artifact_cluster_members" USING btree ("team_id","cluster_id");--> statement-breakpoint
CREATE INDEX "artifact_cluster_members_team_raw_event_idx" ON "artifact_cluster_members" USING btree ("team_id","raw_event_id");--> statement-breakpoint
CREATE INDEX "artifact_cluster_members_team_entity_idx" ON "artifact_cluster_members" USING btree ("team_id","entity_id");--> statement-breakpoint
CREATE INDEX "artifact_cluster_members_team_provider_external_idx" ON "artifact_cluster_members" USING btree ("team_id","provider","external_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_cluster_members_event_cluster_unq" ON "artifact_cluster_members" USING btree ("team_id","cluster_id","raw_event_id") WHERE "artifact_cluster_members"."raw_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_cluster_members_entity_cluster_unq" ON "artifact_cluster_members" USING btree ("team_id","cluster_id","entity_id") WHERE "artifact_cluster_members"."entity_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_cluster_anchors_team_anchor_unq" ON "artifact_cluster_anchors" USING btree ("team_id","anchor_type","anchor_value");--> statement-breakpoint
CREATE INDEX "artifact_cluster_anchors_team_cluster_idx" ON "artifact_cluster_anchors" USING btree ("team_id","cluster_id");
