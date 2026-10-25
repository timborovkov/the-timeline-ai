ALTER TYPE "public"."connection_attention_category" ADD VALUE IF NOT EXISTS 'access_revoked';--> statement-breakpoint
ALTER TABLE "integrations"
  ADD COLUMN "health_consecutive_failures" integer NOT NULL DEFAULT 0,
  ADD COLUMN "health_first_failed_at" timestamp with time zone,
  ADD COLUMN "health_paused_at" timestamp with time zone,
  ADD COLUMN "health_pause_kind" text,
  ADD COLUMN "health_owner_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations"
  ADD CONSTRAINT "integrations_health_consecutive_failures_chk"
  CHECK ("health_consecutive_failures" >= 0);--> statement-breakpoint
ALTER TABLE "integrations"
  ADD CONSTRAINT "integrations_health_pause_kind_chk"
  CHECK (
    ("health_paused_at" IS NULL AND "health_pause_kind" IS NULL)
    OR (
      "health_paused_at" IS NOT NULL
      AND "health_pause_kind" IS NOT NULL
      AND "health_pause_kind" IN ('access_revoked', 'connectivity', 'auth', 'permanent')
    )
  );--> statement-breakpoint
CREATE INDEX "integrations_health_paused_idx"
  ON "integrations" ("health_paused_at")
  WHERE "health_paused_at" IS NOT NULL;
