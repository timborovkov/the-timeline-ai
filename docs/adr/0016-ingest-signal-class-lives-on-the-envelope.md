# ADR 0016 — Ingest signal class lives on the source envelope

Canonical engine narrative:
[`docs/relational-memory.md`](../relational-memory.md). This ADR records the
ingest-rights decision. It does not replace the living workflow.

## Status

Accepted.

## Context

Core ingest used OAuth app names to decide whether an event may extract or
originate proposals: GitHub, Linear, Monday, and Sentry skipped the LLM;
Google Drive was a pulse. That cannot express "this GitHub row is a merged
PR" versus "this GitHub row is a workflow run" without `if (provider ===
"github")` in shared proposal code.

The source envelope already carries `objectMap`, `externalObjectId`, and
human-facing text. Signal class belongs on that envelope so adapters stamp
rights at write time and core reads the envelope.

## Decision

Every integration event has a `signalClass`:

- `communication` — may extract and review.
- `captured_work` — persist, embed, parse `objectMap`; may write coalesced
  approval-backed field changes. No extract. No suggestion model.
- `pulse` — persist, embed, attach when a hard join exists. Never extract.
  Never originate proposals.
- `finding` — review comments, CI annotations, Sentry incidents. Attach to
  the parent work hub. Do not mint sibling Timeline tasks.

Adapters should stamp `signalClass`. The event-writer persists
`source_metadata.signal_class` and a compact `object_map`, and fills a
conservative fallback from envelope shapes (including adapter extra such as
`github.type`) plus a legacy provider fallback so already-ingested rows keep
skipping extract.

Captured-work matching reads `objectMap` + status + aliases. GitHub PR/issue
parsing may still enrich aliases and assignee logins inside the GitHub
adapter-shaped extra. Linear and Monday item completion reuse the same
living-pending matcher. Sentry incidents and GitHub workflow runs do not
enter that matcher.

## Consequences

- GitHub PRs and GitHub CI can differ without a core provider switch.
- Extract skip is per event, not per OAuth app.
- Findings never originate Timeline tasks.
- Packs still default `off`. Pulses stay out of proposal origin.
- Timeline `event_class` (presentation: `communication` / `work_record` /
  `pulse` / `incident` / `artifact` / `schedule`) is a sibling stamp, not a
  substitute. Ingest never reads `event_class` to decide extract or proposals.

## Related

- [ADR 0015](./0015-proposal-writes-qualify-hubs-from-mentions-and-container-labels.md)
- [`docs/relational-memory.md`](../relational-memory.md)
