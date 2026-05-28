# The Timeline

A multi-tenant team memory system. Capture work as it happens — voice notes,
text dumps, forwarded emails, Telegram and Slack messages, meeting transcripts — and
the system compiles a searchable, queryable history of who did what, talked
to whom, and decided what. Then ask a tool-using agent about it: every
claim it surfaces links back to the raw event it came from. No black-box
summaries.

Current state: through Phase 13.7. Web + Telegram + Slack + email + document drive +
meeting-bot capture (silent Recall.ai bot for Google Meet / Teams / Zoom),
voice transcription, extracted facts + entities, semantic search, agent
chat at `/app/chat`, workspace objects + boards + persisted chat sessions,
a team document drive at `/app/documents` (folders, versioned uploads,
chunked + embedded, cited inline with `[doc:<id>#v<n>:chunk:<id>]`), and
an internal calendar at `/app/calendar` with all-day events, ISO week/day/month
views, private busy-block redaction, and calendar-aware agent tools. Agents and
background workers now create proposal-only task/object/calendar suggestions,
reviewed from the unified `/app/approvals` queue before becoming canonical
state. Third-party integrations (Google Drive, Linear, GitHub native + custom
MCP servers per team or per user) live at `/app/team/integrations` — plus an
outbound MCP server at `/api/mcp/server` so external agents (Claude Desktop,
Cursor, etc.) can query this Timeline. The Home Dashboard at `/app` gathers
capture, onboarding, ingest access, pending approvals, and compact recent
moments; `/app/timeline` is the dedicated grouped timeline browser with source
presets, impact filters, density controls, inspector evidence, and hydrated
Impact Context from suggestions, tasks/objects, documents, and calendar rows.
The main timeline, object sections, document lists, and document search are
paginated for large beta workspaces, with short-lived visibility-aware Redis
caches and React Query only on interactive surfaces. Public help docs live at
`/help`, with a support/contact form that stores requests in Postgres, sends
them through Postmark, and uses Turnstile in production. Email/password
registration is also Turnstile-protected; signed-in expensive surfaces use named
Redis-backed rate-limit policies. Owners/admins can recover team-scoped failed
or stuck product jobs at `/app/team/jobs`. Railway deployment, deploy/startup
migrations, and structured logging are in place.

## Read first

- [`docs/product-brief.html`](./docs/product-brief.html) — what we're building and why.
- [`todo.md`](./todo.md) — ordered build plan, phased.
- [`design.md`](./design.md) — design system, the source of truth for UI.
- [`CONTEXT.md`](./CONTEXT.md) — product language and domain glossary.
- [`docs/adr/`](./docs/adr/) — durable architecture and product decisions.

## Local development

See [`docs/setup/local.html`](./docs/setup/local.html).

Short version:

```bash
cp .env.example .env
# fill AUTH_SECRET=$(openssl rand -base64 32)
docker compose up -d
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev
```

Open <http://localhost:3000>.

## Wipe a Railway environment

The destructive dev wipe runs inside the deployed web/app service so Railway
private service URLs resolve normally. Use it only for a non-production
environment unless you intentionally want to wipe the linked resources.

```bash
railway login
railway link
# Select the workspace, project, environment, and web app service (web / @timeline/app).
railway ssh

pnpm dev:wipe
```

Set `NODE_ENV=development` and `ALLOW_DESTRUCTIVE_DEV_WIPE=wipe-dev` as Railway
variables on the non-production app service before running the command. If those
variables are not already present in the SSH shell, the full explicit form is:

```bash
NODE_ENV=development ALLOW_DESTRUCTIVE_DEV_WIPE=wipe-dev pnpm dev:wipe
```

`railway run` is not the same thing: it runs locally with Railway variables
injected. For this workflow, SSH into the app container and run the wipe command
there. Railway wipes require `ALLOW_DESTRUCTIVE_DEV_WIPE=wipe-dev` so a linked
production shell cannot be wiped by setting `NODE_ENV` alone.

## External service setup

These live behind their own walkthroughs because every account has its own
dashboard quirks:

- [`docs/setup/telegram.html`](./docs/setup/telegram.html) — Telegram bot (Phase 2+).
- [`docs/setup/slack.html`](./docs/setup/slack.html) — Slack conversational capture.
- [`docs/setup/openrouter.html`](./docs/setup/openrouter.html) — OpenRouter API
  (Phase 3+).
- [`docs/setup/postmark.html`](./docs/setup/postmark.html) — inbound email, outbound team invites, and support/contact mail.
- [`docs/setup/meeting-bots.html`](./docs/setup/meeting-bots.html) — Recall.ai meeting bots (Phase 10).
- [`docs/setup/integrations.html`](./docs/setup/integrations.html) — third-party integrations (Drive/Linear/GitHub), custom MCP servers, and Timeline-as-MCP-server (Phase 11).
- [`docs/setup/sentry.html`](./docs/setup/sentry.html) — error tracking.
- [`docs/setup/railway.html`](./docs/setup/railway.html) — staging + production
  deploys.

All env vars are documented inline in [`.env.example`](./.env.example).
