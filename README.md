<p align="center">
  <img src="./docs/timeline-logo.svg" alt="The Timeline logo" width="112" height="112" />
</p>

<h1 align="center">The Timeline</h1>

<p align="center">
  Capture work as it happens, then generate cited updates, digests, handoffs, and answers.
</p>

The Timeline is an evidence-derived operating record for teams that should not
have to manually report on work they already did. It accepts messy real-world
inputs — notes, voice memos, email, Slack, Telegram, documents, meetings, and
integration events — and turns them into an auditable event history of raw
events, extracted facts, artifact clusters, workspace objects, calendar
entries, approvals, and searchable documents.

The work becomes the record: updates, daily digests, handoffs, stakeholder
answers, project memory, and account context are generated from evidence
instead of being rewritten by hand. Captured source content remains immutable,
derived calendar mirror rows can refresh when their calendar event changes,
derived facts can be reprocessed as extraction improves, and citations point
back to the source material instead of hiding behind black-box summaries.

## What You Can Build With It

- A searchable team activity archive with source-level citations.
- Cited updates, daily digests, and handoff briefs generated from the work your
  team already did.
- Global search across app pages, timeline events, documents, objects, tasks,
  boards, calendar events, and integration setup surfaces.
- Personal, ordered pins across objects and tasks, boards, documents and
  captured files, meetings, calendar series, and grouped timeline moments,
  with a compact Home preview and complete Work manager.
- A chat interface that can answer questions across events, documents,
  meetings, calendar rows, and connected tools.
- Lightweight CRM, project, task, and decision tracking derived from everyday
  communication.
- Work artifact reconciliation that can connect bug reports, Sentry issues,
  GitHub PRs, shared links, contracts, deals, clients, decisions, and events
  through cited evidence without letting every related source mutate canonical
  status.
- Contact extraction that records emails, phone numbers, and conservative
  labeled addresses on raw-event metadata; accepted email/phone memory appears
  as person identity facets instead of standalone artifact objects.
- Team document search with versioned uploads, chunked embeddings, inline
  document citations, PDF/image/audio previews, and a captured-file inbox for
  promoting Telegram/Slack evidence into curated knowledge.
- Silent, consent-gated meeting transcript capture for Google Meet, Microsoft
  Teams, and Zoom.
- Read-only team calendar subscription feeds for viewing Timeline events in a
  default calendar app.
- Slack, Telegram, email, meetings, documents, calendar, native
  GitHub/Linear/Google Drive/Monday.com/Slack workspace/Sentry sync, project
  tools, code systems, support queues, account systems, and internal tools
  flowing into cited timeline evidence.
- Generic ingest webhooks for arbitrary external evidence that should land in
  Timeline without becoming authoritative provider state.
- Custom MCP servers that give the agent live access to long-tail tools; successful
  tool results are captured as private integration evidence for reconciliation.
- An outbound MCP server so tools like Claude Desktop and Cursor can query
  team-level workspace context across bundled timeline moments, raw events,
  objects, tasks, boards, calendar, documents, and integrations.

## Project Status

The core product is active and usable for local development: web app, workers,
capture surfaces, document drive, meetings, integrations, MCP, approvals,
calendar, onboarding, job recovery, tests, and deployment docs are in place.
Public help, Terms of Use, and Privacy Policy pages are also served from the web
app; email/password signup is Turnstile-protected, and signed-in users must
accept the current legal versions before entering `/app`.

The repo is still moving quickly, but the README is written as an entry point
for contributors and operators rather than as a phase log. For the detailed
product rationale and implementation history, start with the docs below.

## Architecture

This is a pnpm/Turborepo monorepo.

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app, public docs, auth, server actions, UI, API routes, and inbound webhooks. |
| `apps/worker` | BullMQ workers for transcription, extraction, embeddings, documents, meetings, integrations, reconciliation, MCP health, object summaries, daily digest, team export, and maintenance jobs. |
| `packages/db` | Drizzle schema, migrations, and database package exports. |
| `packages/shared` | Team-scoped data access, personal pins, LLM wrapper, Qdrant/S3 wrappers, queues, integrations, artifact/workspace reconciliation, calendar, documents, meetings, objects, MCP, and other shared domain modules. |
| `docs` | Product, setup, architecture, and deployment documentation. |

The two most important boundaries are:

- **Team isolation:** Postgres access flows through `withTeam(db, teamId,
  userId)` in `@timeline/shared`; Qdrant searches are filtered by `team_id`.
- **One inference layer:** app and worker code call `llm.chatStructured()`,
  `llm.streamChat()`, `llm.embed()`, `llm.embedMany()`, `llm.transcribeAudio()`, and
  `llm.extractTextFromMedia()` from `@timeline/shared`.

