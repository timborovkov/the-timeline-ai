ALTER TABLE "team_first_run" ADD COLUMN "website_subject" text NOT NULL DEFAULT 'own_team';
ALTER TABLE "team_first_run" ADD COLUMN "website_scan_id" uuid;
ALTER TABLE "team_first_run" ADD CONSTRAINT "team_first_run_website_subject_check" CHECK ("website_subject" IN ('own_team', 'other_company'));
CREATE TABLE "website_sources" (
  "id" uuid PRIMARY KEY,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "website_subject" text NOT NULL CHECK ("website_subject" IN ('own_team', 'other_company')),
  "crawl_id" text,
  "pages" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "website_sources_team_idx" ON "website_sources" ("team_id");
