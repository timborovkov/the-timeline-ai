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
