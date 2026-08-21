# ADR 0017: Polar native-meter billing with shadow ledger

## Status

Accepted (2026-08-21)

## Context

Timeline needs team-scoped commercial billing with Free, pay-as-you-go, optional
Team/Business commitments, and Enterprise later. Costs are heterogeneous (AI
tokens, Recall minutes, email, storage, accepted sources). A single opaque
credit hides margin and confuses prospects.

## Decision

1. **Polar** is merchant of record for checkout, subscriptions, discounts, and
   optional usage event ingest.
2. **Native meters** (AI euro cents, Recall minutes, email units, storage
   GB-month, accepted sources) plus €2 active-member-day proration.
3. **Local durable ledger** (`team_billing_accounts`, reservations, append-only
   usage ledger, counters) is product truth for admission and dashboards.
4. **Shadow billing** is the default (`BILLING_CHARGES_ENABLED=false`): record
   usage and expose UI, but do not block or charge until reconciliation proves
   the ledger.
5. Public catalog lives at `/pricing` (self-serve Free/PAYG/Team/Business columns;
   Enterprise is a quiet contact nudge). Team usage is at `/app/usage`; admins
   manage plan/spend cap at `/app/team?section=billing`. Free hard-stops apply
   even while `shadowBilling` is true; paid spend-cap / wallet blocking applies
   when charges are enabled.
6. Costly product paths admit via `scope.billing.reserve` → work →
   `settle`/`release`. Wired today: Agent Ask (`askAgent` + web `/api/chat`) on
   the `ai` meter, and Recall meeting bots (web schedule/quick-join + scheduler
   reserve, finalize settle) on `recall_minutes`. Email, storage, ingest, and
   background LLM jobs remain follow-ups.
7. After successful `settle`, workspace **owners** get transactional email for
   spend-cap 50/75/90/100% and Free near-limit / exhaustion
   (`billing_usage_alert` intent + HTML template), deduped once per
   team/period/threshold/owner. In-app nudges stay the primary product surface.

## Consequences

- Enforcement of costly paths must call the billing admission API and fail
  closed when charges are enabled (Free allowances hard-stop even in shadow).
- Polar product/meter IDs are env-configured and Timeline-specific even when an
  org is shared with other products.
- Team and Business “included usage” is an invoice discount entitlement, not
  transferable customer credits.
- Usage-alert email requires Postmark + `message_intent` value
  `billing_usage_alert` (migration `0074_billing_usage_alert_intent`).