The package root re-exports the reconciliation namespace, and the
`@timeline/shared/reconciliation` subpath exports the shared source-ref
validation, visibility-floor checks, replay-safe dedupe-key builders,
artifact-cluster kind constants, and core reconciliation helpers.
The reconciliation schema also includes an output-owned projection outbox so
approval UI rows can be rebuilt or repaired from `reconciliation_outputs`.
The `@timeline/shared/reconciliation/eval-manifests` subpath exports typed
surface and scenario coverage manifests for scheduled eval/reporting runners.
The `@timeline/shared/reconciliation/authority` subpath exports the field-scoped
authority policy that decides whether evidence can produce a direct write, an
approval bundle, an observed association, or a no-action block.
The `@timeline/shared/reconciliation/planner` subpath exports the shared
structured planner prompt/schema used by live reconciliation evals and
proposal planning metadata for conversation reviews and raw-event batches.
The `@timeline/shared/reconciliation/normalization` subpath exports raw-event
and integration-event normalizers used by the capture surfaces. The
`@timeline/shared/reconciliation/resolver` subpath exports the anchor-based
evidence-to-cluster association resolver. The
`@timeline/shared/reconciliation/backfill` subpath exports the historical
evidence coverage audit and backfill helpers used by the worker
`reconciliation-evidence` command and the queue-backed reconciliation worker;
audit reports include a `releaseGate` that can fail release runs on missing
evidence or non-allowlisted degraded replay rows.
The `@timeline/shared/reconciliation/dashboard` subpath exports the admin
dashboard snapshot used by Team → Reconciliation to inspect evidence coverage,
run logs, output status, projection outbox health, association counts, conflict
attention, provider/source diagnostics, approval acceptance health, and
viewer-visibility-filtered dashboard counts plus cluster drilldowns. It also
exports the legacy-provenance cutover audit used by the worker
`reconciliation-legacy-provenance` command.
The `@timeline/shared/reconciliation/production-sampling` subpath exports the
redacted production-sampling artifact loader and report writer used to
aggregate live artifacts into pass-rate, miss, visibility, authority, and
fixture-candidate metrics; artifact writing and loading reject malformed or
empty redacted source refs, malformed or inconsistent manifest summaries,
malformed judge metadata, malformed expected-count maps, and manifest paths
outside the run directory before they contribute to release metrics.

## Quick Start

Prerequisites:

- Node 24+
- pnpm 11.8+
- Docker Desktop or a compatible Docker runtime

```bash
cp .env.example .env
ln -sf ../../.env apps/web/.env

# Fill required local secrets.
openssl rand -base64 32 # AUTH_SECRET
openssl rand -base64 32 # SECRETS_ENCRYPTION_KEY

docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev:seed
pnpm dev
```

Open <http://localhost:3000>.

### Dev Seed

`pnpm dev:seed` loads `.env`, refuses production and non-local database hosts by
default, and creates a deterministic local demo workspace. Run it after
migrations, or run `pnpm dev:wipe && pnpm dev:seed` when you want a fresh local
database with the seed data. If reserved demo emails, slugs, or UUIDs already
belong to different local rows, the seed exits with a clear conflict instead of
rewiring the graph.
Seeded objects now keep canonical `source_event_id` empty and carry demo
provenance through reconciliation evidence, associations, and applied outputs.

Seeded account credentials:

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@timeline.dev` | `timeline-dev` |
| Member | `member@timeline.dev` | `timeline-dev` |

Seeded workspace data:

- Team: `Acme Labs` (`acme-labs`) with inbound email
  `acme-labs@inbound.timeline.dev`.
- Events: manual web note, inbound email, Slack message, meeting transcript,
  Linear issue update, bundled GitHub PR/review activity, and a bundled GitHub
  CI workflow burst so the default timeline demonstrates moments instead of
  single-event rows only.
- Objects: Project Atlas, vendor appendix task, transcript-only meeting-bot
  decision, Acme Labs company, and Mika Product person.
- Board: `Atlas Launch` with Todo, Doing, and Done lanes.
- Message preferences: daily digest email disabled for both demo users so local
  workers do not need outbound email configured.
- Integrations: disabled fake GitHub and Linear provider connections, resource
  shares, selections, sync cursors, and audit rows.

The seeded provider credentials are intentionally fake, disabled for sync, and
encrypted through the normal `SECRETS_ENCRYPTION_KEY` flow before storage:

| Provider | Access token | Refresh token |
| --- | --- | --- |
| GitHub | `gho_dev_seed_access_token_123` | `ghr_dev_seed_refresh_token_123` |
| Linear | `lin_api_dev_seed_access_token_456` | `lin_refresh_dev_seed_refresh_token_456` |

For the full walkthrough, see
[`docs/setup/local.html`](./docs/setup/local.html).

## Useful Commands

```bash
pnpm dev                  # Next.js app + worker in watch mode
pnpm validate             # format check, typecheck, lint, knip
pnpm test                 # unit and integration tests (package suites run sequentially)
pnpm test:e2e-env         # deterministic E2E env/port contract check
pnpm test:eval            # fast deterministic agent, dashboard chat, retrieval, summary, and proposal evals
AGENT_LIVE_ENV_FILE=/path/.env pnpm test:agent-eval:live
                          # opt-in live LLM askAgent durable-state + provider/document/meeting/MCP synthesis eval
