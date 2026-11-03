ALTER TABLE "integration_selections"
  ADD COLUMN "linked_object_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_selections"
  ADD CONSTRAINT "integration_selections_linked_object_fk"
    FOREIGN KEY ("linked_object_id") REFERENCES "public"."entities"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "integration_selections_linked_object_idx"
  ON "integration_selections" ("linked_object_id")
  WHERE "linked_object_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "google_drive_file_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "file_id" text NOT NULL,
  "content_hash" text NOT NULL,
  "snapshot_text" text NOT NULL DEFAULT '',
  "comments_hash" text,
  "permissions_hash" text,
  "comments_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "mime_type" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "google_drive_file_snapshots"
  ADD CONSTRAINT "google_drive_file_snapshots_team_fk"
    FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "google_drive_file_snapshots"
  ADD CONSTRAINT "google_drive_file_snapshots_integration_fk"
    FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "google_drive_file_snapshots_hash_unq"
  ON "google_drive_file_snapshots" ("integration_id", "file_id", "content_hash");--> statement-breakpoint
CREATE INDEX "google_drive_file_snapshots_file_created_idx"
  ON "google_drive_file_snapshots" ("integration_id", "file_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "google_drive_file_snapshots_team_idx"
  ON "google_drive_file_snapshots" ("team_id", "created_at");
