# Railway deployment setup

The repo ships ready-to-deploy `railway.json` files for `web` and `worker`.
Provisioning the Railway project is a manual step.

## 1. Project + environments

1. Create a new Railway project.
2. In **Settings → Environments**, create `staging` and `production`.
3. **Settings → Git** — connect the repo. Branch deploys:
   - `main` → `production`
   - `staging` → `staging`

## 2. Managed plugins

Add via **+ New → Database**:

- **Postgres** — Railway plugin. Copy `DATABASE_URL` from the plugin's
  **Connect** tab into the project's shared variables.
- **Redis** — Railway plugin. Copy `REDIS_URL` likewise.

## 3. Custom services

Add via **+ New → Empty Service** (or **Deploy from Docker Image**):

- **qdrant** — image `qdrant/qdrant:v1.12.4`, attach a persistent volume at
  `/qdrant/storage`. Expose port `6333`. Set `QDRANT__SERVICE__API_KEY` to a
  random value; copy to shared `QDRANT_API_KEY`. Set shared `QDRANT_URL` to
  the service's private URL.
- **rustfs** — image `rustfs/rustfs:latest`, attach a persistent volume at
  `/data`. Set `RUSTFS_ROOT_USER`/`RUSTFS_ROOT_PASSWORD`. Map env to
  `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` in shared variables.

Run a one-shot `minio/mc` job to create buckets (same commands as
`rustfs-init` in `docker-compose.yml`).

## 4. App services

Add `web` and `worker-*` services pointing at this repo. Each uses the
matching `railway.json` (`apps/web/railway.json`, `apps/worker/railway.json`).

For workers, override the start command per worker type in service settings:

- `worker-transcribe` → `node dist/workers/transcribe.js`
- `worker-extract` → `node dist/workers/extract.js`
- `worker-embed` → `node dist/workers/embed.js`

These worker entry points land in Phase 3+. For Phase 1, only the `web`
service is deployed.

## 5. Shared variables

In **Settings → Variables**, set everything from `.env.example` that isn't a
local-only default. Mark provider tokens (OpenRouter, Telegram, Postmark,
Sentry) as **secret**.

## 6. Healthchecks

Already configured in `apps/web/railway.json` → `/api/health`. Railway will
restart the service on failure.
