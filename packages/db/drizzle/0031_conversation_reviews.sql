CREATE TABLE "conversation_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
  "conversation_key" text NOT NULL,
  "source" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "last_raw_event_id" uuid REFERENCES "raw_events"("id") ON DELETE set null,
  "reviewed_through_raw_event_id" uuid REFERENCES "raw_events"("id") ON DELETE set null,
  "reviewed_through_occurred_at" timestamp with time zone,
  "quiet_until" timestamp with time zone NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "conversation_reviews_team_key_unq"
  ON "conversation_reviews" ("team_id", "conversation_key");

CREATE INDEX "conversation_reviews_team_status_quiet_idx"
  ON "conversation_reviews" ("team_id", "status", "quiet_until");

CREATE INDEX "conversation_reviews_last_raw_event_idx"
  ON "conversation_reviews" ("team_id", "last_raw_event_id");

CREATE INDEX "conversation_reviews_metadata_idx"
  ON "conversation_reviews" USING gin ("metadata");
