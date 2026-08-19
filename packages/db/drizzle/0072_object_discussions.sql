CREATE TABLE "object_note_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"mentioned_user_id" uuid,
	"kind" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "object_note_mentions" ADD CONSTRAINT "object_note_mentions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_note_mentions" ADD CONSTRAINT "object_note_mentions_note_id_object_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."object_notes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_note_mentions" ADD CONSTRAINT "object_note_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_note_mentions" ADD CONSTRAINT "object_note_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "object_note_mentions" ADD CONSTRAINT "object_note_mentions_kind_chk" CHECK ("kind" IN ('user', 'agent'));
--> statement-breakpoint
ALTER TABLE "object_note_mentions" ADD CONSTRAINT "object_note_mentions_user_kind_chk" CHECK (
  ("kind" = 'user' AND "mentioned_user_id" IS NOT NULL)
  OR ("kind" = 'agent' AND "mentioned_user_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "object_note_mentions_note_user_unq" ON "object_note_mentions" USING btree ("note_id","mentioned_user_id") WHERE "kind" = 'user';
--> statement-breakpoint
CREATE UNIQUE INDEX "object_note_mentions_note_agent_unq" ON "object_note_mentions" USING btree ("note_id") WHERE "kind" = 'agent';
--> statement-breakpoint
CREATE INDEX "object_note_mentions_team_note_idx" ON "object_note_mentions" USING btree ("team_id","note_id");
--> statement-breakpoint
CREATE INDEX "object_note_mentions_team_user_idx" ON "object_note_mentions" USING btree ("team_id","mentioned_user_id");
