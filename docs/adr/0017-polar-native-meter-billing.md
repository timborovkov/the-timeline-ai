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
5. Public catalog lives at `/pricing`; team admins manage plan/spend cap at
   `/app/team?section=billing`.

## Consequences

- Enforcement of costly paths must call the billing admission API and fail
  closed when charges are enabled.
- Polar product/meter IDs are env-configured and Timeline-specific even when an
  org is shared with other products.
- Team and Business “included usage” is an invoice discount entitlement, not
  transferable customer credits.
