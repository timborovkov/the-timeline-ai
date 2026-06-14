CREATE TABLE "team_calendar_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_calendar_subscriptions" ADD CONSTRAINT "team_calendar_subscriptions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_calendar_subscriptions" ADD CONSTRAINT "team_calendar_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "team_calendar_subscriptions_team_user_unq" ON "team_calendar_subscriptions" USING btree ("team_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "team_calendar_subscriptions_token_hash_unq" ON "team_calendar_subscriptions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "team_calendar_subscriptions_team_idx" ON "team_calendar_subscriptions" USING btree ("team_id");
