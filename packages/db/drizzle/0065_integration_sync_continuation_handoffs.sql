-- Pagination continuations cross a Postgres-to-Redis boundary. Keep each
-- target in a durable outbox until a worker has acknowledged a stable BullMQ
-- handoff id; a lease makes a process crash recoverable without duplicate
-- active claims.
CREATE TABLE "integration_sync_continuation_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid NOT NULL,
  "resource_type" text NOT NULL,
  "external_id" text NOT NULL,
  "surface" text DEFAULT '' NOT NULL,
  "retry_at" timestamp with time zone,
  "continuation_attempt" integer DEFAULT 0 NOT NULL,
  "claim_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_sync_continuation_handoffs"
  ADD CONSTRAINT "integration_sync_continuation_handoffs_integration_id_integrations_id_fk"
  FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_continuation_handoffs_target_unq"
  ON "integration_sync_continuation_handoffs"
  USING btree ("integration_id", "resource_type", "external_id", "surface");
--> statement-breakpoint
CREATE INDEX "integration_sync_continuation_handoffs_lease_idx"
  ON "integration_sync_continuation_handoffs"
  USING btree ("integration_id", "lease_expires_at");
--> statement-breakpoint

-- Preserve the short-lived cursor implementation's already durable work while
-- moving to the outbox. Invalid legacy targets were ignored by the old reader
-- too, and a later retry deadline always wins when duplicate rows merge.
INSERT INTO "integration_sync_continuation_handoffs" (
  "integration_id",
  "resource_type",
  "external_id",
  "surface",
  "retry_at"
)
SELECT
  state."integration_id",
  continuation.value ->> 'resource_type',
  continuation.value ->> 'external_id',
  COALESCE(continuation.value ->> 'surface', ''),
  CASE
    WHEN COALESCE(continuation.value ->> 'retry_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$'
      THEN (continuation.value ->> 'retry_at')::timestamp with time zone
    ELSE NULL
  END
FROM "integration_sync_state" AS state
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(state."cursor" -> 'pending_continuations') = 'array'
      THEN state."cursor" -> 'pending_continuations'
    ELSE '[]'::jsonb
  END
) AS continuation(value)
WHERE state."resource_type" = 'integration.pagination_continuations'
  AND jsonb_typeof(continuation.value) = 'object'
  AND COALESCE(continuation.value ->> 'resource_type', '') <> ''
  AND COALESCE(continuation.value ->> 'external_id', '') <> ''
ON CONFLICT ("integration_id", "resource_type", "external_id", "surface")
DO UPDATE SET
  "retry_at" = GREATEST(
    "integration_sync_continuation_handoffs"."retry_at",
    EXCLUDED."retry_at"
  ),
  "updated_at" = now();
--> statement-breakpoint
UPDATE "integration_sync_state"
SET "cursor" = '{}', "updated_at" = now()
WHERE "resource_type" = 'integration.pagination_continuations';
