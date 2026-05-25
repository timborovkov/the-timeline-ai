-- Phase 11 follow-up: documents.metadata jsonb so Drive (and any future
-- integration that harvests file bodies) can stamp the external id and
-- reuse the same document row on subsequent syncs.
--
-- Partial index on the integration external id supports the idempotent
-- lookup that the integration-sync worker uses before creating a new
-- document row.

ALTER TABLE "documents" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

CREATE INDEX "documents_integration_external_id_idx"
  ON "documents" USING btree (
    "team_id",
    ((metadata ->> 'integration_provider')),
    ((metadata ->> 'integration_external_id'))
  )
  WHERE metadata ? 'integration_external_id';
