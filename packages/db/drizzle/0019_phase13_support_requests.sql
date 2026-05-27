-- Phase 13.7 — Public support/contact requests.
--
-- Public help pages send support requests through Postmark and also store
-- every request in Postgres so operators can inspect the audit trail even if
-- email delivery fails. User/team foreign keys are nullable because anonymous
-- visitors can submit the same form.

CREATE TYPE "public"."support_request_type" AS ENUM (
  'technical_support',
  'sales',
  'billing',
  'security',
  'other'
);
--> statement-breakpoint

CREATE TABLE "support_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_type" "support_request_type" NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "message" text NOT NULL,
  "current_page" text,
  "user_id" uuid,
  "team_id" uuid,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "email_sent_at" timestamp with time zone,
  "email_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "support_requests"
  ADD CONSTRAINT "support_requests_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "support_requests"
  ADD CONSTRAINT "support_requests_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "support_requests_created_idx"
  ON "support_requests" USING btree ("created_at");
--> statement-breakpoint

CREATE INDEX "support_requests_team_created_idx"
  ON "support_requests" USING btree ("team_id", "created_at");
--> statement-breakpoint

CREATE INDEX "support_requests_user_created_idx"
  ON "support_requests" USING btree ("user_id", "created_at");
