UPDATE "google_drive_file_snapshots"
  SET "comments_hash" = COALESCE("comments_hash", ''),
      "permissions_hash" = COALESCE("permissions_hash", '');
--> statement-breakpoint
ALTER TABLE "google_drive_file_snapshots"
  ALTER COLUMN "comments_hash" SET DEFAULT '',
  ALTER COLUMN "comments_hash" SET NOT NULL,
  ALTER COLUMN "permissions_hash" SET DEFAULT '',
  ALTER COLUMN "permissions_hash" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "google_drive_file_snapshots_hash_unq";
--> statement-breakpoint
CREATE UNIQUE INDEX "google_drive_file_snapshots_hash_unq"
  ON "google_drive_file_snapshots" (
    "integration_id",
    "file_id",
    "content_hash",
    "comments_hash",
    "permissions_hash"
  );
