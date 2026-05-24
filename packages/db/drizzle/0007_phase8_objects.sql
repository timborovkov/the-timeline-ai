-- Phase 8: workspace objects, audit, notes, views, boards, notifications, chat sessions.
--
-- Extends `entities` in place rather than introducing a parallel `objects`
-- table — same canonical resolver, same fact_entities wiring, same agent
-- tools work unchanged. New enum values are appended; existing values keep
-- their meaning. Existing rows safely default to status='open',
-- agent_suggested=false, archived_at=NULL.

ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'deal';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'vendor';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'incident';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'document';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'decision';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'hiring_loop';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'task';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'follow_up';--> statement-breakpoint

CREATE TYPE "public"."relationship_kind" AS ENUM('parent','child','related','blocks','blocked_by','duplicate_of','linked');--> statement-breakpoint
CREATE TYPE "public"."object_change_actor_kind" AS ENUM('user','agent','system');--> statement-breakpoint
CREATE TYPE "public"."object_change_status" AS ENUM('applied','suggested','rejected');--> statement-breakpoint
CREATE TYPE "public"."board_kind" AS ENUM('kanban','table','list');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('object_changed','task_due','task_overdue','follow_up_overdue','mention','agent_suggestion');--> statement-breakpoint
CREATE TYPE "public"."chat_message_role" AS ENUM('user','assistant','tool','system');--> statement-breakpoint

ALTER TABLE "entities" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "priority" smallint;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "assignee_user_id" uuid;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "agent_suggested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "entities" ADD CONSTRAINT "entities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_source_event_id_raw_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Narrow the case-insensitive-name uniqueness to extraction-derived types.
-- User-authored types (task, follow_up, deal, incident, hiring_loop) name
-- human work that legitimately repeats — teams create many "follow up with
-- Acme" tasks — so they're excluded. Drop + recreate is safe here because
-- 0007 ships in one batch; no production rows depend on the old shape.
-- The narrowed unique-index predicate that references the new enum values
-- (vendor/document/decision) cannot live here: Postgres forbids using an
-- enum value in the same transaction as the ALTER TYPE ADD VALUE that
-- introduced it (SQLSTATE 55P04). It ships in a separate migration that
-- runs after 0007 commits — see 0009_phase8_entity_unq.sql.
CREATE INDEX "entities_team_type_status_idx" ON "entities" USING btree ("team_id","type","status");--> statement-breakpoint
CREATE INDEX "entities_team_owner_idx" ON "entities" USING btree ("team_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "entities_team_assignee_idx" ON "entities" USING btree ("team_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "entities_team_due_idx" ON "entities" USING btree ("team_id","due_at");--> statement-breakpoint
CREATE INDEX "entities_team_active_idx" ON "entities" USING btree ("team_id") WHERE "entities"."archived_at" IS NULL;--> statement-breakpoint

CREATE TABLE "entity_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "from_entity_id" uuid NOT NULL,
  "to_entity_id" uuid NOT NULL,
  "kind" "relationship_kind" NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_to_entity_id_entities_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_relationships_edge_unq" ON "entity_relationships" USING btree ("from_entity_id","to_entity_id","kind");--> statement-breakpoint
CREATE INDEX "entity_relationships_team_idx" ON "entity_relationships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_from_idx" ON "entity_relationships" USING btree ("from_entity_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_to_idx" ON "entity_relationships" USING btree ("to_entity_id");--> statement-breakpoint

CREATE TABLE "object_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "actor_kind" "object_change_actor_kind" NOT NULL,
  "status" "object_change_status" DEFAULT 'applied' NOT NULL,
  "field" text NOT NULL,
  "previous_value" jsonb,
  "new_value" jsonb,
  "source_event_id" uuid,
  "note" text,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "object_changes" ADD CONSTRAINT "object_changes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_changes" ADD CONSTRAINT "object_changes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_changes" ADD CONSTRAINT "object_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_changes" ADD CONSTRAINT "object_changes_source_event_id_raw_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_changes_team_entity_changed_idx" ON "object_changes" USING btree ("team_id","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "object_changes_team_status_idx" ON "object_changes" USING btree ("team_id","status");--> statement-breakpoint

CREATE TABLE "object_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "author_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "object_notes" ADD CONSTRAINT "object_notes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_notes" ADD CONSTRAINT "object_notes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_notes" ADD CONSTRAINT "object_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_notes_team_entity_idx" ON "object_notes" USING btree ("team_id","entity_id");--> statement-breakpoint
CREATE INDEX "object_notes_author_idx" ON "object_notes" USING btree ("author_user_id");--> statement-breakpoint

CREATE TABLE "object_views" (
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "last_visited_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "object_views_team_id_user_id_entity_id_pk" PRIMARY KEY("team_id","user_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "object_views" ADD CONSTRAINT "object_views_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_views" ADD CONSTRAINT "object_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_views" ADD CONSTRAINT "object_views_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "board_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "created_by" uuid,
  "name" text NOT NULL,
  "kind" "board_kind" NOT NULL,
  "filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "group_by" text,
  "sort" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_shared" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_views" ADD CONSTRAINT "board_views_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_views" ADD CONSTRAINT "board_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_views_team_shared_idx" ON "board_views" USING btree ("team_id","is_shared");--> statement-breakpoint
CREATE INDEX "board_views_created_by_idx" ON "board_views" USING btree ("created_by");--> statement-breakpoint

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" "notification_kind" NOT NULL,
  "entity_id" uuid,
  "object_change_id" uuid,
  "summary" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_object_change_id_object_changes_id_fk" FOREIGN KEY ("object_change_id") REFERENCES "public"."object_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_team_user_inbox_idx" ON "notifications" USING btree ("team_id" ASC, "user_id" ASC, "read_at" ASC NULLS FIRST, "created_at" DESC);--> statement-breakpoint
CREATE INDEX "notifications_team_entity_idx" ON "notifications" USING btree ("team_id","entity_id");--> statement-breakpoint

CREATE TABLE "chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "created_by" uuid,
  "title" text,
  "pinned_entity_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_pinned_entity_id_entities_id_fk" FOREIGN KEY ("pinned_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_sessions_team_updated_idx" ON "chat_sessions" USING btree ("team_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_team_pinned_idx" ON "chat_sessions" USING btree ("team_id","pinned_entity_id");--> statement-breakpoint

CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "role" "chat_message_role" NOT NULL,
  "author_user_id" uuid,
  "content" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_session_created_idx" ON "chat_messages" USING btree ("session_id","created_at");
