# @timeline/worker

BullMQ workers for the async processing pipeline: transcribe, extract, embed, document-extract, meeting-finalize, overdue-scan, integrations, maintenance, and exports. One Node entry point starts the queue workers from the same codebase.

## Why it exists

Long-running, retry-prone work (audio transcription, LLM extraction, vector embedding) belongs off the request path. Railway runs the worker service separately from web so backlogs do not block requests.

## How to use

From the repo root:

```bash
pnpm --filter @timeline/worker dev          # all workers, watch mode
pnpm --filter @timeline/worker build
pnpm --filter @timeline/worker reextract -- --team=<teamId>
pnpm --filter @timeline/worker reembed   -- --team=<teamId> --target-collection=events_v2
pnpm --filter @timeline/worker resuggest -- --team=<teamId> [--since=2026-06-01] [--until=2026-06-04] [--source=all|telegram|slack] [--limit=N] [--all] [--dry-run]
pnpm --filter @timeline/worker dedupe-approvals -- --team=<teamId> [--limit=N] [--apply]
pnpm --filter @timeline/worker dedupe-calendar-events -- --team=<teamId> [--limit=N] [--from=2026-06-01] [--to=2026-07-01] [--apply]
pnpm --filter @timeline/worker redocument-extract -- --team=<teamId> [--status=failed,pending] [--force]
pnpm --filter @timeline/worker redocument-embed   -- --team=<teamId> [--target-collection=docs_v2]
```

`resuggest` scans the requested window before applying `--limit`; conversational sources recover
the latest anchor per conversation, and limited runs keep the latest candidate anchors.
The suggestion worker normalizes lifecycle status aliases into the target artifact vocabulary
(`in progress` → `doing` for tasks/follow-ups, but `active` for projects), proposes
cross-artifact lifecycle updates only when evidence resolves to one artifact, and supersedes stale
pending lifecycle approvals while preserving unrelated approval items in the same bundle.
`dedupe-approvals` defaults to dry-run and supersedes stale duplicate pending approval items only
when the same conservative workspace reconciliation predicate can identify a survivor.
`dedupe-calendar-events` defaults to dry-run, scans recent and future rows by default, accepts
`--from`/`--to` for explicit date windows, and queues cancellation approvals rather than deleting
calendar rows directly. It skips recurring series masters as deletion candidates because those need
manual review.

Production starts the combined worker entry point (see [docs/railway.html](../../docs/railway.html)):

```bash
NODE_ENV=production node apps/worker/dist/index.js
```

## Where it fits

- Pipeline overview: [docs/product-brief.html](../../docs/product-brief.html).
- Re-extract / re-embed procedures: [docs/setup/openrouter.html](../../docs/setup/openrouter.html).
- Local walkthrough (Phase 3+): [docs/setup/local.html](../../docs/setup/local.html).
- Meeting bots (Phase 10): [docs/setup/meeting-bots.html](../../docs/setup/meeting-bots.html).
