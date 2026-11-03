ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TYPE "public"."message_intent" ADD VALUE IF NOT EXISTS 'password_reset';
