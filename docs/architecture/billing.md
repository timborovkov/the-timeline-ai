# Billing contract

The local durable ledger owns admission, reservations and recorded usage. Polar is merchant of record for collection. [ADR 0018](../adr/0018-polar-native-meter-billing.md) explains the choice, and [Polar setup](../setup/polar.md) owns configuration and recovery. The [shared billing catalog](../../packages/shared/src/billing/catalog.ts) defines prices, allowances, meter identifiers and capacity limits.

## Admission and settlement

Cost-bearing work reserves capacity before execution, then settles reported work or releases unused reservation. Account locks precede reservation locks across reserve, settle, release and expiry. Durable operation identities prevent replay from charging twice. Failed or interrupted work may still incur reported provider cost; never erase that cost merely because the product result failed.

Shared inference calls settle exact reported usage under the worker billing context. Ask and Recall retain their own reservation paths to avoid double-counting. Completed Ask steps settle on interruption; unreported partial usage is marked incomplete rather than estimated from the reservation. Historical pricing, discounts and member attribution are immutable once recorded. Recovery keeps the original reservation actor, including a guest whose membership access has since ended.

Free and seat-priced Team each share one allowance across AI and native meeting capture. Free resets at the start of each UTC calendar month. Confirmed Team seats fund the shared pool for the subscription period. Additional spending starts off, and a workspace owner or admin can opt in with a monthly cap. Settlement records the actual cost of an admitted operation and collects only within the cap approved at admission and still available at settlement. A person-level Free grant can fund only one owned workspace. Free hard stops remain enforced in shadow mode.

Ask reserves a small hold from the catalog to leave room for search near the end of the allowance. An admitted turn settles its full reported provider usage even if the cost exceeds the hold or allowance. Later admissions stop when available usage is exhausted. Search embeddings have their own reservation alongside Ask. Embedding reservations scale with the truncated input token count and allowed attempts, preserving fractional cents at ledger precision. Payable AI reservations round up after discounts so a positive estimate cannot bypass a paid spend cap.

Full workspace membership uses an explicit role allowlist. Guests have no paid-seat or Free member entitlement. Their questions draw from the host workspace's AI allowance. Authorized invite acceptance and promotion acquire paid capacity in the membership transaction. Capacity previews cannot purchase seats. While a payable Team checkout is open or awaiting verification, full-member acceptance waits and the invitation stays usable. Removal commits access revocation immediately. An already-issued quote keeps its authorized quantity, which is reconciled for renewal. Paid capacity stays reusable until renewal. A period’s confirmed seat high-water mark prevents churn and webhook replay from minting duplicate usage.

## Meter semantics

Free and seat-priced Team bundle email, accepted sources and storage within plan limits. Only AI and native meeting capture use the shared allowance. On seat-priced Team those two meters can produce additional invoice charges after explicit opt-in. Enterprise pricing follows the agreement. Existing legacy subscriptions and ledger rows retain their recorded terms.

| Meter | Boundary |
| --- | --- |
| AI | Reported inference cost; preserve failed-attempt and interrupted-step accounting. |
| Recall minutes | Reserve call time; measure from actual call start, not scheduling time, and bound provider leave behavior. |
| Email units | Accepted inbound messages and outbound recipients; admission/delivery identities prevent duplicates. |
| Accepted sources | One eligible source item admitted before paid enrichment. A meeting shares its identity between chunks and finalization. Preserve evidence when enrichment is deferred. |
| Storage | Original-file byte usage accumulated as GB-month; live stored bytes are the UI quantity. Local allowances must not be duplicated as provider credits. |
| Member usage | Team uses the confirmed Polar seat quantity. Existing daily-member facts retain their historical terms and never consume Included usage. |

Plan capacity (turns, bots, servers, documents, chunks, storage and membership) and rate limits govern product admission. Sub-cent accumulation and percentage discounts use cumulative amounts before rounding. Meter ingest uses units that reproduce the recorded charge.

