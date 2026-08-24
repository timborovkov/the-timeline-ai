-- One Free grant per person on their oldest owned workspace; extra owned
-- workspaces stay readable as restricted until a payment method is added.
INSERT INTO "team_billing_accounts" (
  "team_id",
  "plan_id",
  "billing_state",
  "spend_cap_cents",
  "shadow_billing"
)
SELECT
  "teams"."id",
  'free',
  'free',
  0,
  true
FROM "teams"
ON CONFLICT ("team_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "billing_free_grants" ("user_id", "assigned_team_id")
SELECT
  "ranked"."user_id",
  "ranked"."team_id"
FROM (
  SELECT
    "team_members"."user_id",
    "team_members"."team_id",
    row_number() OVER (
      PARTITION BY "team_members"."user_id"
      ORDER BY "teams"."created_at" ASC, "teams"."id" ASC
    ) AS "rn"
  FROM "team_members"
  INNER JOIN "teams" ON "teams"."id" = "team_members"."team_id"
  WHERE "team_members"."role" = 'owner'
    AND "team_members"."removed_at" IS NULL
) AS "ranked"
WHERE "ranked"."rn" = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "billing_free_grants" AS "g"
    WHERE "g"."user_id" = "ranked"."user_id"
      AND "g"."revoked_at" IS NULL
  );--> statement-breakpoint
UPDATE "team_billing_accounts" AS "tba"
SET
  "billing_state" = 'restricted',
  "spend_cap_cents" = 0,
  "updated_at" = now()
WHERE "tba"."plan_id" = 'free'
  AND "tba"."billing_state" = 'free'
  AND "tba"."polar_subscription_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "billing_free_grants" AS "g"
    WHERE "g"."assigned_team_id" = "tba"."team_id"
      AND "g"."revoked_at" IS NULL
  );
