-- User-level legal acceptance for current Terms of Use and Privacy Policy.
ALTER TABLE "users"
  ADD COLUMN "legal_terms_version" text,
  ADD COLUMN "legal_privacy_version" text,
  ADD COLUMN "legal_accepted_at" timestamp with time zone;