SUGGESTIONS_LIVE_ENV_FILE=/path/.env pnpm test:suggestions-eval:live
                          # opt-in live LLM suggestion worker extraction/projection eval
TRANSCRIBE_LIVE_ENV_FILE=/path/.env pnpm test:transcribe-eval:live
                          # opt-in live OpenRouter speech transcription worker finalization eval
TASK_CATEGORY_LIVE_ENV_FILE=/path/.env pnpm test:task-category-eval:live
                          # opt-in 120-case live task-category classifier gate + confusion matrix
pnpm test:reconciliation-eval       # deterministic reconciliation domain/eval matrix
pnpm test:reconciliation-eval:live  # opt-in live LLM planner+judge matrix; set RECONCILIATION_LIVE_ENV_FILE=/path/.env when needed
# optional: set RECONCILIATION_LIVE_ARTIFACT_DIR=/tmp/eval-run for one exact output dir,
# or RECONCILIATION_LIVE_ARTIFACT_ROOT_DIR=eval-runs/reconciliation for timestamped run folders
# optional: set RECONCILIATION_LIVE_CALL_TIMEOUT_MS=90000 to tune each live planner/judge call timeout
# optional: set RECONCILIATION_LIVE_MAX_ATTEMPTS=3 to retry transient planner,
# judge, and judge-consistency failures
pnpm test:dist-imports    # build db/shared and import compiled runtime modules with Node
pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=audit
pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=audit --fail-on-release-gate
# optional: repeat --allow-degraded-source=<event_source> for known historical degraded replay rows
pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=backfill --dry-run --page-size=500
TIMELINE_ENV_FILE=/path/to/.env pnpm --filter @timeline/worker task-category-backfill -- --team-id=<uuid> --limit=500
                          # dry-run task-category candidates, token estimate, and projected cost
TIMELINE_ENV_FILE=/path/to/.env pnpm --filter @timeline/worker task-category-backfill -- --team-id=<uuid> --limit=500 --enqueue --max-cost-usd=0.10
                          # enqueue one bounded batch when its fixed per-task cost estimate fits the guard; rerun to resume
TIMELINE_ENV_FILE=/path/to/.env pnpm --filter @timeline/worker reconciliation-legacy-provenance -- --team=<uuid> --fail-on-legacy
TIMELINE_ENV_FILE=/path/to/.env pnpm --filter @timeline/worker reconciliation-production-sampling -- --input=/tmp/eval-run --out=/tmp/reconciliation-production-sampling.json --team=<uuid> --run-kind=closed_beta --fail-on-failures
# production sampling accepts repeated --input paths; --run-kind defaults to manual
# and may be manual, closed_beta, or post_deploy. Use --fail-on-failures for
# release gates that should stop on any failed sample. Repeat
# --confirm-fixture=<caseName>:<packetFingerprint> for reviewed failed samples
# that should become deterministic fixtures; reports include confirmed and
# unconfirmed fixture-candidate counts for release review. Add --team=<uuid>
# to persist the report as a Team → Reconciliation eval run.
# The worker process also starts a reconciliation queue consumer for
# evidence_audit/evidence_backfill/scope_reconcile jobs when they are enqueued
# by product or operator code. Queue payloads support optional source, limit,
# pageSize, dryRun, missingOnly, and scoped repair controls. Completed
# audit/backfill jobs persist reconciliation_runs metrics, including
# release-gate failures for audit runs.
# Admins can run missing-only source-scoped backfill dry-runs from
# /app/team/reconciliation in the web app, and can repair scoped
# team/object/cluster evidence, association graph rows, observed association outputs,
# and approval projections from the same dashboard.
pnpm e2e                  # Playwright core journey tests
pnpm run doctor           # React Doctor scan for React/Next health regressions
pnpm canary:integrations  # secret-safe live provider OAuth/LLM+transcription/Postmark/Telegram/Slack/Recall + optional signed capture canaries
pnpm canary:integrations:strict
                           # fail on any skipped or warning live provider canary
pnpm repair:monday -- --env-file=/path/to/.env --team-id=<uuid> --user-id=<uuid>
                           # dry-run stale Monday helper-board repair; add --apply after review
