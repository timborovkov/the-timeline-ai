ALTER TABLE "team_billing_accounts" ADD COLUMN "polar_event_modified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "billing_free_grants" AS "g"
SET "revoked_at" = now()
FROM "users" AS "u"
WHERE "g"."user_id" = "u"."id"
  AND "g"."revoked_at" IS NULL
  AND "u"."emailVerified" IS NULL;--> statement-breakpoint
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
