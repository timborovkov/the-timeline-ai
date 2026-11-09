CREATE TYPE "team_work_style" AS ENUM('email', 'chat', 'dealflow', 'delivery', 'other');
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "work_style" "team_work_style";
--> statement-breakpoint
CREATE TYPE "first_run_phase" AS ENUM('welcome', 'choose', 'processing', 'record', 'ask', 'approve', 'live', 'complete', 'skipped', 'failed');
--> statement-breakpoint
CREATE TYPE "first_run_path" AS ENUM('website', 'document', 'email', 'skip');
--> statement-breakpoint
CREATE TYPE "first_run_scan_failure_reason" AS ENUM('no_readable_text', 'robots', 'unreachable', 'not_enabled', 'rate_limited');
--> statement-breakpoint
CREATE TABLE "team_first_run" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"started_by_user_id" uuid,
	"phase" "first_run_phase" DEFAULT 'welcome' NOT NULL,
	"starter_path" "first_run_path",
	"starter_selected_at" timestamp with time zone,
	"capture_document_id" uuid,
	"capture_event_id" uuid,
	"website_url" text,
	"website_host" text,
	"scan_failure_reason" "first_run_scan_failure_reason",
	"guide_hidden_at" timestamp with time zone,
	"first_capture_landed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_first_run" ADD CONSTRAINT "team_first_run_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_first_run" ADD CONSTRAINT "team_first_run_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_first_run" ADD CONSTRAINT "team_first_run_capture_document_id_documents_id_fk" FOREIGN KEY ("capture_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_first_run" ADD CONSTRAINT "team_first_run_capture_event_id_raw_events_id_fk" FOREIGN KEY ("capture_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;
