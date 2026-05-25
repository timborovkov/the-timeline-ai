-- Phase 9: Team Document Drive. Folders/documents/versions/chunks + a
-- `document` value on the existing event_source enum so every document
-- activity (upload, new version, rename, move, delete, restore,
-- visibility change) lands in raw_events and rides the existing timeline,
-- notification, and visibility-filter plumbing.
--
-- Notes on safety:
--   * All folders/documents are soft-deleted (`deleted_at`); object blobs
--     in RustFS are never removed by this migration.
--   * The unique indexes on (team, parent/folder, lower(name)) use
--     COALESCE on the nullable parent/folder column so a NULL "root"
--     produces a stable key — Postgres treats NULL = NULL as unknown in
--     btree dedup otherwise, and two "Contracts" folders at the team root
--     would slip past.
--   * documents.current_version_id is nullable while a doc has no
--     finalised version, then pinned to the latest version row. FK added
--     after document_versions exists.

ALTER TYPE "public"."event_source" ADD VALUE IF NOT EXISTS 'document';--> statement-breakpoint

CREATE TYPE "public"."document_processing_status" AS ENUM('pending','extracting','chunked','embedded','failed');--> statement-breakpoint

CREATE TABLE "folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "parent_folder_id" uuid,
  "name" text NOT NULL,
  "owner_user_id" uuid,
  "visibility" "event_visibility" DEFAULT 'team' NOT NULL,
  "visibility_user_ids" uuid[],
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_folder_id_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_team_parent_idx" ON "folders" USING btree ("team_id","parent_folder_id");--> statement-breakpoint
CREATE INDEX "folders_team_active_idx" ON "folders" USING btree ("team_id") WHERE "folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_team_parent_name_unq" ON "folders" USING btree ("team_id", COALESCE("parent_folder_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name")) WHERE "folders"."deleted_at" IS NULL;--> statement-breakpoint

CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "folder_id" uuid,
  "name" text NOT NULL,
  "current_version_id" uuid,
  "owner_user_id" uuid,
  "visibility" "event_visibility" DEFAULT 'team' NOT NULL,
  "visibility_user_ids" uuid[],
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_team_folder_idx" ON "documents" USING btree ("team_id","folder_id");--> statement-breakpoint
CREATE INDEX "documents_team_active_idx" ON "documents" USING btree ("team_id") WHERE "documents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "documents_team_owner_idx" ON "documents" USING btree ("team_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_team_folder_name_unq" ON "documents" USING btree ("team_id", COALESCE("folder_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name")) WHERE "documents"."deleted_at" IS NULL;--> statement-breakpoint

CREATE TABLE "document_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "object_key" text NOT NULL,
  "byte_size" bigint,
  "content_type" text,
  "checksum_sha256" text,
  "uploaded_by_user_id" uuid,
  "source_event_id" uuid,
  "processing_status" "document_processing_status" DEFAULT 'pending' NOT NULL,
  "processing_error" text,
  "extraction_model_version" text,
  "embedding_model_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_source_event_id_raw_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version_unq" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "document_versions_team_idx" ON "document_versions" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "document_versions_status_idx" ON "document_versions" USING btree ("processing_status");--> statement-breakpoint

-- Now that document_versions exists, wire the documents.current_version_id
-- back-reference. ON DELETE set null so deleting a stray version doesn't
-- cascade-kill the document row.
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_document_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "text" text NOT NULL,
  "token_count" integer NOT NULL,
  "page_number" integer,
  "summary" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_version_index_unq" ON "document_chunks" USING btree ("document_version_id","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunks_team_idx" ON "document_chunks" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "document_chunks_document_idx" ON "document_chunks" USING btree ("document_id");
