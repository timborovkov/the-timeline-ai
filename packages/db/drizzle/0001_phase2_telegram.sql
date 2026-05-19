CREATE TYPE "public"."telegram_link_scope" AS ENUM('personal', 'group');--> statement-breakpoint
CREATE TABLE "telegram_chat_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tg_chat_id" bigint NOT NULL,
	"team_id" uuid NOT NULL,
	"bound_by_user_id" uuid,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_chat_bindings_tg_chat_id_unique" UNIQUE("tg_chat_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"team_id" uuid NOT NULL,
	"scope" "telegram_link_scope" NOT NULL,
	"issued_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_tg_user_id" bigint,
	"consumed_chat_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "telegram_user_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tg_user_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_users_tg_user_id_unique" UNIQUE("tg_user_id")
);
--> statement-breakpoint
ALTER TABLE "telegram_chat_bindings" ADD CONSTRAINT "telegram_chat_bindings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_bindings" ADD CONSTRAINT "telegram_chat_bindings_bound_by_user_id_users_id_fk" FOREIGN KEY ("bound_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_user_teams" ADD CONSTRAINT "telegram_user_teams_telegram_user_id_telegram_users_id_fk" FOREIGN KEY ("telegram_user_id") REFERENCES "public"."telegram_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_user_teams" ADD CONSTRAINT "telegram_user_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_users" ADD CONSTRAINT "telegram_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_chat_bindings_team_idx" ON "telegram_chat_bindings" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_team_expires_idx" ON "telegram_link_tokens" USING btree ("team_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_user_teams_user_team_unq" ON "telegram_user_teams" USING btree ("telegram_user_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_user_teams_active_unq" ON "telegram_user_teams" USING btree ("telegram_user_id") WHERE "telegram_user_teams"."is_active";--> statement-breakpoint
CREATE INDEX "telegram_user_teams_team_idx" ON "telegram_user_teams" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "telegram_users_user_idx" ON "telegram_users" USING btree ("user_id");