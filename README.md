# The Timeline

A multi-tenant team memory system. Capture work as it happens — voice notes,
text dumps, forwarded emails, Telegram messages, meeting transcripts — and
the system compiles a searchable, queryable history of who did what, talked
to whom, and decided what. Then ask a tool-using agent about it: every
claim it surfaces links back to the raw event it came from. No black-box
summaries.

Current state: through Phase 13.7. Web + Telegram + email + document drive +
meeting-bot capture (silent Recall.ai bot for Google Meet / Teams / Zoom),
voice transcription, extracted facts + entities, semantic search, agent
chat at `/app/chat`, workspace objects + boards + persisted chat sessions,
a team document drive at `/app/documents` (folders, versioned uploads,
chunked + embedded, cited inline with `[doc:<id>#v<n>:chunk:<id>]`), and
an internal calendar at `/app/calendar` with timeline-linked events,
private busy-block redaction, and calendar-aware agent tools. Third-party
integrations (Google Drive, Linear, GitHub native + custom MCP servers per
team or per user) live at `/app/team/integrations` — plus an outbound MCP
server at `/api/mcp/server` so external agents (Claude Desktop, Cursor,
etc.) can query this Timeline. `/app/timeline` now includes a dismissible
team onboarding tutorial for the core capture surfaces. Public help docs live
at `/help`, with a support/contact form that stores requests in Postgres,
sends them through Postmark, and uses Turnstile in production. Email/password
registration is also Turnstile-protected; signed-in expensive surfaces use
named Redis-backed rate-limit policies. Railway deployment, deploy-time
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

## External service setup

These live behind their own walkthroughs because every account has its own
dashboard quirks:

- [`docs/setup/telegram.html`](./docs/setup/telegram.html) — Telegram bot (Phase 2+).
- [`docs/setup/openrouter.html`](./docs/setup/openrouter.html) — OpenRouter API
  (Phase 3+).
- [`docs/setup/postmark.html`](./docs/setup/postmark.html) — inbound email, outbound team invites, and support/contact mail.
- [`docs/setup/meeting-bots.html`](./docs/setup/meeting-bots.html) — Recall.ai meeting bots (Phase 10).
- [`docs/setup/integrations.html`](./docs/setup/integrations.html) — third-party integrations (Drive/Linear/GitHub), custom MCP servers, and Timeline-as-MCP-server (Phase 11).
- [`docs/setup/sentry.html`](./docs/setup/sentry.html) — error tracking.
- [`docs/setup/railway.html`](./docs/setup/railway.html) — staging + production
  deploys.

All env vars are documented inline in [`.env.example`](./.env.example).
