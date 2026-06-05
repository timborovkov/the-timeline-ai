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
pnpm --filter @timeline/worker redocument-extract -- --team=<teamId> [--status=failed,pending] [--force]
pnpm --filter @timeline/worker redocument-embed   -- --team=<teamId> [--target-collection=docs_v2]
```

`resuggest` scans the requested window before applying `--limit`; conversational sources recover
the latest anchor per conversation, and limited runs keep the latest candidate anchors.

Production starts the combined worker entry point (see [docs/railway.html](../../docs/railway.html)):

```bash
NODE_ENV=production node apps/worker/dist/index.js
```

## Where it fits

- Pipeline overview: [docs/product-brief.html](../../docs/product-brief.html).
- Re-extract / re-embed procedures: [docs/setup/openrouter.html](../../docs/setup/openrouter.html).
- Local walkthrough (Phase 3+): [docs/setup/local.html](../../docs/setup/local.html).
- Meeting bots (Phase 10): [docs/setup/meeting-bots.html](../../docs/setup/meeting-bots.html).
