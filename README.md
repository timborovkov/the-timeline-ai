<p align="center">
  <img src="./docs/timeline-logo.svg" alt="The Timeline logo" width="112" height="112" />
</p>

<h1 align="center">The Timeline</h1>

<p align="center">
  An evidence-backed working history for every project.
</p>

<p align="center">
  <a href="https://thetimeline.cc">Website</a> ·
  <a href="https://thetimeline.cc/help">Help</a> ·
  <a href="https://github.com/timborovkov/the-timeline-ai">GitHub</a> ·
  <a href="./docs/setup/local.html">Local setup</a> ·
  <a href="./docs/index.html">Developer docs</a>
</p>

The Timeline preserves work that a team deliberately sends from Slack,
Telegram, meetings, email, documents, and calendar events, plus selected records
from connected tools. It keeps source, time, and visibility attached, answers
questions with citations, and requires human approval before evidence becomes a
durable workspace change.

## What it does

- Captures deliberately routed notes, messages, voice memos, files, and meetings.
- Syncs selected records from supported integrations without treating every connected source as
  evidence for every answer.
- Searches across events, documents, tasks, projects, people, companies, and calendars.
- Produces cited answers, status updates, daily digests, and handoff briefs.
- Turns durable facts and decisions into approval-backed workspace changes.
- Connects GitHub, Linear, Google Drive, Monday.com, Slack, Sentry, and custom MCP servers.
- Enforces team isolation and per-event visibility at the data layer.

The project is under active development. The full local stack works today, but
APIs and migrations may change before a stable release.

## Quick start

Requirements: Node.js 24+, pnpm 11.8+, and Docker.

```bash
git clone https://github.com/timborovkov/the-timeline-ai.git
cd the-timeline-ai
pnpm install

cp .env.example .env
ln -sf ../../.env apps/web/.env
```

Generate `AUTH_SECRET` and `SECRETS_ENCRYPTION_KEY`, then add them to `.env`:

```bash
openssl rand -base64 32
```

Start the infrastructure, migrate the database, seed the demo workspace, and
run the app:

```bash
docker compose up -d

set -a
. ./.env
set +a

pnpm db:migrate
pnpm demo:seed
pnpm dev
```

`demo:seed` runs the idempotent local dev seed, indexes every fixture-version raw
event, fact, document chunk, and meeting chunk through the production embedding
worker path, then runs `demo:verify`. The seed is the Acme Labs / Atlas month of
use: eight logins, dealflow and Series A boards, documents, meetings, Ask history,
pending proposals, and digest history. Verification checks all eight login passwords,
downloads and hashes document bytes, uses team/user-scoped Qdrant searches to confirm
every expected Northstar point is discoverable, then confirms expanded-corpus document
versions are `embedded` with a Qdrant point for each corpus chunk id and that volume
floors hold. A real development
`OPENROUTER_API_KEY` is therefore required; a missing key or unavailable Qdrant fails closed without
marking the document embedded. The commands refuse production, unapproved remote databases or
Qdrant, and non-local/nonstandard S3 storage without its separate explicit acknowledgement.

Open <http://localhost:3000> and sign in with any seeded Acme Labs member. Password
for every login is `timeline-dev`. Start demos as Avery:

| Email | Role |
| --- | --- |
| `owner@timeline.dev` | owner (Avery Timeline, CEO) |
| `member@timeline.dev` | member (Mika Product) |
| `jordan@timeline.dev` | admin (Jordan Hale) |
| `sam@timeline.dev` | member (Sam Rivera) |
| `riley@timeline.dev` | member (Riley Cho) |
| `casey@timeline.dev` | member (Casey Novak) |
| `quinn@timeline.dev` | member (Quinn Okonkwo) |
| `harper@timeline.dev` | member (Harper Singh) |

The seeded provider credentials are fake, encrypted, and disabled for sync.
GitHub and Linear stay in the table below; Monday.com, Sentry, Google Drive, Slack,
the Ledger ingest webhook, and MCP keys are listed in
[docs/demo-corpus.md](./docs/demo-corpus.md) with the full glossary.

| Provider | Access token | Refresh token |
| --- | --- | --- |
| GitHub | `gho_dev_seed_access_token_123` | `ghr_dev_seed_refresh_token_123` |
| Linear | `lin_api_dev_seed_access_token_456` | `lin_refresh_dev_seed_refresh_token_456` |

Reset a local stack with `pnpm demo:reset` (`dev:wipe` then `demo:seed`). The
[demo corpus guide](./docs/demo-corpus.md) covers commands, story, boards,
documents, Ask questions, and fake credentials.

For environment details and troubleshooting, read the
[local development guide](./docs/setup/local.html).

## Architecture

The Timeline is a pnpm/Turborepo monorepo:

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js web app, public pages, API routes, auth, and webhooks |
| `apps/worker` | BullMQ workers for capture, extraction, agents, sync, and maintenance |
| `packages/db` | Drizzle schema, migrations, and database exports |
| `packages/shared` | Team-scoped data access, inference, storage, integrations, and domain modules |
| `docs` | Product, architecture, setup, and deployment documentation |

The core services are Postgres, Redis, Qdrant, and S3-compatible object storage.
Model calls go through OpenRouter behind a shared inference layer.

Two boundaries are non-negotiable:

- Every Postgres query uses the team-scoped data layer, and every Qdrant query filters by `team_id`.
- Source-ingested raw events are immutable. Derived facts can be rebuilt; the evidence cannot.

## Development

```bash
pnpm dev          # run the web app and workers with the exported local env
pnpm validate     # formatting, TypeScript, ESLint, and Knip
pnpm test         # unit and integration tests
pnpm run doctor   # React Doctor
```

Run the nearest targeted test for your change. Changes to shared exports,
agent behavior, or reconciliation have additional gates documented in
[AGENTS.md](./AGENTS.md).

## Documentation

- [Demo corpus](./docs/demo-corpus.md)
- [Documentation index](./docs/index.html)
- [Product brief](./docs/product-brief.html)
- [Local development](./docs/setup/local.html)
- [Integrations and custom MCP servers](./docs/setup/integrations.html)
- [Railway deployment](./docs/railway.html)
- [Architecture decisions](./docs/adr/)
- [Public document registry](./docs/public-site-registry.md)
- [Design system](./design.md)
- [Roadmap](./todo.md)

## Contributing

Issues and pull requests are welcome. Please keep changes team-scoped,
preserve raw evidence, update affected docs, and run `pnpm validate`,
`pnpm run doctor`, and the relevant tests before opening a pull request.
