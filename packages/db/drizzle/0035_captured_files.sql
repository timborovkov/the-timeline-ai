-- Captured files share document storage but are not curated document-drive
-- items until promotion. This migration intentionally reshapes the schema
-- directly; the product is not preserving legacy compatibility with the old
-- "every attachment is a document" model.

CREATE TYPE "public"."file_kind" AS ENUM('captured','document');--> statement-breakpoint
CREATE TYPE "public"."extracted_representation_kind" AS ENUM('source_text','transcript','visual_description','metadata_preview');--> statement-breakpoint

ALTER TYPE "public"."document_processing_status" ADD VALUE IF NOT EXISTS 'deferred';--> statement-breakpoint

ALTER TABLE "documents" ADD COLUMN "file_kind" "file_kind" DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_raw_event_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "promoted_by_user_id" uuid;--> statement-breakpoint

ALTER TABLE "documents" ADD CONSTRAINT "documents_source_raw_event_id_raw_events_id_fk" FOREIGN KEY ("source_raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_captured_folder_null_chk" CHECK ("file_kind" = 'document' OR "folder_id" IS NULL);--> statement-breakpoint

ALTER TABLE "document_chunks" ADD COLUMN "representation_kind" "extracted_representation_kind" DEFAULT 'source_text' NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "documents_team_folder_name_unq";--> statement-breakpoint
CREATE UNIQUE INDEX "documents_team_folder_name_unq"
  ON "documents" USING btree (
    "team_id",
    COALESCE("folder_id", '00000000-0000-0000-0000-000000000000'::uuid),
    lower("name")
  )
  WHERE "documents"."deleted_at" IS NULL AND "documents"."file_kind" = 'document';--> statement-breakpoint

CREATE INDEX "documents_team_kind_idx" ON "documents" USING btree ("team_id","file_kind");--> statement-breakpoint
CREATE INDEX "documents_source_raw_event_idx" ON "documents" USING btree ("team_id","source_raw_event_id");
