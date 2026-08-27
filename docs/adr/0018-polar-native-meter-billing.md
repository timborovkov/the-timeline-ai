# ADR 0018: Polar native-meter billing with shadow ledger

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
   the ledger. Admission, Polar ingest, and dashboards derive live vs shadow
   from that env flag so flipping it to true does not wait for the next Polar
   webhook.
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
   stale activations (older Polar `modified_at` vs `polar_event_modified_at`,
   or an older subscription period), reject Polar webhooks whose Standard
   Webhooks timestamp is outside a 5-minute window, reset Team/Business included
   discount only on a new period start or plan/subscription change, and cancel
   only the matching `polarSubscriptionId`. Wallet, spend-cap, and shadow writes
   bump `updated_at` and must not hide newer Polar events. A paid spend cap of
   €0 is a hard stop (Free still uses native allowances). Extra member-days skip
   the included-usage discount, settle per extra member per day, and accrue a
   member added after the first daily tick. Reservations stamp `wallet_lock_cents`
   when the wallet lock is applied and unwind that amount on settle/release/expire
   even if the live/shadow toggle flipped. Concurrent Polar refunds serialize
   remaining clawback under an account lock. Concurrent invite accepts serialize
   member-seat claims with advisory lock key 4. Ask chat titles settle inside
   the Ask reservation. Failed post-verification Free-grant claims retry on the
   next signed-in load. Polar webhook HMAC timestamps follow the same 5-minute
   replay window as Svix. Janitor fallback refills that discount by advancing the stored Polar
   renewal window, not by snapping to UTC calendar months. Paid-plan changes
   PATCH the existing Polar subscription (or open the customer portal) instead
   of creating a second checkout. Prepaid wallet and included-discount collection
   is local; Polar meters are not ingested for those already-collected units.
   Live charging follows `BILLING_CHARGES_ENABLED` in both directions: `true`
   charges immediately even when a row still snapshots `shadowBilling = true`;
   `false` is a kill switch that shadows every reservation and settlement.
   A canceled paid plan becomes `free` if
   this team holds the person-level Free grant, otherwise `restricted`. Paid-plan
   activation writes the catalog default spend cap when the row is still Free;
   later `subscription.updated` / renewal events preserve an administrator-selected
   paid cap, including €0 as a hard stop. Subscription upserts and cancels lock the
   billing account and recheck Polar `modified_at` in the same transaction so an
   older event cannot overwrite a newer one. Polar webhook bodies are bounded to
   the integration webhook size limit before signature verify. Settlement that
   exceeds the reserved wallet or paid spend cap still records the full ledger
   charge and freezes the workspace (`read_only`, spend cap €0). A €10 top-up or a
   positive spend-cap raise restores the plan's active state and, when the freeze
   zeroed a positive catalog cap, that catalog default. Extra member-days persist
   the denied charge and freeze instead of skipping the extra seat. Terminal Recall
   no-shows settle elapsed waiting-room minutes; retry no-shows still release so
   the same meeting can reserve again. Cancelling a joining/active meeting with no
   transcript chunks settles elapsed waiting-room minutes instead of releasing them.
   An active bot `failed`/`fatal` path settles elapsed minutes the same way.
   Slack/Telegram/MCP Ask and web chat keep the reservation when settlement fails
   after OpenRouter work. Web chat also settles known compression cost when the
   answer stream fails. Seat claims are blocked while billing is paused.
   Enterprise settlement skips prepaid wallet/spend-cap freezes so Polar meters
   can ingest. Interactive search embeddings run under billing ALS.
   The person-level Free grant unassigns when its owner leaves or is demoted.
   Janitor member-days backfill missed calendar days, restore rechecks indexed
   chunks (deleted documents do not count), and accepted-source replay meters
   existing dedup rows after an insert-then-crash. Postmark success is recorded before email
   settlement so a later settle failure does not resend. Meeting-finalize billing
   uses the system actor so a departed creator cannot skip settlement. Free-grant
   inserts use `ON CONFLICT DO NOTHING` so a unique race cannot abort team-create.
   The post-verify Free-grant backfill prefers oldest restricted Free workspaces
   and never assigns the grant to a paid team. Scheduled join billing denials fail
   the occurrence without advancing saved-meeting consecutive-failure pauses.
   Document writes
   require a reservable billing state, not only non-`restricted`. Free-grant claims
   skip removed owner memberships. Storage admission casts aggregated
   `SUM(byte_size)` to a number before adding the new upload. Checkout attaches `POLAR_DISCOUNT_ID` only when the submitted
   code matches `POLAR_DISCOUNT_CODE`. Reservations lock the wallet-funded
   remainder after the PAYG Free floor and included discount, include pending
   reservation charges in the spend cap **and** Free native allowances, count
   in-flight included-discount claims against `includedDiscountRemainingCents`,
   expire on TTL, and Free pause copy follows admission (not a single exhausted
   meter). Released or expired reservations unwind the stamped wallet lock and
   may be replaced for the same operation id; settled rows are reused as
   already-final rather than a fresh lock. Extra member-days accrue with a
   per-extra-member operation id and a cumulative monthly cent delta so daily
   rounding still totals €2 per extra member-month. AI customer charges keep
   fractional cents on `nativeUnits` and round the cumulative delta, so
   sub-cent embeddings still consume the Free/PAYG floor. Email, accepted-source,
   and storage settlements recompute the same cumulative delta under the account
   lock. Polar usage ingest claims the outbox row (`pending` → `in_progress`)
   and sends a stable Polar event `id` so settle and the janitor cannot
   double-ingest; a failed ingest returns the row to `pending`. Polar
   `refund.created` /
   `order.refunded` claw back prepaid top-ups under a serialized remaining-total
   lock, persist out-of-order refunds until `order.paid`, and freeze the
   workspace if the credit was already spent. Auto-reload checkout markers stay
   retryable until Polar checkout succeeds and skip when spend-cap headroom
   cannot cover the €10 product, including a €0 cap. Credentials signup keeps the
   workspace restricted until the owner email is verified; unverified owners are
   excluded from the Free-grant backfill; `email_verification`
   mail is not metered against that restricted workspace. OpenRouter
   `usage.cost` is converted through FX then ×4 with no extra 5.5% markup.
   Janitor included-discount resets lock the billing account and refuse to
   overwrite a newer Polar plan or period. Client-aborted Ask streams settle at
   least the reserved customer charge instead of releasing after work starts.
   `WORKER_MODE=document-extract` allows the non-secret `BILLING_CHARGES_ENABLED`
   toggle so extract AI metering can run live. `withAiMetering` keeps the reservation
   when settle fails after the provider call so a worker retry cannot double-pay
   OpenRouter. Paid-plan changes reuse the Polar subscription id in `past_due`,
   `payment_retry`, `read_only`, and `grace`, not only active states. Period plan
   preview prorates extra members from `member_days` rather than a full month.
   Auto-reload marks Polar checkout created before owner email and retries
   notification after delivery failure without opening a second checkout. Inbound
   email audio skipped for a denied email meter is stamped `transcription_deferred`
   and the janitor flushes transcription when billing can reserve again. Deferred accepted-source flush
   rotates past still-blocked rows. Document restore rechecks storage,
   document, and indexed-chunk capacity under the same advisory lock as create (hash key 1).
   Failed structured-output attempts still contribute OpenRouter `usage.cost` to
   settlement. Duration meters such as Recall minutes split native units across
   the UTC months they span. Plan preview prorates extra seats from recorded
   person-days when the current plan has no extras.
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
