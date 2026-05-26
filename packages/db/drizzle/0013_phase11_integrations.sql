-- Phase 11: Third-party integrations and custom MCP servers.
--
-- Adds `integration` to event_source so external-system activity rides the
-- existing raw_events → extract → embed pipeline. Four new tables hold the
-- integration account, per-resource sync cursor, user-selected resources,
-- and append-only audit log. Two more (`mcp_servers`, `mcp_oauth_tokens`)
-- back the custom-MCP feature, team-scoped.
--
-- All auth material is AES-256-GCM encrypted at rest via
-- packages/shared/src/crypto/secrets.ts. The three columns per secret
-- (`*_ciphertext`, `*_iv`, `*_tag`) together form one EncryptedSecret.
--
-- Idempotent integration sync: raw_events.source_metadata.dedup_key drives
-- a per-team partial unique index so a webhook replay or a backfill rerun
-- is a no-op.

ALTER TYPE "public"."event_source" ADD VALUE IF NOT EXISTS 'integration';--> statement-breakpoint

CREATE TYPE "public"."integration_provider" AS ENUM('google_drive','linear','github','mcp');--> statement-breakpoint
CREATE TYPE "public"."mcp_auth_type" AS ENUM('none','bearer','header','basic','oauth','url_key');--> statement-breakpoint

CREATE TABLE "integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "connected_by_user_id" uuid,
  "provider" "integration_provider" NOT NULL,
  "display_name" text NOT NULL,
  "external_account_id" text,
  "scopes" text[],
  "auth_secret_ciphertext" bytea,
  "auth_secret_iv" bytea,
  "auth_secret_tag" bytea,
  "visibility_default" "event_visibility" DEFAULT 'team' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_error" text,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integrations_team_provider_idx" ON "integrations" USING btree ("team_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_team_provider_account_unq" ON "integrations" USING btree ("team_id","provider","external_account_id") WHERE "integrations"."external_account_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "integration_sync_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid NOT NULL,
  "resource_type" text NOT NULL,
  "cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_status" text,
  "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_state_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_state_resource_unq" ON "integration_sync_state" USING btree ("integration_id","resource_type");--> statement-breakpoint

CREATE TABLE "integration_selections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid NOT NULL,
  "selection_kind" text NOT NULL,
  "external_id" text NOT NULL,
  "external_label" text,
  "visibility" "event_visibility" DEFAULT 'team' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_selections" ADD CONSTRAINT "integration_selections_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_selections_unq" ON "integration_selections" USING btree ("integration_id","selection_kind","external_id");--> statement-breakpoint
CREATE INDEX "integration_selections_integration_idx" ON "integration_selections" USING btree ("integration_id");--> statement-breakpoint

CREATE TABLE "integration_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "integration_id" uuid,
  "actor_user_id" uuid,
  "kind" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_audit_log" ADD CONSTRAINT "integration_audit_log_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_audit_log" ADD CONSTRAINT "integration_audit_log_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_audit_log" ADD CONSTRAINT "integration_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_audit_team_created_idx" ON "integration_audit_log" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_audit_integration_idx" ON "integration_audit_log" USING btree ("integration_id");--> statement-breakpoint

CREATE TABLE "mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "added_by_user_id" uuid,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "auth_type" "mcp_auth_type" DEFAULT 'none' NOT NULL,
  "auth_config_ciphertext" bytea,
  "auth_config_iv" bytea,
  "auth_config_tag" bytea,
  "enabled" boolean DEFAULT true NOT NULL,
  "disabled_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cached_tools" jsonb,
  "tools_cached_at" timestamp with time zone,
  "last_connected_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_servers_team_idx" ON "mcp_servers" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_team_url_unq" ON "mcp_servers" USING btree ("team_id","url");--> statement-breakpoint

CREATE TABLE "mcp_oauth_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "mcp_server_id" uuid NOT NULL,
  "token_ciphertext" bytea NOT NULL,
  "token_iv" bytea NOT NULL,
  "token_tag" bytea NOT NULL,
  "expires_at" timestamp with time zone,
  "client_info_ciphertext" bytea,
  "client_info_iv" bytea,
  "client_info_tag" bytea,
  "code_verifier" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_team_server_unq" ON "mcp_oauth_tokens" USING btree ("team_id","mcp_server_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_expires_idx" ON "mcp_oauth_tokens" USING btree ("expires_at") WHERE "mcp_oauth_tokens"."expires_at" IS NOT NULL;--> statement-breakpoint

-- Phase 11 raw_events idempotency: integration sync writes raw_events
-- with source='integration' and source_metadata.dedup_key set to a
-- provider-specific stable key. A webhook replay or a backfill rerun
-- hits this partial unique index and short-circuits via ON CONFLICT.
--
-- The WHERE clause intentionally does NOT filter `source = 'integration'`
-- (same reason as 0012_phase10_meeting_raw_events_idx.sql):
--   1. Drizzle wraps pending migrations in a single transaction, and the
--      `integration` enum value added above cannot be referenced in the
--      same tx without tripping check_safe_enum_use (55P04).
--   2. A `source::text = 'integration'` cast bypasses that but is STABLE,
--      which Postgres rejects in an index predicate (42P17).
-- The JSONB-key existence check alone is sufficient because `dedup_key`
-- is ONLY set by the integration-event writer (event-writer.ts) — no
-- other source writes that field.
CREATE UNIQUE INDEX "raw_events_integration_dedup_unq" ON "raw_events" USING btree ("team_id", ((source_metadata ->> 'dedup_key'))) WHERE "raw_events"."source_metadata" ? 'dedup_key';--> statement-breakpoint

-- Phase 11 — Workspace object mapping. Lets the integration event-writer
-- upsert one entity per external resource in a single ON CONFLICT
-- statement instead of N+1 SELECT/INSERT-or-UPDATE round-trips. The
-- partial predicate ensures the index only covers integration-mapped
-- rows (entities created from Drive/Linear/GitHub sync); regular
-- workspace objects are unaffected.
CREATE UNIQUE INDEX "entities_integration_external_id_unq"
  ON "entities" USING btree (
    "team_id",
    ((metadata ->> 'integration_provider')),
    ((metadata ->> 'integration_external_id'))
  )
  WHERE metadata ? 'integration_external_id';
