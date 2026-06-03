<p align="center">
  <img src="./docs/timeline-logo.svg" alt="The Timeline logo" width="112" height="112" />
</p>

<h1 align="center">The Timeline</h1>

<p align="center">
  Open-source team memory: capture work as it happens, then query it with cited answers.
</p>

The Timeline is a multi-tenant knowledge system for teams that need a reliable
record of what happened, what changed, and why. It accepts messy real-world
inputs — notes, voice memos, email, Slack, Telegram, documents, meetings, and
integration events — and turns them into an auditable timeline of raw events,
extracted facts, workspace objects, calendar entries, approvals, and searchable
documents.

Every agent answer is grounded in evidence. Raw events remain immutable, derived
facts can be reprocessed as extraction improves, and citations point back to the
source material instead of hiding behind black-box summaries.

## What You Can Build With It

- A searchable team activity archive with source-level citations.
- A chat interface that can answer questions across events, documents,
  meetings, calendar rows, and connected tools.
- Lightweight CRM, project, task, and decision tracking derived from everyday
  communication.
- Team document search with versioned uploads, chunked embeddings, and inline
  document citations.
- Silent, consent-gated meeting transcript capture for Google Meet, Microsoft
  Teams, and Zoom.
- Slack, Telegram, email, Linear, GitHub, Google Drive, and custom MCP-powered
  ingestion surfaces.
- An outbound MCP server so tools like Claude Desktop and Cursor can query a
  team's Timeline.

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
- **One inference layer:** app and worker code call `llm.chat()`,
  `llm.embed()`, `llm.transcribe()`, and `llm.extractTextFromMedia()` from
  `@timeline/shared`.

## Quick Start

Prerequisites:

- Node 24+
- pnpm 9+
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
pnpm dev
```

Open <http://localhost:3000>.

For the full walkthrough, see
[`docs/setup/local.html`](./docs/setup/local.html).

## Useful Commands

```bash
pnpm dev                  # Next.js app + worker in watch mode
pnpm validate             # format check, typecheck, lint, tests, knip
pnpm test                 # unit and integration tests (package suites run sequentially)
pnpm test:eval            # fast deterministic agent and retrieval evals
pnpm e2e                  # Playwright core journey tests
pnpm db:generate          # generate Drizzle migrations after schema changes
pnpm db:migrate           # apply database migrations
pnpm check:web-bundle     # inspect built Next server chunks
```

`pnpm validate` is the main pre-merge gate and includes the unit/integration test suite.

## Documentation

- [`docs/product-brief.html`](./docs/product-brief.html) — product vision,
  principles, and architecture overview.
- [`docs/setup/local.html`](./docs/setup/local.html) — complete local setup.
- [`docs/index.html`](./docs/index.html) — documentation index.
- [`design.md`](./design.md) — UI design system and product interaction model.
- [`todo.md`](./todo.md) — phased build plan and remaining work.
- [`TEST_TODO.md`](./TEST_TODO.md) — current test coverage map and expansion plan.
- [`docs/adr/`](./docs/adr/) — durable architecture decisions.

Setup guides for external services live under [`docs/setup`](./docs/setup/):
Telegram, Slack, OpenRouter, Postmark, Resend transactional email, Recall.ai
meeting bots, PostHog analytics, Sentry, Railway, third-party integrations, and
Timeline-as-MCP-server.

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
