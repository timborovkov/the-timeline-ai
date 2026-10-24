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
   even while `shadowBilling` is true; paid spend-cap blocking applies when
   charges are enabled.
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
   - `member_days` — extra active-member proration on paid plans. Counted on the
     local spend cap and ingested as `timeline_extra_member_days` (member-month
     fractions against the €2 catalog price on PAYG, Team, and Business).
   Capacity limits (agent turns, concurrent Recall bots, custom MCP servers,
   documents/storage/chunks, active members) are enforced at product gates
   from `CAPACITY_BY_PLAN` / `PLAN_CATALOG.maxActiveMembers`. They are **not**
   Polar meters and must not grow the `billing_meter_id` enum. `/app/usage`,
   Billing settings, and `/pricing` keep live used/limit for those gates in a
   closed Infrastructure limits disclosure. Webhook burst and semantic-search
   burst stay on the existing Redis token buckets; unique ingest volume is the
   `accepted_sources` meter. Extra owned workspaces do not mint a second Free
   grant (`billing_free_grants` + `restricted` state).
7. PAYG, Team, and Business collect on a Polar subscription. PAYG is the €0
   product plus metered prices; checkout saves the card. Usage above the Free
   floor (PAYG) and above the included invoice discount (Team/Business) is
   ingested as Polar events and invoiced monthly in arrears on the card on
   file. There is no prepaid wallet, top-up product, or auto-reload.
   `pnpm billing:polar-setup` archives a product named Timeline Top-up and does
   not create one. The spend cap is the risk control: €0 or metered spend at
   the cap is a hard stop, with owner alerts at 50/75/90/100%. Free workspaces
   hard-stop on native allowances. Comps skip Polar checkout and meter ingest;
   assigning a comp revokes the current Polar subscription, and the comp is
   refused when that subscription exists and Polar is not configured. Metering and the
   spend cap still apply. `past_due` and `payment_retry`
   pause new cost-bearing work. Entering `past_due` emails owners once per UTC
   month. A later active subscription webhook clears that pause. Polar
   subscription webhooks apply
   `shadowBilling` from `BILLING_CHARGES_ENABLED`, map Polar `status`, ignore
   stale activations (older Polar `modified_at` vs `polar_event_modified_at`,
   or an older subscription period), reject Polar webhooks whose Standard
   Webhooks timestamp is outside a 5-minute window, reset Team/Business included
   discount only on a new period start or plan/subscription change, and cancel
   only the matching `polarSubscriptionId`. Spend-cap and shadow writes bump
   `updated_at` and must not hide newer Polar events. A paid spend cap of
   €0 is a hard stop (Free still uses native allowances). Extra member-days skip
   the included-usage discount, settle per extra member per day, and accrue a
   member added after the first daily tick. New reservations stamp
   `wallet_lock_cents: 0`. A historical stamp still unwinds
   `reserved_balance_cents` on settle, release, or expire. Concurrent invite accepts serialize
   member-seat claims with advisory lock key 4. Ask chat titles settle inside
   the Ask reservation. Failed post-verification Free-grant claims retry on the
   next signed-in load. Polar webhook HMAC timestamps follow the same 5-minute
   replay window as Svix. Janitor fallback refills that discount by advancing the stored Polar
   renewal window, not by snapping to UTC calendar months. Paid-plan changes
   PATCH the existing Polar subscription (or open the customer portal) instead
   of creating a second checkout. Included-discount cents stay local. Polar
   ingest sends the customer-payable remainder, scaling native units by
   invoice cents / charge cents and flooring to six decimal places. Sub-cent
   rounds (invoice cents of 0) are not
   ingested. PAYG, Team, Business, and Enterprise ingest only when charges are
   live, the team is not comped, and the active subscription product matches the
   plan and prices the meter. A payable charge with no matching price stays
   pending on the local ledger and opens `billing_unbilled_alerts`. Shadow
   billing and comps do not ingest and do not alert. `member_days` ingest as
   `timeline_extra_member_days` member-month fractions so a custom extra-member
   price invoices through the shared €2 unit price. They still count on the
   local spend cap and skip the included-usage discount. Seat-based prices are
   not used.
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
   exceeds the paid spend cap still records the full ledger charge and freezes
   the workspace (`read_only`, spend cap €0). Raising a positive spend cap
   restores `read_only` or `balance_exhausted`. It does not clear `past_due`.
   Extra member-days persist
   the denied charge and freeze instead of skipping the extra seat. Janitor
   member-day ticks retry unsettled `member_days:<team>:<day>:<user>` facts across
   the full 31-day lookback, including the previous calendar month, after billing
   recovery instead of advancing past denied days. Terminal Recall
   no-shows settle elapsed waiting-room minutes; retry no-shows still release so
   the same meeting can reserve again. Cancelling a joining/active meeting with no
   transcript chunks settles elapsed waiting-room minutes instead of releasing them.
   An active bot `failed`/`fatal` path settles elapsed minutes the same way.
   Settlement errors on those terminal paths propagate so Recall webhooks can 503
   and retry; aborting a join after Recall accepted keeps the reservation when
   leave fails so the janitor can retry leave. Slack/Telegram/MCP Ask and web chat record the completed OpenRouter cost on the reservation before settle and keep that reservation when settlement fails, so the janitor can retry it. A provider call that throws after OpenRouter reported usage settles that cost under `<operation>:failed:<n>` and then releases the work reservation. Worker AI metering reuses the BullMQ job id as the durable operation id, and each transcription chunk appends its index. Web chat also settles known compression cost when the
   answer stream fails. Seat claims are blocked while billing is paused.
   Enterprise settlement does not freeze on the spend cap. Enterprise plan
   changes go through support or the Polar portal. `withAiMetering` skips the
   OpenRouter call when the durable operation is already settled or the reservation
   is reused with `provider_completed`. Member-day ledger rows stamp `plan_id`; later
   janitor ticks reuse that day's included-member count after a plan change. Re-accepting a removed
   member appends the previous interval to `prior_intervals` and stamps a new
   `createdAt`. Interactive search embeddings run under billing ALS.
   The person-level Free grant unassigns when its owner leaves or is demoted, but
   does not restrict the leftover team while another owner's grant remains assigned.
   Re-accepting a removed member stamps a new membership `createdAt` so gap days
   are not billed as continuous, preserving earlier intervals on `prior_intervals`. Janitor member-days backfill missed calendar days, restore rechecks indexed
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
   code matches `POLAR_DISCOUNT_CODE`. Reservations record the invoice remainder
   after the PAYG Free floor and included discount, include pending
   reservation charges in the spend cap **and** Free native allowances, count
   in-flight included-discount claims against `includedDiscountRemainingCents`,
   expire on TTL, and Free pause copy follows admission (not a single exhausted
   meter). Released or expired reservations unwind a historical wallet lock and
   may be replaced for the same operation id; settled rows are reused as
   already-final rather than a fresh lock. Extra member-days accrue with a
   per-extra-member operation id and a cumulative monthly cent delta so daily
   rounding still totals €2 per extra member-month. AI customer charges keep
   fractional cents on `nativeUnits` and round the cumulative delta, so
   sub-cent embeddings still consume the Free/PAYG floor. Email, accepted-source,
   and storage settlements recompute the same cumulative delta under the account
   lock. A percentage discount rounds that cumulative total, not each one-cent
   delta. Polar ingest converts the resulting invoice cents at the catalog unit
   price, so earlier sub-cent usage is included in the units. A product id match
   does not prove the meter is priced; a missing price holds the ledger and alerts.
   Enterprise checkout stores pending terms. The paid subscription webhook
   activates them. Platform-fee overrides are not applied to fixed Polar products. Polar usage ingest claims the outbox row (`pending` → `in_progress`)
   and sends a stable Polar event `id` so settle and the janitor cannot
   double-ingest; a failed ingest returns the row to `pending`. `order.paid`
   does not credit a local balance. Credentials signup keeps the
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
   OpenRouter. Reactivating a released or expired reservation resets `createdAt`
   so a later retry is attributed to the new attempt. Worker AI reservations
   (`metadata.source=worker`) count against `costlyWorkerConcurrency`; a busy
   workspace delays the BullMQ job instead of failing it. Janitor storage
   snapshots backfill missed days across the full 31-day lookback, including the
   previous calendar month, from absent storage operation ids. Each day is priced
   on the plan effective that day, and that plan's included discount is not taken
   from the live balance. Closed document absence intervals are excluded. Paid-plan changes reuse the Polar subscription id in `past_due`,
   `payment_retry`, `read_only`, and `grace`, not only active states. Period plan
   preview prorates extra members from `member_days` rather than a full month.
   Inbound
   email audio skipped for a denied email meter is stamped `transcription_deferred`
   and the janitor flushes transcription when billing can reserve again. Denied inbound-email
   parent enrichment stamps `billing_enrichment_deferred`; the janitor retries `email_units`
   then extract/embed/suggestions (and captured documents) separately from accepted-source
   flush. Deferred accepted-source flush
   rotates past still-blocked rows. Document restore rechecks storage,
   document, and indexed-chunk capacity under advisory lock key 1 then key 2
   (chunk admission reuses key 2). Storage-cap finalization deletes the uploaded
   object when admission fails. Captured Slack/Telegram/email attachments assert
   document and storage capacity. Free in-allowance usage is not invoiced when
   live charging is enabled. Janitor Recall leave retries run before reservation
   expiry, and expiry skips rows with `pending_recall_leave_bot_id`.
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
