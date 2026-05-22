# The Timeline

A multi-tenant team memory system. Capture work as it happens — voice notes,
text dumps, forwarded emails, Telegram messages — and the system compiles a
searchable, queryable history of who did what, talked to whom, and decided
what. Then ask a tool-using agent about it: every claim it surfaces links
back to the raw event it came from. No black-box summaries.

Current state: through Phase 7. Web + Telegram + email capture, voice
transcription, extracted facts + entities, semantic search, and agent chat at
`/app/chat` all working end-to-end. Railway deployment, deploy-time migrations,
and structured logging are in place.

## Read first

- [`docs/product-brief.html`](./docs/product-brief.html) — what we're building and why.
- [`todo.md`](./todo.md) — ordered build plan, phased.
- [`design.md`](./design.md) — design system, the source of truth for UI.

## Local development

See [`docs/setup/local.md`](./docs/setup/local.md).

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

- [`docs/setup/telegram.md`](./docs/setup/telegram.md) — Telegram bot (Phase 2+).
- [`docs/setup/openrouter.md`](./docs/setup/openrouter.md) — OpenRouter API
  (Phase 3+).
- [`docs/setup/postmark.md`](./docs/setup/postmark.md) — inbound email (Phase 7).
- [`docs/setup/sentry.md`](./docs/setup/sentry.md) — error tracking.
- [`docs/setup/railway.md`](./docs/setup/railway.md) — staging + production
  deploys.

All env vars are documented inline in [`.env.example`](./.env.example).