pnpm dev:seed             # seed local demo data with disabled fake integrations and reconciliation provenance
pnpm --filter @timeline/worker timeline-moment-presentations -- \
  --team=<uuid> [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] \
  [--source=all|telegram|slack|integration|email|meeting|calendar|document|ingest_webhook|system] \
  [--max-events=500] [--limit=100] [--user=<uuid>] [--all] [--enqueue|--dry-run]
                          # dry-run/prewarm missing AI presentation cache jobs for timeline moments
pnpm db:generate          # generate Drizzle migrations after schema changes
pnpm db:migrate           # apply database migrations
pnpm check:web-bundle     # inspect built Next server chunks
```

`pnpm validate` is the main static pre-merge gate. Run tests separately with the
smallest command that proves the behavior you changed: `pnpm test`, a
package-filtered Vitest command, `pnpm test:e2e-env`, `pnpm test:eval`,
`pnpm test:reconciliation-eval`, `pnpm test:dist-imports`, or an e2e command.
GitHub PR CI intentionally does not run `pnpm build` or `pnpm check:web-bundle`;
TypeScript compilation, linting, formatting, Knip, reconciliation evals, and
the compiled-package import smoke check are the required CI proof. Run broader
tests, build, and bundle hygiene checks manually when a change touches
behavior, production bundling, deployment output, agent/retrieval quality, or
server/client import boundaries.

## Documentation

- [`docs/product-brief.html`](./docs/product-brief.html) — product vision,
  principles, and architecture overview.
- [`docs/prospect-brief.md`](./docs/prospect-brief.md) — pilot brief for early
  prospects, including ingest surfaces and integration breadth.
- [`docs/prospect-deck.html`](./docs/prospect-deck.html) — self-contained
  prospect deck with the integration story and Work surface framing.
- [`docs/demo-script.md`](./docs/demo-script.md) — crisp Acme demo narrative:
  stakeholder question → cited answer from Slack, meeting, docs, and tasks.
- [`docs/market-thesis.md`](./docs/market-thesis.md) — market transition from
  manual systems of record to event-derived systems of record.
- [`docs/captured-files.md`](./docs/captured-files.md) — captured-file vs.
  document semantics, processing rules, and follow-up implementation bar.
- [`docs/work-system-plan.md`](./docs/work-system-plan.md) — priority plan for
  turning Work into the daily operating surface.
- [`docs/reconciliation-engine-plan.md`](./docs/reconciliation-engine-plan.md) —
  replacement architecture for unifying source evidence, artifact clustering,
  approval-backed memory, provider authority, and live reconciliation evals.
- [`docs/integration-ingest-plan.md`](./docs/integration-ingest-plan.md) —
  first-party ingestion implementation plan for work systems, including native
  provider posture, generic ingest webhook semantics, webhook/budget behavior,
  implemented providers, and future waves.
- [`docs/timeline-moments-redesign-plan.md`](./docs/timeline-moments-redesign-plan.md) —
  full plan for turning the timeline from a raw activity log into bundled,
  evidence-backed work moments shared by the UI, chat agents, and outbound MCP
  tools.
- [`docs/native-provider-template.md`](./docs/native-provider-template.md) —
  implementation checklist and skeleton for adding native providers on the
  shared policy, webhook, budget, and reconciliation path.
- [`docs/calendar.html`](./docs/calendar.html) — approval-backed calendar
  suggestions, recurrence, occurrence exceptions, and tentative slots.
- [`docs/setup/local.html`](./docs/setup/local.html) — complete local setup.
- [`docs/index.html`](./docs/index.html) — documentation index.
- [`design.md`](./design.md) — UI design system and product interaction model.
- [`todo.md`](./todo.md) — phased build plan and remaining work.
- [`TEST_TODO.md`](./TEST_TODO.md) — current test coverage map and expansion plan.
- [`docs/adr/`](./docs/adr/) — durable architecture decisions.

Setup guides for external services live under [`docs/setup`](./docs/setup/):
Telegram, Slack, OpenRouter, LangSmith, Postmark transactional/inbound email,
Recall.ai meeting bots, PostHog analytics, Sentry, Railway, third-party
integrations including ingest webhooks, and Timeline-as-MCP-server.

## Contributing

This project values changes that keep the system auditable, team-scoped, and
operable. Before opening a change, please:

- Keep captured source-ingested raw event content immutable; derived calendar
  mirror rows may refresh from their owning calendar event.
- Route team data access through the scoped modules from `withTeam`.
- Keep direct provider calls behind the shared inference and integration layers.
- Encrypt integration secrets at rest through the shared secrets helpers.
- Fence external MCP and integration content before it reaches the agent.
- Run `pnpm validate` before handing work back.

For UI work, follow the Quiet Archive v3 contract in [`design.md`](./design.md):
human meaning leads, while internal identifiers and raw payloads stay inside
explicit technical disclosures. For setup or operational changes, update the
relevant docs in the same change.
