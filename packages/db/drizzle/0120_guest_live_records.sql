ALTER TABLE "guest_record_shares"
  ADD COLUMN "live" boolean DEFAULT false NOT NULL,
  ALTER COLUMN "title" DROP NOT NULL,
  ALTER COLUMN "body" DROP NOT NULL,
  DROP CONSTRAINT "guest_record_shares_title_check",
  DROP CONSTRAINT "guest_record_shares_body_check",
  ADD CONSTRAINT "guest_record_shares_content_check" CHECK (
    ("live" AND "title" IS NULL AND "body" IS NULL)
    OR (NOT "live" AND "title" IS NOT NULL AND "body" IS NOT NULL
      AND char_length("title") BETWEEN 1 AND 200 AND char_length("body") BETWEEN 1 AND 8000)
  );
--> statement-breakpoint
CREATE INDEX "raw_events_guest_object_audit_idx"
  ON "raw_events" ("team_id", ("source_metadata" ->> 'entity_id'))
  WHERE "source" = 'system' AND "source_metadata" ->> 'source_snapshot_kind' = 'system_direct_write_event';
--> statement-breakpoint
CREATE INDEX "reconciliation_outputs_guest_record_idx"
  ON "reconciliation_outputs" ("team_id", (COALESCE("payload" ->> 'projection_result_id', "target_id"::text)))
  WHERE "status" = 'applied' AND "output_kind" = 'approval_bundle';
