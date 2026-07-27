CREATE TYPE "public"."chat_surface_turn_status" AS ENUM(
  'queued',
  'processing',
  'answered',
  'delivered',
  'timed_out',
  'failed',
  'cancelled'
);
--> statement-breakpoint
ALTER TABLE "chat_sessions"
ADD COLUMN "surface" text DEFAULT 'web' NOT NULL;
--> statement-breakpoint
CREATE TABLE "chat_surface_session_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surface" text NOT NULL,
  "external_conversation_key" text NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "chat_session_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_surface_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surface" text NOT NULL,
  "external_event_id" text NOT NULL,
  "external_message_id" text NOT NULL,
  "external_conversation_key" text NOT NULL,
  "external_user_key" text NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "chat_session_id" uuid NOT NULL,
  "question_text" text NOT NULL,
  "answer_text" text,
  "status" "chat_surface_turn_status" DEFAULT 'queued' NOT NULL,
  "error_code" text,
  "requested_model_id" text,
  "response_model_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "answered_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_surface_session_links"
ADD CONSTRAINT "chat_surface_session_links_team_id_teams_id_fk"
FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_surface_session_links"
ADD CONSTRAINT "chat_surface_session_links_user_id_users_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_surface_session_links"
ADD CONSTRAINT "chat_surface_session_links_chat_session_id_chat_sessions_id_fk"
FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_surface_turns"
ADD CONSTRAINT "chat_surface_turns_team_id_teams_id_fk"
FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_surface_turns"
ADD CONSTRAINT "chat_surface_turns_user_id_users_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_surface_turns"
ADD CONSTRAINT "chat_surface_turns_chat_session_id_chat_sessions_id_fk"
FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_surface_session_links_surface_conversation_unq"
ON "chat_surface_session_links" USING btree ("surface", "external_conversation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_surface_session_links_session_unq"
ON "chat_surface_session_links" USING btree ("chat_session_id");
--> statement-breakpoint
CREATE INDEX "chat_surface_session_links_team_idx"
ON "chat_surface_session_links" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX "chat_surface_session_links_user_idx"
ON "chat_surface_session_links" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_surface_turns_surface_event_unq"
ON "chat_surface_turns" USING btree ("surface", "external_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_surface_turns_active_conversation_unq"
ON "chat_surface_turns" USING btree ("surface", "external_conversation_key")
WHERE "status" IN ('queued', 'processing');
--> statement-breakpoint
CREATE INDEX "chat_surface_turns_team_idx"
ON "chat_surface_turns" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX "chat_surface_turns_user_idx"
ON "chat_surface_turns" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "chat_surface_turns_session_idx"
ON "chat_surface_turns" USING btree ("chat_session_id");
--> statement-breakpoint
CREATE INDEX "chat_surface_turns_status_idx"
ON "chat_surface_turns" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "chat_surface_turns_created_idx"
ON "chat_surface_turns" USING btree ("created_at");