## Collection and provider ordering

Team checkout verifies the monthly USD seat product and fixes the quantity at the full-member roster. Retry looks up the original payable quote under the same workspace lock. Payable Team and Enterprise links block competing checkout and comp changes until the payment ends or its subscription is applied. Verified Polar subscription reads can recover missed seat or period changes through the same allowance accounting as webhooks. Maintenance cannot buy seats to close a roster shortfall. Legacy ledger rows preserve their recorded terms. A matching active subscription must actually price the meter before delivery. Missing pricing retains local ledger evidence and opens a bounded unbilled-usage alert; retries resolve it after successful ingest. Shadow mode, comps, free usage and sub-cent residuals must not create spurious collection alerts.

Verify webhook signature, bounded body and replay window before processing. Lock the account and compare provider event clocks/periods; local `updated_at` is not a provider clock. Stale subscription events cannot reactivate old state or cancel a different subscription. Refill included credit only on the corresponding new period/plan transition; UI reads must not silently reset it. Before applying an elapsed USD Team cancellation, maintenance checks the current subscription so a delayed webhook cannot drop a renewed workspace to Free. Past-due/payment-retry states pause applicable new spending and recover through verified provider events.

Comp assignment clears the subscription-managed seat grant so the operator-managed allowance can renew after the former paid period. Payable Enterprise checkouts must expire before saving the comp. Existing subscription revocation retains durable recovery state on provider failure; a late subscription event must not replace an existing comp. Apply operator overrides through the audited billing service, not direct ledger edits.

## Team customer and member authority

Each team has one verified customer mapping per provider organization/environment. Customer identity is explicit; email lookup never chooses the customer. Verified owners/admins receive customer-scoped memberships; ordinary members do not. Portal sessions use the signed-in member, not a shared owner identity.

Role removal records durable revocation intent under the account lock, revokes provider access before local removal, and blocks new sessions while pending. Transfer provider ownership before removing its owner. Retry interrupted operations rather than clearing pending state. Legacy customer-level email may independently receive access links; member deletion alone cannot establish revocation of that access. [Dated sandbox evidence](../evidence/polar-team-identity-2026-10.md) records the provider limitation; reverify before claiming it fixed.

## Display and reconciliation

Recorded usage is not a forecast or final invoice. Show plan fees, metered usage, pooled credit and calendar spend caps distinctly; preserve the correct renewal/reset dates. Unknown attribution remains unavailable rather than guessed. Financial detail follows member authorization.

Invoice reconciliation and provider/member-access verification are operating evidence, not inferred from unit tests. See [Polar release checks](../setup/polar.md#verification-and-release).

## Disabled and deleted teams

Disabling records durable period-end cancellation intent and checks recorded pending self-serve and Enterprise checkout states through verified provider identities. Provider failure does not postpone access disabling. New processing and daily storage/member accrual stop. Any day overlapping a disabled interval is waived by daily meters, including later backfill after restoration. Previously incurred usage still settles; there are no automatic refunds. Bot cancellation records consumed Recall minutes and durable settlement intent. Before erasing source history, lifecycle cleanup backfills eligible storage/member days from team creation through the day before disabling in checkpointed batches of at most 31 days, using historical pricing and excluding every disabled interval. This settlement does not reopen access or admit new work. Restoring access does not resume renewal. Deleting/deleted teams cannot be reactivated by late billing events; incoming subscriptions are reconciled against the stored customer identity before revocation.

Permanent erasure removes content-bearing usage metadata but retains an explicit financial allowlist: invoice/credit splits, historical pricing and usage timestamps, period allocations, and provider-ingest reconciliation fields. Retained financial records remain subject to their retention and hold rules.

## Website capture

[Website sources](../websites.md) count 20 accepted-source units per captured page for capacity, including unchanged pages. Free and seat-priced Team bundle capture and storage within plan limits. AI analysis uses the shared allowance. Legacy admissions retain their recorded pricing terms and source-unit multiplier.
