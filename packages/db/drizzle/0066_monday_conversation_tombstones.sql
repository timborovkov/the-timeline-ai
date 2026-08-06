CREATE TABLE "monday_conversation_tombstones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "provider" "integration_provider" NOT NULL,
  "update_id" text NOT NULL,
  "reply_id" text,
  "target_key" text NOT NULL,
  "reason" text NOT NULL,
  "source_event_dedup_key" text NOT NULL,
  "deleted_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "monday_conversation_tombstones_provider_chk" CHECK ("monday_conversation_tombstones"."provider" = 'monday')
);
--> statement-breakpoint
ALTER TABLE "monday_conversation_tombstones"
ADD CONSTRAINT "monday_conversation_tombstones_team_id_teams_id_fk"
FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monday_conversation_tombstones"
ADD CONSTRAINT "monday_conversation_tombstones_integration_id_integrations_id_fk"
FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "monday_conversation_tombstones_team_integration_idx"
ON "monday_conversation_tombstones" USING btree ("team_id", "integration_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "monday_conversation_tombstones_target_unq"
ON "monday_conversation_tombstones" USING btree ("team_id", "integration_id", "target_key");
--> statement-breakpoint
CREATE TABLE "monday_conversation_tombstone_invalidations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "target_key" text NOT NULL,
  "raw_event_id" uuid NOT NULL,
  "invalidated_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monday_conversation_tombstone_invalidations"
ADD CONSTRAINT "monday_conversation_tombstone_invalidations_team_id_teams_id_fk"
FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monday_conversation_tombstone_invalidations"
ADD CONSTRAINT "monday_conversation_tombstone_invalidations_integration_id_integrations_id_fk"
FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monday_conversation_tombstone_invalidations"
ADD CONSTRAINT "monday_conversation_tombstone_invalidations_raw_event_id_raw_events_id_fk"
FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "monday_conversation_tombstone_invalidations_target_unq"
ON "monday_conversation_tombstone_invalidations" USING btree ("team_id", "integration_id", "target_key", "raw_event_id");
--> statement-breakpoint
CREATE INDEX "monday_conversation_tombstone_invalidations_pending_idx"
ON "monday_conversation_tombstone_invalidations" USING btree ("integration_id", "invalidated_at");
