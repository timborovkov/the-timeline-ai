# Railway deployment

The Timeline runs as a set of Railway services in one project, all built from this monorepo.

## Services

| Service | Type | Dockerfile | Start command |
|---|---|---|---|
| `web` | App | `apps/web/Dockerfile` | `node apps/web/server.js` |
| `worker-transcribe` | App | `apps/worker/Dockerfile` | `node apps/worker/dist/workers/transcribe.js` |
| `worker-extract` | App | `apps/worker/Dockerfile` | `node apps/worker/dist/workers/extract.js` |
| `worker-embed` | App | `apps/worker/Dockerfile` | `node apps/worker/dist/workers/embed.js` |
| `postgres` | Plugin | — | (Railway-managed) |
| `redis` | Plugin | — | (Railway-managed) |
| `qdrant` | Custom | `infra/qdrant/Dockerfile` | (image-based, see below) |
| `rustfs` | Custom | `infra/rustfs/Dockerfile` | (image-based, see below) |

Railway provisions Postgres and Redis as managed plugins (one click). Qdrant and RustFS are deployed as custom services using their official Docker images.

## Initial setup

1. Create Railway project linked to this GitHub repo.
2. Add Postgres plugin. Note: connection string injected as `DATABASE_URL`.
3. Add Redis plugin. Connection string injected as `REDIS_URL`.
4. Add Qdrant service: New Service → Docker Image → `qdrant/qdrant:v1.12.4`. Add persistent volume mounted at `/qdrant/storage`. Set `QDRANT__SERVICE__API_KEY` to a strong random value.
5. Add RustFS service: New Service → Docker Image → `rustfs/rustfs:latest`. Add persistent volume mounted at `/data`. Set `RUSTFS_ROOT_USER` and `RUSTFS_ROOT_PASSWORD`. Bucket creation: run `mc` commands once after first deploy (see below).
6. Add `web` service from this repo, pointing at `apps/web/railway.json`.
7. Add `worker-*` services from this repo, all pointing at `apps/worker/railway.json` but with overridden start commands per worker type.

## Environment variables

Each app service needs these. Railway's service-to-service references (`${{ Postgres.DATABASE_URL }}`) keep things DRY.

```
DATABASE_URL=${{ Postgres.DATABASE_URL }}
REDIS_URL=${{ Redis.REDIS_URL }}
QDRANT_URL=${{ Qdrant.RAILWAY_PRIVATE_DOMAIN }}:6333
QDRANT_API_KEY=<from Qdrant service vars>
S3_ENDPOINT=http://${{ RustFS.RAILWAY_PRIVATE_DOMAIN }}:9000
S3_ACCESS_KEY_ID=<from RustFS service vars>
S3_SECRET_ACCESS_KEY=<from RustFS service vars>
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_BUCKET_AUDIO=timeline-audio
S3_BUCKET_ATTACHMENTS=timeline-attachments
S3_BUCKET_EXPORTS=timeline-exports
AUTH_SECRET=<32-byte random, generate per env>
AUTH_URL=https://<your-domain>
OPENROUTER_API_KEY=<openrouter key>
EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
TRANSCRIPTION_MODEL=openai/whisper-1
CHAT_MODEL_DEFAULT=anthropic/claude-sonnet-4.5
TELEGRAM_BOT_TOKEN=<botfather token>
TELEGRAM_WEBHOOK_SECRET=<32-byte random>
POSTMARK_SERVER_TOKEN=<postmark token>
POSTMARK_WEBHOOK_SECRET=<postmark secret>
INBOUND_EMAIL_DOMAIN=in.thetimeline.app
NODE_ENV=production
LOG_LEVEL=info
```

Use Railway's "shared variables" feature at the project level for anything used by 2+ services (everything except service-local overrides).

## Staging vs production

Two Railway environments on the same project: `staging` and `production`. Each gets its own Postgres, Redis, Qdrant, RustFS instances. Domains:

- `staging.thetimeline.app` → staging web
- `app.thetimeline.app` → production web

Branch deploys: `main` → production, `staging` → staging. Configure via Railway service settings.

## Volumes and persistence

Critical: Qdrant and RustFS **must** have persistent volumes attached. Railway services without volumes lose data on every deploy. Set these up at service creation time — adding volumes later is more painful.

| Service | Mount path | Sized for |
|---|---|---|
| Qdrant | `/qdrant/storage` | Start 10GB. Grows with vector count. |
| RustFS | `/data` | Start 50GB. Grows with audio/attachments. |

Postgres and Redis volumes are managed by Railway plugins automatically.

