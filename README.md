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
instead of being rewritten by hand. Raw events remain immutable, derived facts
can be reprocessed as extraction improves, and citations point back to the
source material instead of hiding behind black-box summaries.

## What You Can Build With It

- A searchable team activity archive with source-level citations.
- Cited updates, daily digests, and handoff briefs generated from the work your
  team already did.
- Global search across app pages, timeline events, documents, objects, tasks,
  boards, calendar events, and integration setup surfaces.
- A chat interface that can answer questions across events, documents,
  meetings, calendar rows, and connected tools.
- Lightweight CRM, project, task, and decision tracking derived from everyday
  communication.
- Work artifact reconciliation that can connect bug reports, Sentry issues,
  GitHub PRs, contracts, deals, clients, decisions, and events through cited
  evidence without letting every related source mutate canonical status.
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
- Custom MCP servers that give the agent live access to long-tail tools without
  automatically ingesting those tools into the event store.
- An outbound MCP server so tools like Claude Desktop and Cursor can query
  team-level workspace context across Timeline events, objects, tasks, boards,
  calendar, documents, and integrations.

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
| `apps/worker` | BullMQ workers for transcription, extraction, embeddings, documents, meetings, integrations, MCP health, and maintenance jobs. |
| `packages/db` | Drizzle schema, migrations, and database package exports. |
| `packages/shared` | Team-scoped data access, LLM wrapper, Qdrant/S3 wrappers, queues, integrations, calendar, documents, meetings, objects, MCP, and other shared domain modules. |
| `docs` | Product, setup, architecture, and deployment documentation. |

The two most important boundaries are:

- **Team isolation:** Postgres access flows through `withTeam(db, teamId,
  userId)` in `@timeline/shared`; Qdrant searches are filtered by `team_id`.
- **One inference layer:** app and worker code call `llm.chatStructured()`,
  `llm.streamChat()`, `llm.embed()`, `llm.embedMany()`, `llm.transcribeAudio()`, and
  `llm.extractTextFromMedia()` from `@timeline/shared`.

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

Seeded account credentials:

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@timeline.dev` | `timeline-dev` |
| Member | `member@timeline.dev` | `timeline-dev` |

Seeded workspace data:

- Team: `Acme Labs` (`acme-labs`) with inbound email
  `acme-labs@inbound.timeline.dev`.
- Events: manual web note, inbound email, Slack message, meeting transcript,
  GitHub integration event, and Linear integration event.
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
pnpm test:eval            # fast deterministic agent and retrieval evals
pnpm test:dist-imports    # build db/shared and import compiled runtime modules with Node
pnpm e2e                  # Playwright core journey tests
pnpm run doctor           # React Doctor scan for React/Next health regressions
pnpm dev:seed             # seed local demo data with disabled fake integrations
pnpm db:generate          # generate Drizzle migrations after schema changes
pnpm db:migrate           # apply database migrations
pnpm check:web-bundle     # inspect built Next server chunks
```

`pnpm validate` is the main static pre-merge gate. Run tests separately with the
smallest command that proves the behavior you changed: `pnpm test`, a
package-filtered Vitest command, `pnpm test:eval`, `pnpm test:dist-imports`, or
an e2e command.
GitHub PR CI intentionally does not run `pnpm build` or `pnpm check:web-bundle`;
TypeScript compilation, linting, formatting, Knip, and the compiled-package
import smoke check are the required CI proof. Run broader tests, build, and
bundle hygiene checks manually when a change touches behavior, production
bundling, deployment output, agent/retrieval quality, or server/client import
boundaries.

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
- [`docs/object-summaries-plan.md`](./docs/object-summaries-plan.md) —
  implementation plan for grounded generated object briefs across object pages,
  search, embeddings, and chat.
- [`docs/integration-ingest-plan.md`](./docs/integration-ingest-plan.md) —
  first-party ingestion implementation plan for work systems, including the
  implemented native providers and future waves.
- [`docs/ux-overhaul-plan.md`](./docs/ux-overhaul-plan.md) — UX overhaul plan:
  soften the forensic surface for non-technical users with standard-page
  headers, a guided connect-flow wizard, actionable error states,
  discoverability, and IA consolidation.
- [`docs/ingest-webhooks-plan.md`](./docs/ingest-webhooks-plan.md) — domain
  plan for named evidence-only ingest webhooks, credential rotation, duplicate
  handling, visibility defaults, and proposal generation.
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

- Keep raw events immutable.
- Route team data access through the scoped modules from `withTeam`.
- Keep direct provider calls behind the shared inference and integration layers.
- Encrypt integration secrets at rest through the shared secrets helpers.
- Fence external MCP and integration content before it reaches the agent.
- Run `pnpm validate` before handing work back.

For UI work, follow [`design.md`](./design.md). For setup or operational changes,
update the relevant docs in the same change.
