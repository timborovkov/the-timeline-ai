<p align="center">
  <img src="./docs/timeline-logo.svg" alt="The Timeline logo" width="112" height="112" />
</p>

<h1 align="center">The Timeline</h1>

<p align="center">
  AI team memory for real projects, with cited answers.
</p>

<p align="center">
  <a href="https://thetimeline.cc">Website</a> ·
  <a href="https://thetimeline.cc/help">Help</a> ·
  <a href="./SUPPORT.md">Support</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./plugins/timeline/skills/README.md">Agent plugins</a> ·
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
- Lets external agents connect over Streamable HTTP with member-authorized OAuth or static
  team-scoped MCP keys. The optional `agent:ask` scope can call enabled team-shared tools, whose
  third-party actions may have external side effects, and create proposals for human review but
  cannot approve or apply them. OAuth `agent:ask` consent is restricted to current team owners and
  admins.
- Enforces team isolation and per-event visibility at the data layer.

The project is under active development. The full local stack works today, but
APIs and migrations may change before a stable release.

The repository includes directly installable Codex and Claude Code plugin packaging
plus the OAuth-capable MCP implementation. OpenAI's universal Plugins Directory
requires a separate **With MCP** submission containing the production MCP connection
and Timeline skill. Anthropic publication is separate too. Treat deployment,
submission, review, approval, and publication as independently verified release states.
The field-by-field listing copy, reviewer cases, provider checklists, and evidence
ledger live in [docs/marketplace-submissions.md](docs/marketplace-submissions.md).
That runbook covers OpenAI and Anthropic directories only. HubSpot, Slack, Attio,
and Pipedrive app listings are separate future work.

## Quick start

Requirements: Bun 1.4.4 and Docker. The runtime is pinned in `.bun-version`.

Install the pinned runtime with `curl -fsSL https://bun.com/install | bash -s "bun-v1.4.4"`,
then open a new shell. Existing checkouts migrated from pnpm should remove their generated
root and workspace `node_modules` directories before the frozen Bun install; keep `.env`
and Docker volumes.

```bash
git clone https://github.com/timborovkov/the-timeline-ai.git
cd the-timeline-ai
bun --version # must match .bun-version
bun run deps --frozen-lockfile

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

bun run db:migrate
bun run demo:seed
# Optional extra volume for infinite-scroll / virtualization:
# bun run dev:seed:heavy
bun run dev
```

`demo:seed` runs the idempotent local dev seed, indexes every fixture-version raw
event, fact, document chunk, and meeting chunk through the production embedding
worker path, then runs `demo:verify`. The seed is the Acme Labs / Atlas month of
use: eight logins, a dense weekday timeline that collapses into moments, dealflow
and Series A boards, documents, meetings, Ask history, pending proposals, and
digest history. Verification checks all eight login passwords,
downloads and hashes document bytes, uses team/user-scoped Qdrant searches to confirm
every expected Northstar point is discoverable, then confirms expanded-corpus document
versions are `embedded` with a Qdrant point for each corpus chunk id and that volume
floors hold. A real development
`OPENROUTER_API_KEY` is therefore required; a missing key or unavailable Qdrant fails closed without
marking the document embedded. The commands refuse production, unapproved remote databases or
Qdrant, and non-local/nonstandard S3 storage without its separate explicit acknowledgement.
`bun run dev:seed:heavy` is optional extra Acme Labs volume for infinite-scroll and virtualization
tests; recorded demos should keep using `demo:seed`.

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

Reset a local stack with `bun run demo:reset` (`dev:wipe` then `demo:seed`). The
[demo corpus guide](./docs/demo-corpus.md) covers commands, story, boards,
documents, Ask questions, and fake credentials.

For environment details and troubleshooting, read the
[local development guide](./docs/setup/local.html).

## Architecture

The Timeline is a Bun/Turborepo monorepo:

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js web app, public pages, API routes, auth, and webhooks |
| `apps/worker` | BullMQ workers for capture, extraction, agents, sync, and maintenance |
| `packages/db` | Drizzle schema, migrations, and database exports |
| `packages/shared` | Team-scoped data access, inference, storage, integrations, and domain modules |
| `packages/test-support` | Bun assertion compatibility and isolated-suite test utilities |
| `.agents/plugins` | Codex marketplace catalog for repository plugins |
| `.claude-plugin` | Claude Code repository marketplace catalog |
| `plugins/timeline` | Codex and Claude Code plugin manifests, hosted MCP connection, and general cited-workspace skill |
| `docs` | Product, architecture, setup, and deployment documentation |

The core services are Postgres, Redis, Qdrant, and S3-compatible object storage.
Model calls go through OpenRouter behind a shared inference layer. Exact pins and
their `zdr_required` or `retained_no_training_exception` policy live together in
`packages/shared/src/llm/models.ts`; Recall.ai meeting transcription is a separate
pipeline from OpenRouter voice-note transcription.

Two boundaries are non-negotiable:

- Every Postgres query uses the team-scoped data layer, and every Qdrant query filters by `team_id`.
- Source-ingested raw events are immutable. Derived facts can be rebuilt; the evidence cannot.

## Development

```bash
bun run dev          # run the web app and workers with the exported local env
bun run validate     # formatting, TypeScript, ESLint, and Knip
bun run test         # unit and integration tests
bun run doctor   # React Doctor
```

Run the nearest targeted test for your change. Changes to shared exports,
agent behavior, or reconciliation have additional gates documented in
[AGENTS.md](./AGENTS.md).

## Documentation

- [Public Trust center](https://thetimeline.cc/trust)
- [Privacy Policy](https://thetimeline.cc/privacy)
- [Cookies and similar technologies](https://thetimeline.cc/cookies)
- [Security, privacy, and trust operating standard](./docs/security-privacy-trust.md)
- [Privacy and analytics implementation interface](./docs/privacy-analytics-interface.md)
- [Help and support channels](./SUPPORT.md)
- [Contribution guide](./CONTRIBUTING.md)
- [Report a security vulnerability](./SECURITY.md)
- [Demo corpus](./docs/demo-corpus.md)
- [Documentation index](./docs/index.html)
- [Product brief](./docs/product-brief.html)
- [Operating memory engine](./docs/relational-memory.md)
- [Local development](./docs/setup/local.html)
- [Bun migration validation and release runbook](./docs/bun-migration.md)
- [Integrations and custom MCP servers](./docs/setup/integrations.html)
- [Codex and Claude Code plugins and agent skill](./plugins/timeline/skills/README.md)
- [Railway deployment](./docs/railway.html)
- [Architecture decisions](./docs/adr/)
- [Public document registry](./docs/public-site-registry.md)
- [Design system](./design.md)
- [Roadmap](./todo.md)

## Contributing

Choose the appropriate channel in [SUPPORT.md](./SUPPORT.md). Reproducible,
non-sensitive bugs may use the structured public issue form; suspected
vulnerabilities belong in the private process in [SECURITY.md](./SECURITY.md).
Before substantial work, follow [CONTRIBUTING.md](./CONTRIBUTING.md), open an
issue, and wait for maintainer agreement. Because the repository does not yet
publish a license or general contribution terms, public visibility alone does
not authorize changes or reuse. Approved contributions must keep changes
team-scoped, preserve raw evidence, update affected docs, and pass
`bun run validate`, `bun run doctor`, and the relevant tests.

## Source availability

The source is public for inspection and contribution, but this repository does
not yet contain an open-source license. Until a license is added, public source
does not grant general permission to copy, modify, redistribute, or self-host
Timeline. The license and contribution terms require a founder and counsel
decision before broader rights can be promised.