## RustFS bucket initialization

After first RustFS deploy, create buckets. Run once per environment:

```bash
# Connect to Railway service shell or run locally with port-forwarded RustFS
mc alias set timeline-prod http://<rustfs-host>:9000 <user> <password>
mc mb timeline-prod/timeline-audio
mc mb timeline-prod/timeline-attachments
mc mb timeline-prod/timeline-exports
mc version enable timeline-prod/timeline-audio
mc version enable timeline-prod/timeline-attachments
```

Versioning on audio and attachments is non-negotiable. Source-of-truth data; never overwrite blindly.

## Backups

Railway Postgres plugin includes automated daily backups. Confirm retention period in plugin settings.

RustFS has no built-in backup. Set up a scheduled service (Railway cron) running nightly:

```bash
rclone sync s3:timeline-audio backblaze-b2:timeline-backup-audio
rclone sync s3:timeline-attachments backblaze-b2:timeline-backup-attachments
```

Backblaze B2 or any cheap S3-compatible store works. Test restores quarterly.

Qdrant: nightly snapshot via Qdrant's snapshot API, uploaded to RustFS or B2. Vector data can technically be regenerated by re-embedding raw events, but a snapshot avoids that cost when the only failure is Qdrant data loss.

## Webhooks

Telegram and Postmark webhooks point at the `web` service public URL:

- Telegram: `https://app.thetimeline.app/api/telegram/webhook`
- Postmark: `https://app.thetimeline.app/api/email/inbound`

The Telegram webhook is registered automatically by the `web` service on
startup. The Next.js instrumentation hook at `apps/web/src/instrumentation.ts`
runs once per server process, reads `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, and `AUTH_URL`, then always calls `setWebhook`
(idempotent; required to push a rotated secret since `getWebhookInfo`
doesn't expose Telegram's stored secret) and verifies via `getWebhookInfo`.
Production-only (`NODE_ENV=production`); fire-and-forget so it never blocks
readiness. Missing env vars → it logs a skip line and continues.

To register manually (e.g. from a laptop pointed at staging):

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://app.thetimeline.app/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  -d "allowed_updates=[\"message\",\"edited_message\",\"callback_query\"]"
```

The `web` service verifies the `X-Telegram-Bot-Api-Secret-Token` header on every request and rejects anything that doesn't match.

## Deploy flow

1. Push to `main` (production) or `staging` branch.
2. Railway builds each service in parallel using its Dockerfile.
3. Migrations: run as a release-phase pre-deploy command on the `web` service. Already wired in `apps/web/railway.json`:
   ```json
   "preDeployCommand": ["node packages/db/dist/migrate.js"]
   ```
   The script (`packages/db/src/migrate.ts`) is built by turbo as a dep of the web build, and the entire `@timeline/db` package — including its `drizzle/*.sql` files and a self-contained `node_modules` with `postgres` + `drizzle-orm` — is copied into the runner image by the `db-deployer` stage in `apps/web/Dockerfile`. The command applies any new SQL files against `DATABASE_URL` and exits. Failure blocks the deploy.

   Worker services (`worker-transcribe`, `worker-extract`, `worker-embed`) deploy in parallel with `web` and don't run migrations themselves. They call `waitForMigrations()` from `@timeline/db` at startup, which polls `drizzle.__drizzle_migrations` until the row count matches the journal bundled with the worker image. Default timeout 5 minutes. This avoids crash-looping on every deploy that ships schema changes.

   **SSL note.** Inside a Railway project, `DATABASE_URL` resolves to the Postgres plugin's internal hostname and uses plain TCP. If you ever point this at the *external* Postgres proxy (e.g., to run `pnpm db:migrate` from your laptop against staging), append `?sslmode=require` to the URL — `postgres-js` follows the connection string, not an out-of-band env var.
4. Services restart with new image. Healthcheck on `web` (`/api/health`) must pass before traffic shifts.
5. Workers restart with same image — they share the codebase, just different entry points.

## Cost considerations

Railway charges per resource (CPU, RAM, network egress, volume size). At small scale this stack is roughly:

- `web` service: small instance, mostly idle outside webhook spikes
- 3 workers: small each, most cost is during processing bursts
- Postgres: small instance + storage
- Redis: tiny
- Qdrant: moderate RAM (vectors live in memory)
- RustFS: minimal compute, most cost is volume size

Watch volume sizing — Railway storage is more expensive than the compute. For prod beyond a few teams, consider moving RustFS data to a cheaper external S3-compatible store (Backblaze B2, Cloudflare R2) and using RustFS only as a self-host fallback or dev convenience.
