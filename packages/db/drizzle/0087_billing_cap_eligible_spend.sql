-- Spend-cap cents are tracked apart from standard Free allowance list prices.
-- Native units and customer_charge_cents stay so the PAYG included floor still sees them.
ALTER TABLE "billing_usage_counters"
  ADD COLUMN "cap_eligible_charge_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "billing_usage_counters"
SET "cap_eligible_charge_cents" = "customer_charge_cents";
--> statement-breakpoint
-- Drop standard-Free settlements from the copied total. A comp, including an
-- expired comp whose entitlements are Free, keeps its recorded charge.
UPDATE "billing_usage_counters" AS counter
SET "cap_eligible_charge_cents" = GREATEST(0, counter.cap_eligible_charge_cents - free_usage.charge_cents)
FROM (
  SELECT
    ledger.team_id,
    ledger.meter_id,
    COALESCE(
      NULLIF(ledger.metadata ->> 'pricing_period_ym', ''),
      NULLIF(ledger.metadata ->> 'polar_ingest_period_ym', ''),
      to_char(
        COALESCE(
          CASE
            WHEN ledger.metadata ->> 'usage_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN (ledger.metadata ->> 'usage_at')::timestamptz
            ELSE NULL
          END,
          ledger.occurred_at
        ) AT TIME ZONE 'UTC',
        'YYYY-MM'
      )
    ) AS period_ym,
    SUM(ledger.customer_charge_cents)::integer AS charge_cents
  FROM "billing_usage_ledger" AS ledger
  JOIN "team_billing_accounts" AS account ON account.team_id = ledger.team_id
  LEFT JOIN LATERAL (
    SELECT history.plan_id
    FROM "billing_plan_history" AS history
    WHERE history.team_id = ledger.team_id
      AND history.effective_at <= COALESCE(
        CASE
          WHEN ledger.metadata ->> 'usage_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (ledger.metadata ->> 'usage_at')::timestamptz
          ELSE NULL
        END,
        ledger.occurred_at
      )
    ORDER BY history.effective_at DESC
    LIMIT 1
  ) AS plan ON true
  WHERE ledger.kind = 'settlement'
    AND account.arrangement IS DISTINCT FROM 'comped'
    AND COALESCE(plan.plan_id, account.plan_id) = 'free'
  GROUP BY ledger.team_id, ledger.meter_id, 3
) AS free_usage
WHERE counter.team_id = free_usage.team_id
  AND counter.meter_id = free_usage.meter_id
  AND counter.period_ym = free_usage.period_ym;
