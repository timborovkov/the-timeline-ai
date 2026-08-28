ALTER TABLE "billing_member_day_ledger" ADD COLUMN "plan_id" "billing_plan_id";--> statement-breakpoint
UPDATE "billing_member_day_ledger" AS "l"
SET "plan_id" = "a"."plan_id"
FROM "team_billing_accounts" AS "a"
WHERE "l"."team_id" = "a"."team_id";--> statement-breakpoint
UPDATE "billing_member_day_ledger" SET "plan_id" = 'free' WHERE "plan_id" IS NULL;--> statement-breakpoint
ALTER TABLE "billing_member_day_ledger" ALTER COLUMN "plan_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "prior_intervals" jsonb DEFAULT '[]'::jsonb NOT NULL;
