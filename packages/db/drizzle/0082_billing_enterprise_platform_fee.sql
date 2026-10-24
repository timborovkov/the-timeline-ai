ALTER TABLE "team_billing_accounts" ADD COLUMN "enterprise_platform_fee_cents" integer;--> statement-breakpoint
UPDATE "team_billing_accounts"
SET
  "enterprise_platform_fee_cents" = ("price_override"->>'platformFeeCents')::integer,
  "price_override" = NULLIF("price_override" - 'platformFeeCents', '{}'::jsonb)
WHERE "price_override" ? 'platformFeeCents'
  AND ("price_override"->>'platformFeeCents') ~ '^[0-9]+$';
