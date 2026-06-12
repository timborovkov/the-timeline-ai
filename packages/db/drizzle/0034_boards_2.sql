CREATE TYPE "public"."board_template_kind" AS ENUM('pipeline', 'task_board', 'catalog', 'custom');--> statement-breakpoint
CREATE TYPE "public"."board_lane_kind" AS ENUM('active', 'done', 'terminal', 'lost', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."board_item_change_actor_kind" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."board_item_change_status" AS ENUM('applied', 'suggested', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."agent_suggestion_target_kind" ADD VALUE IF NOT EXISTS 'board_membership';--> statement-breakpoint
ALTER TYPE "public"."agent_suggestion_target_kind" ADD VALUE IF NOT EXISTS 'board_item_update';--> statement-breakpoint
CREATE TABLE "boards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "created_by" uuid,
  "name" text NOT NULL,
  "purpose" text DEFAULT '' NOT NULL,
  "template_kind" "board_template_kind" DEFAULT 'custom' NOT NULL,
  "recommended_object_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "strict_object_types" boolean DEFAULT false NOT NULL,
  "candidate_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_shared" boolean DEFAULT true NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "board_lanes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "board_id" uuid NOT NULL,
  "name" text NOT NULL,
  "position" integer NOT NULL,
  "kind" "board_lane_kind",
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "board_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "board_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "lane_id" uuid,
  "position" integer DEFAULT 0 NOT NULL,
  "responsible_user_id" uuid,
  "due_at" timestamp with time zone,
  "priority" integer,
  "next_step" text,
  "notes" text,
  "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "board_item_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "board_id" uuid NOT NULL,
  "board_item_id" uuid,
  "entity_id" uuid NOT NULL,
  "actor_kind" "board_item_change_actor_kind" NOT NULL,
  "actor_user_id" uuid,
  "status" "board_item_change_status" DEFAULT 'applied' NOT NULL,
  "field" text NOT NULL,
  "previous_value" jsonb,
  "new_value" jsonb,
  "source_event_id" uuid,
  "suggestion_item_id" uuid,
  "note" text,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "board_pins" (
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "board_id" uuid NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "entities_team_id_unq" ON "entities" USING btree ("team_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_team_id_unq" ON "raw_events" USING btree ("team_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_suggestion_items_team_id_unq" ON "agent_suggestion_items" USING btree ("team_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_team_id_unq" ON "boards" USING btree ("team_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_lanes_team_id_unq" ON "board_lanes" USING btree ("team_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_items_team_id_unq" ON "board_items" USING btree ("team_id","id");--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_lanes" ADD CONSTRAINT "board_lanes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_lanes" ADD CONSTRAINT "board_lanes_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_lanes" ADD CONSTRAINT "board_lanes_team_board_fk" FOREIGN KEY ("team_id","board_id") REFERENCES "public"."boards"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_lane_id_board_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."board_lanes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_team_board_fk" FOREIGN KEY ("team_id","board_id") REFERENCES "public"."boards"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_team_entity_fk" FOREIGN KEY ("team_id","entity_id") REFERENCES "public"."entities"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_team_lane_fk" FOREIGN KEY ("team_id","lane_id") REFERENCES "public"."board_lanes"("team_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_board_item_id_board_items_id_fk" FOREIGN KEY ("board_item_id") REFERENCES "public"."board_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_source_event_id_raw_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_suggestion_item_id_agent_suggestion_items_id_fk" FOREIGN KEY ("suggestion_item_id") REFERENCES "public"."agent_suggestion_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_team_board_fk" FOREIGN KEY ("team_id","board_id") REFERENCES "public"."boards"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_team_item_fk" FOREIGN KEY ("team_id","board_item_id") REFERENCES "public"."board_items"("team_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_team_entity_fk" FOREIGN KEY ("team_id","entity_id") REFERENCES "public"."entities"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_team_source_event_fk" FOREIGN KEY ("team_id","source_event_id") REFERENCES "public"."raw_events"("team_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_team_suggestion_item_fk" FOREIGN KEY ("team_id","suggestion_item_id") REFERENCES "public"."agent_suggestion_items"("team_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_pins" ADD CONSTRAINT "board_pins_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_pins" ADD CONSTRAINT "board_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_pins" ADD CONSTRAINT "board_pins_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_pins" ADD CONSTRAINT "board_pins_team_board_fk" FOREIGN KEY ("team_id","board_id") REFERENCES "public"."boards"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boards_team_archived_idx" ON "boards" USING btree ("team_id","archived_at");--> statement-breakpoint
CREATE INDEX "boards_team_updated_idx" ON "boards" USING btree ("team_id","updated_at");--> statement-breakpoint
CREATE INDEX "board_lanes_team_board_position_idx" ON "board_lanes" USING btree ("team_id","board_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "board_items_team_board_entity_active_unq" ON "board_items" USING btree ("team_id","board_id","entity_id") WHERE "board_items"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "board_items_team_board_lane_position_idx" ON "board_items" USING btree ("team_id","board_id","lane_id","position");--> statement-breakpoint
CREATE INDEX "board_items_team_entity_idx" ON "board_items" USING btree ("team_id","entity_id");--> statement-breakpoint
CREATE INDEX "board_items_team_responsible_idx" ON "board_items" USING btree ("team_id","responsible_user_id");--> statement-breakpoint
CREATE INDEX "board_items_team_due_idx" ON "board_items" USING btree ("team_id","due_at");--> statement-breakpoint
CREATE INDEX "board_item_changes_team_item_changed_idx" ON "board_item_changes" USING btree ("team_id","board_item_id","changed_at");--> statement-breakpoint
CREATE INDEX "board_item_changes_team_board_changed_idx" ON "board_item_changes" USING btree ("team_id","board_id","changed_at");--> statement-breakpoint
CREATE INDEX "board_item_changes_team_status_idx" ON "board_item_changes" USING btree ("team_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "board_pins_team_user_board_unq" ON "board_pins" USING btree ("team_id","user_id","board_id");--> statement-breakpoint
CREATE INDEX "board_pins_team_user_position_idx" ON "board_pins" USING btree ("team_id","user_id","position");
