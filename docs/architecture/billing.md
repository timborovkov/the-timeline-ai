# Billing contract

The local durable ledger owns admission, reservations and recorded usage. Polar is merchant of record for collection. [ADR 0018](../adr/0018-polar-native-meter-billing.md) explains the choice; [Polar setup](../setup/polar.md) owns configuration and recovery. Prices, allowances, meter identifiers and capacity limits are defined by the shared billing catalog, not copied into documentation.

## Admission and settlement

Cost-bearing work reserves capacity before execution, then settles reported work or releases unused reservation. Account locks precede reservation locks across reserve, settle, release and expiry. Durable operation identities prevent replay from charging twice. Failed or interrupted work may still incur reported provider cost; never erase that cost merely because the product result failed.

Shared inference calls settle exact reported usage under the worker billing context. Ask and Recall retain their own reservation paths to avoid double-counting. Completed Ask steps settle on interruption; unreported partial usage is marked incomplete rather than estimated from the reservation. Historical pricing, discounts and member attribution are immutable once recorded.

Free allowances and plan capacities are distinct from billed meters. Free and PAYG share the catalog’s included native allowances; changing that floor affects both plans, while Ask turn capacities remain plan-specific. Ask uses a small admission hold from the catalog rather than a worst-case turn estimate, leaving room for search near the end of the Free allowance. An admitted turn settles its full reported provider usage even when it exceeds the hold or remaining allowance; later admissions stop when the allowance is exhausted. The hold does not impose a maximum per-turn cost. Embedding admission scales its reservation with the truncated input token count and allowed attempts, using the catalog’s conservative embedding budget and preserving fractional cents at ledger precision. Search embeddings retain their own reservation alongside Ask; settlement still records reported provider cost rather than the admission estimate. Payable AI reservations round up after discounts so a positive estimate cannot bypass a paid spend cap. Free hard stops remain enforced in shadow mode. Paid spend caps apply according to enforcement and contractual/comp policy; a zero paid cap is a hard stop where enforcement applies. Extra owned workspaces cannot mint another person-level Free grant. Verification and active ownership are required for a grant; failed claims are retryable.

## Meter semantics

| Meter | Boundary |
| --- | --- |
| AI | Reported inference cost; preserve failed-attempt and interrupted-step accounting. |
| Recall minutes | Reserve call time; measure from actual call start, not scheduling time, and bound provider leave behavior. |
| Email units | Accepted inbound messages and outbound recipients; admission/delivery identities prevent duplicates. |
| Accepted sources | One eligible source item admitted before paid enrichment. A meeting shares its identity between chunks and finalization. Preserve evidence when enrichment is deferred. |
| Storage | Original-file byte usage accumulated as GB-month; live stored bytes are the UI quantity. Local allowances must not be duplicated as provider credits. |
| Member usage | Daily extra-member accrual, idempotent per member/day, transformed to provider catalog units. It is not provider seat-quantity proration and does not consume pooled usage credit. |

Plan capacity (turns, bots, servers, documents, chunks, storage and membership) remains product admission policy, not extra Polar meters. Rate limits remain infrastructure admission. Sub-cent accumulation and percentage discounts use cumulative amounts before rounding; meter ingest uses units that reproduce the recorded charge.

## Collection and provider ordering

PAYG and commitment plans collect through subscriptions and monthly usage; there is no wallet/top-up flow. A matching active subscription must actually price the meter before delivery. Missing pricing retains local ledger evidence and opens a bounded unbilled-usage alert; retries resolve it after successful ingest. Shadow mode, comps, free usage and sub-cent residuals must not create spurious collection alerts.

Verify webhook signature, bounded body and replay window before processing. Lock the account and compare provider event clocks/periods; local `updated_at` is not a provider clock. Stale subscription events cannot reactivate old state or cancel a different subscription. Refill included credit only on the corresponding new period/plan transition; UI reads must not silently reset it. Past-due/payment-retry states pause applicable new spending and recover through verified provider events.

Comp assignment must revoke an existing subscription and expire payable Enterprise checkout state before saving the comp. Failed provider cancellation leaves durable recovery state; a late subscription event must not replace an existing comp. Apply operator overrides through the audited billing service, not direct ledger edits.

## Team customer and member authority

Each team has one verified customer mapping per provider organization/environment. Customer identity is explicit; email lookup never chooses the customer. Verified owners/admins receive customer-scoped memberships; ordinary members do not. Portal sessions use the signed-in member, not a shared owner identity.

Role removal records durable revocation intent under the account lock, revokes provider access before local removal, and blocks new sessions while pending. Transfer provider ownership before removing its owner. Retry interrupted operations rather than clearing pending state. Legacy customer-level email may independently receive access links; member deletion alone cannot establish revocation of that access. [Dated sandbox evidence](../evidence/polar-team-identity-2026-10.md) records the provider limitation; reverify before claiming it fixed.

## Display and reconciliation

Recorded usage is not a forecast or final invoice. Show plan fees, metered usage, pooled credit and calendar spend caps distinctly; preserve the correct renewal/reset dates. Unknown attribution remains unavailable rather than guessed. Financial detail follows member authorization. The public calculator is local and illustrative; it neither changes billing nor proves eligibility.

Invoice reconciliation and provider/member-access verification are operating evidence, not inferred from unit tests. See [Polar release checks](../setup/polar.md#verification-and-release).

## Disabled and deleted teams

Disabling records durable period-end cancellation intent and expires recorded pending self-serve and Enterprise checkouts through verified provider identities. Provider failure does not postpone access disabling. New processing and daily storage/member accrual stop. Any day overlapping a disabled interval is waived by daily meters, including later backfill after restoration. Previously incurred usage still settles; there are no automatic refunds. Bot cancellation records consumed Recall minutes and durable settlement intent. Before erasing source history, lifecycle cleanup backfills eligible storage/member days from team creation through the day before disabling in checkpointed batches of at most 31 days, using historical pricing and excluding every disabled interval. This settlement does not reopen access or admit new work. Restoring access does not resume renewal. Deleting/deleted teams cannot be reactivated by late billing events; incoming subscriptions are reconciled against the stored customer identity before revocation.

Permanent erasure removes content-bearing usage metadata but retains an explicit financial allowlist: invoice/credit splits, historical pricing and usage timestamps, period allocations, and provider-ingest reconciliation fields. Retained financial records remain subject to their retention and hold rules.

## Website capture

[Website sources](../websites.md) use the existing accepted-source meter with 20 source units per captured page, including unchanged pages and ingestion. Legacy admissions retain their original multiplier. AI and storage are separate. The same multiplier powers the public calculator; no new Polar meter is required.
