CREATE TYPE "public"."visibility_default_source" AS ENUM('team', 'web', 'telegram', 'email', 'document', 'meeting', 'integration', 'calendar');--> statement-breakpoint
ALTER TABLE "raw_events" ADD COLUMN "visibility_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "visibility_default_user_ids" uuid[];--> statement-breakpoint
UPDATE "raw_events" SET "visibility_owner_user_id" = "author_user_id" WHERE "author_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_visibility_owner_user_id_users_id_fk" FOREIGN KEY ("visibility_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_events_visibility_owner_idx" ON "raw_events" USING btree ("team_id","visibility_owner_user_id");--> statement-breakpoint
CREATE TABLE "team_visibility_defaults" (
	"team_id" uuid NOT NULL,
	"source" "visibility_default_source" NOT NULL,
	"visibility" "event_visibility" DEFAULT 'team' NOT NULL,
	"visibility_user_ids" uuid[],
	"source_owner_user_id" uuid,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_visibility_defaults_team_id_source_pk" PRIMARY KEY("team_id","source")
);
--> statement-breakpoint
ALTER TABLE "team_visibility_defaults" ADD CONSTRAINT "team_visibility_defaults_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_visibility_defaults" ADD CONSTRAINT "team_visibility_defaults_source_owner_user_id_users_id_fk" FOREIGN KEY ("source_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_visibility_defaults" ADD CONSTRAINT "team_visibility_defaults_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_visibility_defaults_owner_idx" ON "team_visibility_defaults" USING btree ("team_id","source_owner_user_id");--> statement-breakpoint
