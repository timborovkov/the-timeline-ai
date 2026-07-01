CREATE TYPE "public"."artifact_cluster_kind" AS ENUM('customer_project', 'account', 'incident', 'deal', 'document', 'decision', 'task', 'meeting', 'calendar_event', 'provider_record', 'topic', 'person_context', 'relationship_bundle', 'system_workflow', 'other');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_replay_state" AS ENUM('full', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_anchor_source" AS ENUM('adapter', 'extractor', 'model', 'human');--> statement-breakpoint
CREATE TYPE "public"."artifact_association_role" AS ENUM('origin', 'update', 'lifecycle_update', 'discussion', 'blocker', 'decision', 'related_context', 'contradiction', 'correction', 'evidence_only');--> statement-breakpoint
CREATE TYPE "public"."artifact_association_source" AS ENUM('hard_anchor', 'structured_anchor', 'model_candidate', 'human', 'authoritative_provider');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_run_trigger" AS ENUM('raw_event', 'evidence_batch', 'cluster_replay', 'manual_repair', 'eval', 'backfill');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_output_kind" AS ENUM('direct_write', 'approval_bundle', 'observed_association', 'no_action', 'conflict', 'eval_observation');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_output_target_kind" AS ENUM('object', 'task', 'calendar_event', 'identity_facet', 'object_note', 'object_relationship', 'object_merge', 'board_membership', 'board_item_update', 'cluster_identity', 'cluster_lifecycle');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_output_operation" AS ENUM('create', 'update', 'archive_or_cancel', 'merge', 'link', 'unlink', 'supersede', 'noop');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_output_status" AS ENUM('pending', 'applied', 'approval_created', 'rejected', 'superseded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_projection_outbox_action" AS ENUM('create_projection', 'mark_applied', 'mark_rejected', 'mark_failed', 'mark_superseded', 'repair_projection');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_projection_outbox_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint
ALTER TABLE "artifact_clusters" ADD COLUMN "artifact_cluster_kind" "artifact_cluster_kind" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_suggestion_items" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "reconciliation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"source_payload_ref" text,
	"payload_digest" text,
	"source" "event_source" NOT NULL,
	"provider" text,
	"external_object_id" text,
	"external_event_id" text,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"visibility" "event_visibility" DEFAULT 'team' NOT NULL,
	"visibility_owner_user_id" uuid,
	"visibility_user_ids" uuid[],
	"actor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_digest" text NOT NULL,
	"title" text,
	"summary" text,
	"source_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalizer_version" text NOT NULL,
	"replay_state" "reconciliation_replay_state" DEFAULT 'full' NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_evidence_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"anchor_type" text NOT NULL,
	"anchor_value" text NOT NULL,
	"strength" "artifact_evidence_strength" NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"source" "reconciliation_anchor_source" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_evidence_associations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"role" "artifact_association_role" NOT NULL,
	"strength" "artifact_evidence_strength" NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"association_source" "artifact_association_source" NOT NULL,
	"rationale" text,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" "event_visibility" DEFAULT 'team' NOT NULL,
	"visibility_owner_user_id" uuid,
	"visibility_user_ids" uuid[],
	"visibility_floor" "event_visibility" DEFAULT 'team' NOT NULL,
	"visibility_floor_owner_user_id" uuid,
	"visibility_floor_user_ids" uuid[],
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"trigger" "reconciliation_run_trigger" NOT NULL,
	"scope" text NOT NULL,
	"status" "reconciliation_run_status" DEFAULT 'pending' NOT NULL,
	"input_fingerprint" text NOT NULL,
	"engine_version" text NOT NULL,
	"model_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"cluster_id" uuid,
	"output_kind" "reconciliation_output_kind" NOT NULL,
	"target_kind" "reconciliation_output_target_kind" NOT NULL,
	"operation" "reconciliation_output_operation" NOT NULL,
	"target_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authority_decision" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_payload_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" "event_visibility" DEFAULT 'team' NOT NULL,
	"visibility_owner_user_id" uuid,
	"visibility_user_ids" uuid[],
	"visibility_floor" "event_visibility" DEFAULT 'team' NOT NULL,
	"visibility_floor_owner_user_id" uuid,
	"visibility_floor_user_ids" uuid[],
	"dedupe_key" text NOT NULL,
	"status" "reconciliation_output_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_projection_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"suggestion_id" uuid,
	"suggestion_item_id" uuid,
	"action" "reconciliation_projection_outbox_action" NOT NULL,
	"status" "reconciliation_projection_outbox_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_evidence" ADD CONSTRAINT "reconciliation_evidence_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_evidence" ADD CONSTRAINT "reconciliation_evidence_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_evidence" ADD CONSTRAINT "reconciliation_evidence_visibility_owner_user_id_users_id_fk" FOREIGN KEY ("visibility_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_evidence_anchors" ADD CONSTRAINT "reconciliation_evidence_anchors_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_evidence_anchors" ADD CONSTRAINT "reconciliation_evidence_anchors_evidence_id_reconciliation_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."reconciliation_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_evidence_associations" ADD CONSTRAINT "artifact_evidence_associations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_evidence_associations" ADD CONSTRAINT "artifact_evidence_associations_cluster_id_artifact_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."artifact_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_evidence_associations" ADD CONSTRAINT "artifact_evidence_associations_evidence_id_reconciliation_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."reconciliation_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_evidence_associations" ADD CONSTRAINT "artifact_evidence_associations_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_evidence_associations" ADD CONSTRAINT "artifact_evidence_associations_visibility_owner_user_id_users_id_fk" FOREIGN KEY ("visibility_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_evidence_associations" ADD CONSTRAINT "artifact_evidence_associations_visibility_floor_owner_user_id_users_id_fk" FOREIGN KEY ("visibility_floor_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_outputs" ADD CONSTRAINT "reconciliation_outputs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_outputs" ADD CONSTRAINT "reconciliation_outputs_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_outputs" ADD CONSTRAINT "reconciliation_outputs_cluster_id_artifact_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."artifact_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_outputs" ADD CONSTRAINT "reconciliation_outputs_visibility_owner_user_id_users_id_fk" FOREIGN KEY ("visibility_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_outputs" ADD CONSTRAINT "reconciliation_outputs_visibility_floor_owner_user_id_users_id_fk" FOREIGN KEY ("visibility_floor_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_projection_outbox" ADD CONSTRAINT "reconciliation_projection_outbox_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_projection_outbox" ADD CONSTRAINT "reconciliation_projection_outbox_output_id_reconciliation_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."reconciliation_outputs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_projection_outbox" ADD CONSTRAINT "reconciliation_projection_outbox_suggestion_id_agent_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."agent_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_projection_outbox" ADD CONSTRAINT "reconciliation_projection_outbox_suggestion_item_id_agent_suggestion_items_id_fk" FOREIGN KEY ("suggestion_item_id") REFERENCES "public"."agent_suggestion_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_clusters_team_kind_status_idx" ON "artifact_clusters" USING btree ("team_id", "artifact_cluster_kind", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_evidence_team_dedupe_unq" ON "reconciliation_evidence" USING btree ("team_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX "reconciliation_evidence_team_raw_version_idx" ON "reconciliation_evidence" USING btree ("team_id", "raw_event_id", "normalizer_version");--> statement-breakpoint
CREATE INDEX "reconciliation_evidence_team_source_occurred_idx" ON "reconciliation_evidence" USING btree ("team_id", "source", "occurred_at");--> statement-breakpoint
CREATE INDEX "reconciliation_evidence_team_visibility_owner_idx" ON "reconciliation_evidence" USING btree ("team_id", "visibility_owner_user_id");--> statement-breakpoint
CREATE INDEX "reconciliation_evidence_payload_digest_idx" ON "reconciliation_evidence" USING btree ("team_id", "payload_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_evidence_anchors_team_evidence_anchor_unq" ON "reconciliation_evidence_anchors" USING btree ("team_id", "evidence_id", "anchor_type", "anchor_value", "source");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_evidence_anchors_team_dedupe_unq" ON "reconciliation_evidence_anchors" USING btree ("team_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX "reconciliation_evidence_anchors_team_anchor_idx" ON "reconciliation_evidence_anchors" USING btree ("team_id", "anchor_type", "anchor_value");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_evidence_associations_cluster_evidence_role_unq" ON "artifact_evidence_associations" USING btree ("team_id", "cluster_id", "evidence_id", "role", "association_source");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_evidence_associations_team_dedupe_unq" ON "artifact_evidence_associations" USING btree ("team_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX "artifact_evidence_associations_team_cluster_idx" ON "artifact_evidence_associations" USING btree ("team_id", "cluster_id");--> statement-breakpoint
CREATE INDEX "artifact_evidence_associations_team_evidence_idx" ON "artifact_evidence_associations" USING btree ("team_id", "evidence_id");--> statement-breakpoint
CREATE INDEX "artifact_evidence_associations_team_visibility_owner_idx" ON "artifact_evidence_associations" USING btree ("team_id", "visibility_owner_user_id");--> statement-breakpoint
CREATE INDEX "artifact_evidence_associations_team_visibility_floor_owner_idx" ON "artifact_evidence_associations" USING btree ("team_id", "visibility_floor_owner_user_id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_team_status_idx" ON "reconciliation_runs" USING btree ("team_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_team_scope_idx" ON "reconciliation_runs" USING btree ("team_id", "scope");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_runs_team_fingerprint_unq" ON "reconciliation_runs" USING btree ("team_id", "input_fingerprint", "engine_version");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_outputs_team_dedupe_unq" ON "reconciliation_outputs" USING btree ("team_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX "reconciliation_outputs_team_run_status_idx" ON "reconciliation_outputs" USING btree ("team_id", "run_id", "status");--> statement-breakpoint
CREATE INDEX "reconciliation_outputs_team_cluster_kind_status_idx" ON "reconciliation_outputs" USING btree ("team_id", "cluster_id", "output_kind", "status");--> statement-breakpoint
CREATE INDEX "reconciliation_outputs_team_visibility_owner_idx" ON "reconciliation_outputs" USING btree ("team_id", "visibility_owner_user_id");--> statement-breakpoint
CREATE INDEX "reconciliation_outputs_team_visibility_floor_owner_idx" ON "reconciliation_outputs" USING btree ("team_id", "visibility_floor_owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_projection_outbox_team_dedupe_unq" ON "reconciliation_projection_outbox" USING btree ("team_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX "reconciliation_projection_outbox_team_status_idx" ON "reconciliation_projection_outbox" USING btree ("team_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "reconciliation_projection_outbox_team_output_idx" ON "reconciliation_projection_outbox" USING btree ("team_id", "output_id");--> statement-breakpoint
CREATE INDEX "reconciliation_projection_outbox_team_suggestion_item_idx" ON "reconciliation_projection_outbox" USING btree ("team_id", "suggestion_item_id");
