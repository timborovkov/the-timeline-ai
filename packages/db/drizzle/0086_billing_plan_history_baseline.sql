-- Accounts whose earliest plan-history row is paid were Free until that row.
-- Accounts with no history keep the live-plan fallback.
INSERT INTO "billing_plan_history" ("team_id", "plan_id", "effective_at")
SELECT account.team_id,
       'free',
       CASE
         WHEN first_plan.effective_at > account.created_at THEN account.created_at
         ELSE first_plan.effective_at - INTERVAL '1 millisecond'
       END
FROM "team_billing_accounts" AS account
JOIN LATERAL (
  SELECT history.plan_id, history.effective_at
  FROM "billing_plan_history" AS history
  WHERE history.team_id = account.team_id
  ORDER BY history.effective_at ASC
  LIMIT 1
) AS first_plan ON true
WHERE first_plan.plan_id <> 'free'
  AND NOT EXISTS (
    SELECT 1
    FROM "billing_plan_history" AS earlier
    WHERE earlier.team_id = account.team_id
      AND earlier.plan_id = 'free'
      AND earlier.effective_at < first_plan.effective_at
  );
