# Local development

The full local stack runs in Docker Compose; the app and workers run on the
host with hot reload.

## Prerequisites

- Node 20+
- pnpm 9+
- Docker Desktop (or compatible)

## First-time setup

```bash
cp .env.example .env
# Next.js dev server reads env from the app dir, so symlink:
ln -sf ../../.env apps/web/.env
```

Fill in at minimum:

- `AUTH_SECRET` — `openssl rand -base64 32`

The rest of the defaults already match `docker-compose.yml`.

Start infra:

```bash
docker compose up -d
docker compose ps           # all services should be "healthy"
```

This brings up Postgres (5432), Redis (6379), Qdrant (6333/6334), RustFS
(9000 S3 API, 9001 console). The `rustfs-init` container runs once to create
the required buckets.

Install deps and run migrations:

```bash
pnpm install
pnpm db:generate            # only if you changed schema
pnpm db:migrate
```

Run the app:

```bash
pnpm dev
```

Open <http://localhost:3000>.

## Phase 1 walkthrough

1. Sign up as user A — you land on `/app/timeline` with a default team.
2. Post a text note — appears in the timeline.
3. Go to **Team settings** → invite user B by email. Copy the invite URL shown
   (no real email is sent in Phase 1; Postmark wiring is Phase 7).
4. Open the invite URL in an incognito window, sign up as user B → user B is
   added to the team.
5. Post a note as user B; both users see it.
6. As user A, create a second team and switch via the team switcher → empty
   timeline (isolation works).

## Phase 3 walkthrough (voice notes)

1. `docker compose up -d` — verify `rustfs`, `redis`, and `postgres` are
   healthy. The `rustfs-init` container should report
   `RustFS buckets ready.`
2. `pnpm dev` runs both Next.js and the BullMQ worker (`apps/worker`) in
   watch mode.
3. Open `/app/timeline`, click **Record**, speak for a few seconds, click
   **Stop**, then **Send**. A new event lands with an audio player and a
   "Transcribing…" placeholder.
4. With `OPENROUTER_API_KEY` set in `.env`, the transcript replaces the
   placeholder within ~10s (page refresh required for now — no realtime
   pushdown yet). Without the key, the audio is still recorded and
   playable; the worker retries the transcribe job with exponential
   backoff until the key is provided and the worker restarts.
5. Telegram voice memos: send a voice note to the bot in a `/link`-ed DM
   (or bound group). The same flow runs: download → RustFS → enqueue →
   transcribe → backfill `content_text`.
6. Re-deliver the same Telegram webhook to confirm idempotency: the row's
   `tg_update_id` is unique, so the second insert is a no-op and no
   second transcribe job is enqueued.

## Useful commands

```bash
pnpm dev                              # next + worker, watch mode
pnpm lint && pnpm typecheck           # CI-equivalent checks
pnpm knip                             # dead code / unused deps
pnpm format                           # prettier write
pnpm db:studio                        # drizzle studio at localhost:4983
docker compose logs -f postgres       # tail a service
docker compose down -v                # nuke local data
```

## Resetting local data

```bash
docker compose down -v && docker compose up -d
pnpm db:migrate
```

## Troubleshooting

- **`DATABASE_URL is required`** — `.env` not picked up. Confirm the file
  exists at the repo root and Next.js was restarted.
- **Migrations stuck** — `docker compose logs postgres`; ensure container is
  healthy.
- **Port already in use** — another local Postgres/Redis on the same port.
  Stop it, or edit `docker-compose.yml` to remap.
