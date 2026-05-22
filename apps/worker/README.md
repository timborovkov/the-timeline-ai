# @timeline/worker

BullMQ workers for the async processing pipeline: transcribe, extract, embed. One Node entry point per queue, all sharing the same image and codebase.

## Why it exists

Long-running, retry-prone work (audio transcription, LLM extraction, vector embedding) belongs off the request path. Each worker type scales independently on Railway so a slow extract backlog can't starve transcription.

## How to use

From the repo root:

```bash
pnpm --filter @timeline/worker dev          # all workers, watch mode
pnpm --filter @timeline/worker build
pnpm --filter @timeline/worker reextract -- --team=<teamId>
pnpm --filter @timeline/worker reembed   -- --team=<teamId> --target-collection=events_v2
```

Production start commands are per-worker (see [docs/railway.html](../../docs/railway.html)):

- `node dist/workers/transcribe.js`
- `node dist/workers/extract.js`
- `node dist/workers/embed.js`

## Where it fits

- Pipeline overview: [docs/product-brief.html](../../docs/product-brief.html).
- Re-extract / re-embed procedures: [docs/setup/openrouter.html](../../docs/setup/openrouter.html).
- Local walkthrough (Phase 3+): [docs/setup/local.html](../../docs/setup/local.html).
