# Workspace reconciliation is artifact-centered and approval-backed

Canonical engine narrative:
[`docs/relational-memory.md`](../relational-memory.md). This ADR records the
decision, not the living workflow.

Workspace Reconciliation keeps approvals, workspace objects, tasks, calendar
events, and other impact context mutually consistent as newer timeline evidence
arrives. Reconciliation records inferred Artifact Clusters alongside suggestion
and object evidence rather than treating raw conversations as the consistency
boundary. Suggestion reconciliation may automatically supersede pending
approvals, and artifact evidence can create approval-backed correction or
lifecycle proposals for canonical state unless an authoritative source updates
the artifact it owns. This preserves immutable raw events and human control over
durable workspace state while reducing stale approval noise.
