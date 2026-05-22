# @timeline/web

The Next.js 15 app — capture surfaces, timeline UI, entity pages, agent chat, auth, server actions, and the inbound webhook routes for Telegram and Postmark.

## Why it exists

Single user-facing surface. All UI, API routes, and server actions live here. Backend logic that other workspace packages need (DB access, LLM calls, queue dispatch) is delegated to [`@timeline/shared`](../../packages/shared/README.md) and [`@timeline/db`](../../packages/db/README.md) — this package stays focused on the request/response layer.

## How to use

From the repo root:

```bash
pnpm dev          # starts Next.js + worker in watch mode
pnpm --filter @timeline/web build
pnpm --filter @timeline/web typecheck
```

Local dev requires the Docker Compose stack from the repo root (`docker compose up -d`).

## Where it fits

- Architecture and service layout: [docs/railway.html](../../docs/railway.html).
- Local walkthrough: [docs/setup/local.html](../../docs/setup/local.html).
- Product context: [docs/product-brief.html](../../docs/product-brief.html).
