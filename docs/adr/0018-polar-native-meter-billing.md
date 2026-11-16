# ADR 0018: Polar native meters with a local ledger

Status: accepted.

## Context

Timeline needs team-scoped commercial billing with Free, pay-as-you-go, optional
Team/Business commitments, and Enterprise later. Costs are heterogeneous (AI
tokens, Recall minutes, email, storage, accepted sources). A single opaque
credit hides margin and confuses prospects.

## Decision

Use Polar as merchant of record with native usage meters, and retain a durable team-scoped local ledger for admission, reservations, idempotent settlement and dashboards. Keep capacity gates distinct from billed meters. Customer/member identity is scoped to a Timeline team and provider environment. Begin in shadow mode until reconciliation is evidenced.

## Consequences

Provider failures require durable retry and reconciliation; local admission cannot depend on a completed remote invoice. Historical prices and usage remain attributable and immutable. Member access and revocation require provider verification, not just local role changes. A wallet/top-up abstraction is not part of this model.

The [billing contract](../architecture/billing.md) owns current behavior; [Polar setup](../setup/polar.md) owns configuration/conversion; [dated evidence](../evidence/polar-team-identity-2026-10.md) records provider limitations.
