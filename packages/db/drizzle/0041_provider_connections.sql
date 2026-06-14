-- Person-owned provider connections and team-scoped source activation.

ALTER TYPE "public"."message_intent" ADD VALUE IF NOT EXISTS 'connection_attention';--> statement-breakpoint

CREATE TYPE "public"."connection_attention_category" AS ENUM(
  'needs_reconnect',
  'needs_new_owner',
  'access_changed',
  'sync_error'
);--> statement-breakpoint

CREATE TABLE "provider_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "provider" "integration_provider" NOT NULL,
  "display_name" text NOT NULL,
  "external_account_id" text NOT NULL,
  "scopes" text[],
  "auth_secret_ciphertext" bytea NOT NULL,
  "auth_secret_iv" bytea NOT NULL,
  "auth_secret_tag" bytea NOT NULL,
  "last_error" text,
  "last_connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_connections_owner_idx" ON "provider_connections" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_owner_provider_account_unq" ON "provider_connections" USING btree ("owner_user_id","provider","external_account_id");--> statement-breakpoint

ALTER TABLE "integrations" ADD COLUMN "provider_connection_id" uuid;--> statement-breakpoint

INSERT INTO "provider_connections" (
  "owner_user_id",
  "provider",
  "display_name",
  "external_account_id",
  "scopes",
  "auth_secret_ciphertext",
  "auth_secret_iv",
  "auth_secret_tag",
  "last_error",
  "last_connected_at",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON ("connected_by_user_id", "provider", "external_account_id")
  "connected_by_user_id",
  "provider",
  "display_name",
  "external_account_id",
  COALESCE("scopes", ARRAY[]::text[]),
  "auth_secret_ciphertext",
  "auth_secret_iv",
  "auth_secret_tag",
  "last_error",
  COALESCE("updated_at", now()),
  "created_at",
  "updated_at"
FROM "integrations"
WHERE "provider" <> 'mcp'
  AND "connected_by_user_id" IS NOT NULL
  AND "external_account_id" IS NOT NULL
  AND "auth_secret_ciphertext" IS NOT NULL
  AND "auth_secret_iv" IS NOT NULL
  AND "auth_secret_tag" IS NOT NULL
ORDER BY "connected_by_user_id", "provider", "external_account_id", "updated_at" DESC;--> statement-breakpoint

UPDATE "integrations" i
SET "provider_connection_id" = pc."id"
FROM "provider_connections" pc
WHERE i."provider" = pc."provider"
  AND i."external_account_id" = pc."external_account_id"
  AND i."connected_by_user_id" = pc."owner_user_id";--> statement-breakpoint

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integrations_provider_connection_idx" ON "integrations" USING btree ("provider_connection_id");--> statement-breakpoint

CREATE TABLE "team_provider_resource_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "provider_connection_id" uuid NOT NULL,
  "resource_kind" text NOT NULL,
  "external_id" text NOT NULL,
  "external_label" text,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "team_provider_resource_shares" ADD CONSTRAINT "team_provider_resource_shares_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_provider_resource_shares" ADD CONSTRAINT "team_provider_resource_shares_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_provider_resource_shares_team_idx" ON "team_provider_resource_shares" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_provider_resource_shares_connection_idx" ON "team_provider_resource_shares" USING btree ("provider_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_provider_resource_shares_unq" ON "team_provider_resource_shares" USING btree ("team_id","provider_connection_id","resource_kind","external_id");--> statement-breakpoint

INSERT INTO "team_provider_resource_shares" (
  "team_id",
  "provider_connection_id",
  "resource_kind",
  "external_id",
  "external_label",
  "created_at",
  "updated_at"
)
SELECT DISTINCT
  i."team_id",
  i."provider_connection_id",
  s."selection_kind",
  s."external_id",
  s."external_label",
  s."created_at",
  s."created_at"
FROM "integration_selections" s
JOIN "integrations" i ON i."id" = s."integration_id"
WHERE i."provider_connection_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

ALTER TABLE "integration_selections" ADD COLUMN "resource_share_id" uuid;--> statement-breakpoint
UPDATE "integration_selections" s
SET "resource_share_id" = r."id"
FROM "integrations" i
JOIN "team_provider_resource_shares" r
  ON r."team_id" = i."team_id"
 AND r."provider_connection_id" = i."provider_connection_id"
WHERE s."integration_id" = i."id"
  AND r."resource_kind" = s."selection_kind"
  AND r."external_id" = s."external_id";--> statement-breakpoint
ALTER TABLE "integration_selections" ADD CONSTRAINT "integration_selections_resource_share_id_team_provider_resource_shares_id_fk" FOREIGN KEY ("resource_share_id") REFERENCES "public"."team_provider_resource_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_selections_share_idx" ON "integration_selections" USING btree ("resource_share_id");--> statement-breakpoint

CREATE TABLE "connection_attention" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "provider_connection_id" uuid,
  "integration_id" uuid,
  "resource_share_id" uuid,
  "category" "connection_attention_category" NOT NULL,
  "summary" text NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "last_emailed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "connection_attention" ADD CONSTRAINT "connection_attention_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_attention" ADD CONSTRAINT "connection_attention_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_attention" ADD CONSTRAINT "connection_attention_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_attention" ADD CONSTRAINT "connection_attention_resource_share_id_team_provider_resource_shares_id_fk" FOREIGN KEY ("resource_share_id") REFERENCES "public"."team_provider_resource_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_attention_team_idx" ON "connection_attention" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "connection_attention_provider_connection_idx" ON "connection_attention" USING btree ("provider_connection_id");--> statement-breakpoint
CREATE INDEX "connection_attention_integration_idx" ON "connection_attention" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "connection_attention_resource_share_idx" ON "connection_attention" USING btree ("resource_share_id");--> statement-breakpoint

ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'connection_attention';--> statement-breakpoint
