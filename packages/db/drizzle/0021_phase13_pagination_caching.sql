-- Phase 13.6: pagination/caching support.

CREATE INDEX IF NOT EXISTS "raw_events_team_occurred_id_idx"
  ON "raw_events" USING btree ("team_id", "occurred_at", "id");
CREATE INDEX IF NOT EXISTS "raw_events_team_author_occurred_id_idx"
  ON "raw_events" USING btree ("team_id", "author_user_id", "occurred_at", "id");
CREATE INDEX IF NOT EXISTS "raw_events_team_source_occurred_id_idx"
  ON "raw_events" USING btree ("team_id", "source", "occurred_at", "id");

CREATE INDEX IF NOT EXISTS "object_changes_team_entity_changed_id_idx"
  ON "object_changes" USING btree ("team_id", "entity_id", "changed_at", "id");
CREATE INDEX IF NOT EXISTS "object_notes_team_entity_created_id_idx"
  ON "object_notes" USING btree ("team_id", "entity_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "entity_relationships_team_from_created_idx"
  ON "entity_relationships" USING btree ("team_id", "from_entity_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "entity_relationships_team_to_created_idx"
  ON "entity_relationships" USING btree ("team_id", "to_entity_id", "created_at", "id");

CREATE INDEX IF NOT EXISTS "documents_team_folder_updated_id_idx"
  ON "documents" USING btree ("team_id", "folder_id", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "document_chunks_team_document_idx"
  ON "document_chunks" USING btree ("team_id", "document_id");

CREATE TABLE IF NOT EXISTS "team_onboarding_state" (
  "team_id" uuid PRIMARY KEY REFERENCES "teams"("id") ON DELETE cascade,
  "completed_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_onboarding_state" (
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "dismissed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_onboarding_state_team_id_user_id_pk" PRIMARY KEY ("team_id", "user_id")
);
