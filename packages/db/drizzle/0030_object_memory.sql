CREATE TYPE "identity_facet_kind" AS ENUM (
  'email',
  'phone',
  'telegram',
  'slack',
  'github',
  'timeline_user',
  'other'
);

CREATE TYPE "identity_facet_status" AS ENUM ('approved', 'archived');

CREATE TYPE "identity_facet_source" AS ENUM (
  'manual',
  'agent_approved',
  'integration',
  'system'
);

CREATE TABLE "object_identity_facets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
  "entity_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE cascade,
  "kind" "identity_facet_kind" NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "provider" text,
  "external_id" text,
  "linked_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "source" "identity_facet_source" DEFAULT 'manual' NOT NULL,
  "status" "identity_facet_status" DEFAULT 'approved' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);

CREATE INDEX "object_identity_facets_team_entity_idx"
  ON "object_identity_facets" ("team_id", "entity_id");

CREATE INDEX "object_identity_facets_team_kind_value_idx"
  ON "object_identity_facets" ("team_id", "kind", "normalized_value");

CREATE INDEX "object_identity_facets_team_external_idx"
  ON "object_identity_facets" ("team_id", "kind", "provider", "external_id");

CREATE INDEX "object_identity_facets_team_linked_user_idx"
  ON "object_identity_facets" ("team_id", "linked_user_id");

CREATE UNIQUE INDEX "object_identity_facets_team_kind_value_unq"
  ON "object_identity_facets" ("team_id", "kind", "normalized_value")
  WHERE "status" = 'approved';

CREATE UNIQUE INDEX "object_identity_facets_team_external_unq"
  ON "object_identity_facets" ("team_id", "kind", "provider", "external_id")
  WHERE "status" = 'approved' AND "external_id" IS NOT NULL;

CREATE UNIQUE INDEX "object_identity_facets_team_linked_user_unq"
  ON "object_identity_facets" ("team_id", "linked_user_id")
  WHERE "status" = 'approved' AND "kind" = 'timeline_user';

ALTER TYPE "agent_suggestion_target_kind" ADD VALUE IF NOT EXISTS 'identity_facet';
ALTER TYPE "agent_suggestion_target_kind" ADD VALUE IF NOT EXISTS 'object_note';
ALTER TYPE "agent_suggestion_target_kind" ADD VALUE IF NOT EXISTS 'object_relationship';
