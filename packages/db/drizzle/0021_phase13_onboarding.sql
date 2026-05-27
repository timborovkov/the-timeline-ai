-- Phase 13.1 — timeline onboarding tutorial.
--
-- Team completions are shared: any teammate completing a tutorial step marks
-- it done for the team. Dismissal is per-user so each teammate can hide or
-- reopen the checklist independently.

DO $$ BEGIN
  CREATE TYPE "onboarding_step" AS ENUM (
    'first_note',
    'telegram',
    'email_forwarding',
    'first_document',
    'first_integration'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "team_onboarding_completions" (
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
  "step" "onboarding_step" NOT NULL,
  "completed_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "completed_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("team_id", "step")
);

CREATE TABLE IF NOT EXISTS "user_onboarding_dismissals" (
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "dismissed_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("team_id", "user_id")
);
