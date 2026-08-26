# @timeline/worker

BullMQ workers for the async processing pipeline: durable direct conversation
agents, transcribe, extract, embed, document-extract (also as a dedicated
`WORKER_MODE=document-extract` / Daytona sandbox service — ADR 0013), meeting-finalize,
task-category classification, overdue-scan, integrations, maintenance, and
exports. One Node entry point starts the queue workers from the same codebase.

## Why it exists

Long-running, retry-prone work (audio transcription, LLM extraction, vector embedding) belongs off the request path. Railway runs the worker service separately from web so backlogs do not block requests.

The `conversation-agent` worker also keeps Telegram/Slack webhook lifetimes
short. It runs the shared tool-using agent once per durable turn, applies the
external profile through a no-tool final-answer pass, persists the answer before
external delivery, and retries delivery from cache. Each job carries the
turn UUID plus its team/user scope, and the worker claims it only through that
`withTeam` conversation scope. Its 180-second deadline includes progress
startup, history loading, and model execution; retained failed queue jobs can
be replaced for cached or still-queued recovery without repeating a paid
answer. Set `TELEGRAM_BOT_TOKEN` on the worker for Telegram typing and replies;
Slack tokens are decrypted from installed workspace records with the same
`SECRETS_ENCRYPTION_KEY` configured on web.

The worker resolves presentation from the current delivery surface. Only
literal `web` uses the rich cited profile; Telegram, Slack, and every future
conversation provider default to compact plain text with internal Timeline
references removed. The 900-token generation ceiling applies only to the
no-tool final-answer pass, leaving tool-call arguments uncapped. New delivery
adapters inherit that policy through the shared conversation runtime and must
not add provider-specific answer prompts or citation sanitizers.

## How to use

From the repo root:

```bash
pnpm --filter @timeline/worker dev          # all workers, watch mode
pnpm --filter @timeline/worker dev:extract  # document-extract only (WORKER_MODE=document-extract)
pnpm --filter @timeline/worker build
pnpm --filter @timeline/worker start:extract
pnpm --filter @timeline/worker create-document-extract-snapshot  # Daytona snapshot ensure (content-hash; --force to rebuild)
pnpm --filter @timeline/worker reextract -- --team=<teamId>
pnpm --filter @timeline/worker reembed   -- --team=<teamId> --target-collection=events_v2
pnpm --filter @timeline/worker resuggest -- --team=<teamId> [--since=2026-06-01] [--until=2026-06-04] [--source=all|telegram|slack] [--limit=N] [--all] [--dry-run]
pnpm --filter @timeline/worker dedupe-approvals -- --team=<teamId> [--limit=N] [--apply]
pnpm --filter @timeline/worker dedupe-calendar-events -- --team=<teamId> [--limit=N] [--from=2026-06-01] [--to=2026-07-01] [--apply] [--no-ai]
pnpm --filter @timeline/worker redocument-extract -- --team=<teamId> [--status=failed,pending] [--force]
pnpm --filter @timeline/worker redocument-embed   -- --team=<teamId> [--target-collection=docs_v2]
TIMELINE_ENV_FILE=/path/to/.env pnpm --filter @timeline/worker task-category-backfill -- --team-id=<teamId> --limit=500 [--enqueue --max-cost-usd=0.10]
```

`resuggest` scans the requested window before applying `--limit`; conversational sources recover
the latest anchor per conversation, and limited runs keep the latest candidate anchors.
The suggestion worker normalizes lifecycle status aliases into the target artifact vocabulary
(`in progress` → `doing` for tasks/follow-ups, but `active` for projects), proposes
cross-artifact lifecycle updates only when evidence resolves to one artifact, and supersedes stale
pending lifecycle approvals while preserving unrelated approval items in the same bundle.
Cross-source proposal evidence is controlled by
`CROSS_SOURCE_EVIDENCE_MODE=off|shadow|enforced` and defaults to `off`. Shadow
mode records content-free pack metrics without changing the prompt; enforced
mode requires exact per-item raw-event citations for generic ingest webhook
proposals. Conversation reviews and other event-local adapters remain on their
legacy paths until they pass separate rollout gates. Restart the worker after
changing the mode.
`dedupe-approvals` defaults to dry-run and supersedes stale duplicate active or retryable approval
items only when workspace reconciliation can identify a survivor. Apply mode also copies duplicate
evidence and records merge history/adjudication metadata on the surviving approval, and can use AI
adjudication for ambiguous same-day timed calendar proposals; dry-run uses only deterministic
checks, so it may undercount apply-mode calendar supersessions.
`dedupe-calendar-events` defaults to dry-run, scans recent and future rows by default, accepts
`--from`/`--to` for explicit date windows, and queues cancellation approvals rather than deleting
calendar rows directly. It uses exact same-slot deterministic text evidence plus an AI semantic pass
across the scan window that can catch translated, differently titled, rescheduled, or
all-day-normalized versions of the same meeting. Pass `--no-ai` to run only the deterministic
matcher. Recurring series masters are skipped as deletion candidates because those need manual
review. When a duplicate cluster is approved, the event with the newest evidence timestamp is kept.

`task-category-backfill` is dry-run by default and reports a bounded candidate count and projected
cost. Enqueueing requires both `--enqueue` and `--max-cost-usd`; repeated bounded runs resume the
backfill while skipping archived, manual, pending, and already categorized tasks.

Production starts the combined worker entry point (see [docs/railway.html](../../docs/railway.html)):

```bash
NODE_ENV=production node apps/worker/dist/index.js
```

Document extract (ADR 0013) runs in Daytona sandboxes coordinated by the separate Railway
`document-extract-orchestrator` service:

```bash
NODE_ENV=production WORKER_MODE=document-extract node apps/worker/dist/extract-main.js
```

Set `DOCUMENT_EXTRACT_ENABLED=false` on the main worker when
`document-extract-orchestrator` owns the queue. Configure that Railway service to use
`/apps/worker/railway.extract.json` as its custom config path.
Locally, prefer `DAYTONA_API_KEY` + `dev:extract`. Only set
`DOCUMENT_EXTRACT_ALLOW_INPROCESS=true` for offline/dev without Daytona (never in production).

Daytona snapshots are content-hashed (`timeline-document-extract-<hash>` from
`document-extract-sandbox/**`). Set `DAYTONA_SNAPSHOT=auto` on Railway so the
deployed code resolves its matching hash. Boot ensure
(`DAYTONA_SNAPSHOT_ENSURE=true`, default) creates the snapshot once if missing;
it does not rebuild on every restart. Push CI ensures snapshots but never
deletes them. Cleanup is a manual workflow dispatch or CLI maintenance action:
set `DAYTONA_ACTIVE_SNAPSHOTS` to every hash used by a deployed production or
staging extractor, then run `cleanup-document-extract-snapshots`. It preserves
that deployed inventory plus the current and two rollback hashes, and skips any
snapshot referenced by a Daytona sandbox. Details:
[docs/adr/0013-daytona-document-extract.md](../../docs/adr/0013-daytona-document-extract.md)
and [document-extract-sandbox/README.md](document-extract-sandbox/README.md).

## Where it fits

- Pipeline overview: [docs/product-brief.html](../../docs/product-brief.html).
- Re-extract / re-embed procedures: [docs/setup/openrouter.html](../../docs/setup/openrouter.html).
- Local walkthrough (Phase 3+): [docs/setup/local.html](../../docs/setup/local.html).
- Meeting bots (Phase 10): [docs/setup/meeting-bots.html](../../docs/setup/meeting-bots.html).
