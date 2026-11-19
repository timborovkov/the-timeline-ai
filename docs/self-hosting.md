# Self-hosting The Timeline

This guide describes what it takes to run The Timeline yourself from the public
repository. It is based on the same Compose stack and setup paths the project
uses for local development. You operate the deployment: infrastructure,
secrets, upgrades, backups, and which third-party connectors or AI endpoints
you enable.

The Timeline is **source-available** under the
[Elastic License 2.0](../LICENSE) (`Elastic-2.0`), not an OSI-approved open-source
license. You may use, copy, modify, and self-host it for your own organisation.
You may **not** offer it to third parties as a hosted or managed service, and
you may not remove licensing or copyright notices. Read the LICENSE before you
deploy.

For a managed on-premise or private-cloud deployment run by The Timeline team,
use the [Enterprise enquiry form](https://thetimeline.cc/contact/enterprise?topics=on_premise_deployment)
instead of this guide.

## What you run

| Component | Role | Local Compose service |
| --- | --- | --- |
| PostgreSQL 18 | Primary application database | `postgres` |
| Redis | BullMQ job queues | `redis` |
| Qdrant | Vector search | `qdrant` |
| RustFS (S3-compatible) | Object storage for files and audio | `rustfs` (+ `rustfs-init`) |
| Web (`apps/web`) | Next.js app and APIs | host process or Compose `app` profile |
| Worker (`apps/worker`) | Background jobs (capture, extract, embed, sync) | host process or Compose `app` profile |

Source of truth for the infra services is [`docker-compose.yml`](../docker-compose.yml).
App and worker images are built from [`docker/web.Dockerfile`](../docker/web.Dockerfile)
and [`docker/worker.Dockerfile`](../docker/worker.Dockerfile).

## Prerequisites

- Bun matching [`.bun-version`](../.bun-version) (currently 1.4.4)
- Docker (or compatible) for the Compose services
- A funded AI provider key for chat, embeddings, and related features when those
  features are required

## Minimum configuration

Copy [`.env.example`](../.env.example) to `.env` and fill at least:

- `AUTH_SECRET` — session/auth secret (`openssl rand -base64 32`)
- `SECRETS_ENCRYPTION_KEY` — 32-byte base64 key for integration/MCP secrets at rest
- `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, and S3 settings matching your Compose
  or production equivalents (defaults in `.env.example` match local Compose)
- `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` — the shared LLM layer talks to
  an **OpenAI-compatible** HTTP API. The documented default is OpenRouter
  (`https://openrouter.ai/api/v1`). Point `OPENROUTER_BASE_URL` at the compatible
  endpoint you operate or subscribe to; model ids remain code-owned
- `FIRECRAWL_API_KEY` — required before the web app or full worker boots when
  website scanning is in the product path
- `AUTH_URL` — the public origin of your deployment

Optional connectors (Slack, Telegram, GitHub, Google Drive, Linear, Monday.com,
Sentry, Resend, meeting bots, billing, Turnstile, and others) are configured by
you with the corresponding env vars. Leave unused keys empty. Setup details live
under [`docs/setup/`](setup/).

Hosted Timeline production also uses OpenRouter privacy attestation and
guardrail settings that are specific to Timeline’s operated environment. A
self-hosted deployment must choose its own AI endpoint, retention, and
compliance posture; do not assume hosted ZDR or attestation claims apply.

## Bring-up outline

These are the verified local commands. Adapt hosts, secrets, and persistence for
your environment; this is not a turnkey production runbook.

1. Start infrastructure: `docker compose up -d` and wait until services are healthy
   (`docker compose ps`).
2. Install dependencies: `bun run deps` (or `bun run deps --frozen-lockfile`).
3. Export env into the shell for database/worker commands:
   `set -a; . ./.env; set +a`
   Symlink for Next.js: `ln -sf ../../.env apps/web/.env`
4. Apply migrations: `bun run db:migrate`
5. Run the app and workers: `bun run dev` on the host, or
   `docker compose --profile app up` for containerized app/worker parity.
6. Open the web origin you configured (local default `http://localhost:3000`).

Longer walkthroughs, demo seeding, PostgreSQL upgrades, and service-specific
setup remain in [local development](setup/local.md) and the linked setup guides.
Do not use demo seed commands against production data.

## Operator responsibilities

- You run backups, restores, upgrades, TLS, networking, and secret rotation.
- You choose which integrations and AI models to enable and accept their data
  flows.
- Capture, sync, and inference jobs only run when the worker process and required
  keys are available.
- There is no claimed SOC 2, ISO 27001, HIPAA, or contractual SLA for a deployment
  you operate yourself. Hosted Timeline assurance status is described on
  [Trust](https://thetimeline.cc/trust).

## Related documents

- [Local development](setup/local.md) — detailed first-time local stack
- [Railway deployment](railway.md) — how Timeline operates the hosted cloud (not
  a generic self-host template)
- [OpenRouter / inference](setup/openrouter.md) — AI routing and OpenAI-compatible
  client behaviour
- [Integrations](setup/integrations.md) — connector credentials and scopes
- [LICENSE](../LICENSE) — Elastic License 2.0 terms
