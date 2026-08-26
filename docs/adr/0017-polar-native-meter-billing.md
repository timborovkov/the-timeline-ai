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
   `settle`/`release`. Native meters wired today:
   - `ai` — Agent Ask plus background LLM (extract, embed, digest, vision,
     transcription, suggestions, summaries) when worker ALS is set.
   - `recall_minutes` — meeting bots. Reserved minutes are passed to Recall
     `automatic_leave.in_call_recording_timeout` and stamped as
     `reserved_recall_started_at` so the janitor cannot treat a scheduled
     meeting's `createdAt` as the recording clock.
   - `email_units` — inbound unique messages and outbound Postmark recipients.
   - `accepted_sources` — unique ingested source items (raw row is kept; AI
     enrichment pauses when the meter is exhausted).
   - `storage_gb_month` — daily GB-month snapshot from original document bytes.
   - `member_days` — extra active-member proration on paid plans (wallet ledger
     line, not a Polar meter or Polar invoice line).
   Capacity limits (agent turns, concurrent Recall bots, custom MCP servers,
   documents/storage/chunks, active members) are enforced at product gates
   from `CAPACITY_BY_PLAN` / `PLAN_CATALOG.maxActiveMembers`. They are **not**
   Polar meters and must not grow the `billing_meter_id` enum. `/app/usage`,
   Billing settings, and `/pricing` keep live used/limit for those gates in a
   closed Infrastructure limits disclosure. Webhook burst and semantic-search
   burst stay on the existing Redis token buckets; unique ingest volume is the
   `accepted_sources` meter. Extra owned workspaces do not mint a second Free
   grant (`billing_free_grants` + `restricted` state).
7. Prepaid PAYG collection is a €10 Polar top-up (`POLAR_PRODUCT_ID_TOPUP`)
   credited to `walletBalanceCents` on wallet-backed plans (PAYG/Team/Business/
   Enterprise). Free workspaces hard-stop on native allowances and cannot buy
   unusable top-ups. Owners can enable auto-reload: when the wallet is at/below
   the threshold **and** remaining spend-cap headroom covers the full €10 Polar
   product, Timeline opens a Polar top-up checkout and emails owners the URL.
   Credit still lands on Polar `order.paid`. Polar subscription webhooks apply
   `shadowBilling` from `BILLING_CHARGES_ENABLED`, map Polar `status`, ignore
   stale activations (older Polar `modified_at` or an older subscription period),
   reset Team/Business included discount only on a new period or plan/subscription
   change, and cancel only the matching `polarSubscriptionId`. A canceled paid
   plan becomes `free` if this team holds the person-level Free grant, otherwise
   `restricted`. Checkout attaches `POLAR_DISCOUNT_ID` only when the submitted
   code matches `POLAR_DISCOUNT_CODE`. Reservations lock the wallet-funded
   remainder after the PAYG Free floor and included discount, include pending
   reservation charges in the spend cap **and** Free native allowances, count
   in-flight included-discount claims against `includedDiscountRemainingCents`,
   expire on TTL, and Free pause copy follows admission (not a single exhausted
   meter). Released or expired reservations may be replaced for the same
   operation id; settled rows are reused as already-final rather than a fresh
   lock. Extra member-days accrue with a cumulative monthly cent delta so daily
   rounding still totals €2 per extra member-month. AI customer charges keep
   fractional cents on `nativeUnits` and round the cumulative delta, so
   sub-cent embeddings still consume the Free/PAYG floor. Polar usage ingest is
   an out-of-transaction outbox (`polar_ingest_status` on the ledger); a failed
   ingest does not fail local settlement, and the janitor plus duplicate settle
   retries drain pending events. Paid-plan activation writes the catalog default
   spend cap when the row is still Free (or cap 0). Polar `refund.created` /
   `order.refunded` claw back prepaid top-ups (and freeze the workspace if the
   wallet was already spent).
8. After successful `settle`, workspace **owners** get transactional email for
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
