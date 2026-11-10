# Railway deployment

How the Timeline's web + worker + plugin + custom services are arranged on Railway, and what every service needs to come up clean.

The Timeline runs as a set of Railway services in one project, all built from this monorepo.

Polar billing setup and required variables are documented in [Polar setup](setup/polar.md). Campaigns are managed in Polar; no global discount variables are required. Per-team assignments remain in Timeline's admin panel. Cleanup of obsolete deployment variables is a separate operator task.

<span id="services"></span>

## Services

| Service                         | Type              | Build config                                    | Start command                                                                                                   |
|---------------------------------|-------------------|-------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `web`                           | App               | `apps/web/railway.json` (Dockerfile)            | `env NODE_ENV=production bun --bun --no-env-file apps/web/start.mjs`                                            |
| `worker`                        | App               | `apps/worker/railway.json` (Dockerfile)         | `env NODE_ENV=production bun --bun --no-env-file apps/worker/dist/index.js`                                     |
| `document-extract-orchestrator` | App               | `apps/worker/railway.extract.json` (Dockerfile) | `env NODE_ENV=production WORKER_MODE=document-extract bun --bun --no-env-file apps/worker/dist/extract-main.js` |
| `postgres`                      | Database template | —                                               | (customer-operated service)                                                                                     |
| `redis`                         | Database template | —                                               | (customer-operated service)                                                                                     |
| `qdrant`                        | Docker image      | `qdrant/qdrant:v1.20.0`                         | (configured in Railway)                                                                                         |
| `rustfs`                        | Docker image      | `rustfs/rustfs:latest`                          | (configured in Railway)                                                                                         |

Railway provisions PostgreSQL and Redis from database templates. They remain customer-operated services rather than managed databases. Qdrant and RustFS are deployed as custom services using their official Docker images. Portable app Dockerfiles live under `docker/` for local/container-platform builds; keep the repo root free of an app `Dockerfile`; each service selects its image through `railway.json`.

<span id="initial-setup"></span>



## Provisioning

1. Create a Railway project and isolated production/staging environments as needed. Connect the repository; use the protected `production` branch for releases and verify each service setting.
2. Add PostgreSQL and Redis templates. Supply their private connection URLs to the service variables below; these services remain customer-operated.
3. Add Qdrant and RustFS with persistent volumes. Create RustFS buckets using the `rustfs-init` procedure in `docker-compose.yml` before starting ingestion. Keep credentials scoped to the services that need them.
4. Add web, worker and document-extract-orchestrator with the checked-in `railway.json` config paths. Keep repo-root Dockerfile overrides disabled; each service selects its image.
5. Configure variables below, including the **build-time** public origin. Apply migrations using the existing advisory-locked runner. Verify health, worker readiness and a synthetic end-to-end capture before opening traffic.
6. Configure [scheduled job reconciliation](runbooks/job-recovery.md), backups, alerts and an isolated restore rehearsal. A successful deployment is not proof of a recoverable backup.

## Dashboard overrides

This repository does not change the Railway project. After merging, an operator must confirm each app service uses the checked-in config rather than leftover Node/Railpack settings. Repeat for `web`, `worker`, and `document-extract-orchestrator`:

1.  **Settings → Config-as-code** — custom config path `apps/web/railway.json`, `apps/worker/railway.json`, or `apps/worker/railway.extract.json`.
2.  **Settings → Build** — builder Dockerfile. Do not use Railpack or Nixpacks. Clear custom build-command overrides such as `pnpm install`, `npm run build`, or `next build`.
3.  **Settings → Deploy** — leave Start Command empty so `railway.json` supplies `env NODE_ENV=production bun --bun --no-env-file …`. If a dashboard override must exist, it has to match that command, including `--bun`. Remove `node`, `next start`, and `pnpm start` overrides.
4.  **Variables** — delete `NIXPACKS_NODE_VERSION`, `RAILPACK_NODE_VERSION`, and `NODE_VERSION` if present. Keep `NODE_ENV=production`; that is the app environment, not the JavaScript runtime. Do not add a Node toolchain variable to force v26.
5.  **Healthcheck** — web stays `/api/health` (already in `apps/web/railway.json`). After deploy the JSON body includes `"runtime":"bun"`. Worker and extract have no HTTP healthcheck; Railway restart policy remains on-failure.
6.  **Sentry** — a new server event's runtime context should be `bun` `1.4.4`, not Node `26.3.0`. Browser events stay on the browser runtime.

<span id="environment-variables"></span>

## Environment variables

Shared variables for `web` and `worker` (not the credential-thin `document-extract-orchestrator` service). Railway's service-to-service references (`${{ Postgres.DATABASE_URL }}`) keep things DRY.

    DATABASE_URL=${{ Postgres.DATABASE_URL }}
    REDIS_URL=${{ Redis.REDIS_URL }}
    QDRANT_URL=http://${{ Qdrant.RAILWAY_PRIVATE_DOMAIN }}:6333
    QDRANT_API_KEY=<from Qdrant service vars>
    QDRANT_COLLECTION=events
    QDRANT_QUANTIZATION=scalar
    QDRANT_QUANTIZATION_RESCORE=true
    QDRANT_QUANTIZATION_OVERSAMPLING=2
    S3_ENDPOINT=http://${{ RustFS.RAILWAY_PRIVATE_DOMAIN }}:9000
    S3_PUBLIC_ENDPOINT=https://<rustfs-public-domain>
    S3_ACCESS_KEY_ID=<from RustFS service vars>
    S3_SECRET_ACCESS_KEY=<from RustFS service vars>
    S3_REGION=us-east-1
    S3_FORCE_PATH_STYLE=true
    S3_BUCKET_AUDIO=timeline-audio
    S3_BUCKET_ATTACHMENTS=timeline-attachments
    S3_BUCKET_DOCUMENTS=timeline-documents
    S3_BUCKET_EXPORTS=timeline-exports
    AUTH_SECRET=<32-byte random, generate per env>
    AUTH_URL=https://thetimeline.cc
    OPENROUTER_API_KEY=<openrouter key>
    OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
    OPENROUTER_GUARDRAIL_ID=<official guardrail id>
    OPENROUTER_PRIVACY_POLICY_ATTESTATION=<generated orpa1 token>
    CROSS_SOURCE_EVIDENCE_MODE=off
    LANGSMITH_TRACING=false
    TELEGRAM_BOT_TOKEN=<botfather token>
    TELEGRAM_WEBHOOK_SECRET=<32-byte random>
    RESEND_API_KEY=<resend api key>
    TRANSACTIONAL_EMAIL_FROM="The Timeline <noreply@thetimeline.cc>"
    RESEND_WEBHOOK_SECRET=<resend webhook signing secret>
    SUPPORT_EMAIL=contact@thetimeline.cc
    INBOUND_EMAIL_DOMAIN=in.thetimeline.cc
    RECALL_API_KEY=<recall api key>
    RECALL_BASE_URL=https://us-west-2.recall.ai/api/v1
    RECALL_WORKSPACE_VERIFICATION_SECRET=<exact provider-issued workspace whsec_ secret; at least 24 decoded bytes>
    RECALL_STATUS_WEBHOOK_SECRET=<legacy dashboard status whsec_ secret, if required>
    RECALL_TRANSCRIPT_WEBHOOK_URL=https://thetimeline.cc/api/webhooks/recall/transcript
    RECALL_RETENTION=1
    RECALL_BOT_DISPLAY_NAME=Timeline
    TURNSTILE_SITE_KEY=<cloudflare turnstile site key>
    TURNSTILE_SECRET_KEY=<cloudflare turnstile secret key>
    POSTHOG_PROJECT_KEY=<posthog server project key>
    POSTHOG_HOST=https://eu.i.posthog.com
    ANALYTICS_PSEUDONYMIZATION_KEY=<independent high-entropy secret>
    NEXT_PUBLIC_POSTHOG_KEY=
    NEXT_PUBLIC_POSTHOG_HOST=https://m.thetimeline.cc
    NEXT_PUBLIC_POSTHOG_UI_HOST=https://eu.posthog.com
    SENTRY_DSN=<sentry server/worker dsn>
    NEXT_PUBLIC_SENTRY_DSN=<sentry browser dsn>
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0
    NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE=0
    SENTRY_ENVIRONMENT=production
    SENTRY_TRACES_SAMPLE_RATE=0
    SENTRY_PROFILES_SAMPLE_RATE=0
    SENTRY_AUTH_TOKEN=<sentry source map upload token>
    SENTRY_ORG=irmin-dw
    SENTRY_PROJECT=the-timeline-ai
    SENTRY_RELEASE=<deployed git sha, optional>
    GOOGLE_CLIENT_ID=<google oauth client id; shared by sign-in and Drive>
    GOOGLE_CLIENT_SECRET=<google oauth client secret>
    GOOGLE_DRIVE_WEBHOOK_SECRET=<google drive webhook hmac secret>
    LINEAR_CLIENT_ID=<linear oauth app client id>
    LINEAR_CLIENT_SECRET=<linear oauth app client secret>
    LINEAR_WEBHOOK_SECRET=<linear webhook signing secret>
    SLACK_CLIENT_ID=<slack app client id>
    SLACK_CLIENT_SECRET=<slack app client secret>
    SLACK_SIGNING_SECRET=<slack signing secret>
    MONDAY_CLIENT_ID=<monday oauth app client id>
    MONDAY_CLIENT_SECRET=<monday oauth app client secret>
    MONDAY_WEBHOOK_SECRET=<monday webhook URL token>
    GITHUB_APP_CLIENT_ID=<github oauth/app client id>
    GITHUB_APP_CLIENT_SECRET=<github oauth/app client secret>
    GITHUB_APP_ID=<github app numeric id>
    GITHUB_APP_PRIVATE_KEY=<github app private key pem, use \n escapes for single-line secrets>
    GITHUB_WEBHOOK_SECRET=<github webhook hmac secret>
    SENTRY_INTEGRATION_CLIENT_ID=<sentry oauth app client id>
    SENTRY_INTEGRATION_CLIENT_SECRET=<sentry oauth app client secret>
    DOCUMENT_EXTRACT_ENABLED=false
    NODE_ENV=production
    TIMELINE_DEPLOYMENT_MODE=hosted
    LOG_LEVEL=info

In hosted production, startup validation accepts only Recall's documented HTTPS regional `/api/v1` hosts. The transcript webhook must use the same HTTPS origin as `AUTH_URL`, the exact `/api/webhooks/recall/transcript` path, and no query or fragment. Alternate Recall proxies or webhook ingress remain explicit self-managed/development choices.

Keep `ANALYTICS_PSEUDONYMIZATION_KEY` secret and server-only. Leave `NEXT_PUBLIC_POSTHOG_KEY` empty until the consent-gated public-browser path and PostHog account have been reviewed, then pass it as a web Docker build arg together with `NEXT_PUBLIC_POSTHOG_HOST` and `NEXT_PUBLIC_POSTHOG_UI_HOST`. None of the PostHog variables belong on the credential-thin `document-extract-orchestrator` service.

`CROSS_SOURCE_EVIDENCE_MODE` is a worker rollout switch. Keep production at `off` until generic ingest webhook shadow gates pass. Other proposal adapters do not honor this switch yet. Changing it requires a worker restart or redeploy.

Copy `TELEGRAM_BOT_TOKEN` to both `web` and `worker`. The web service authenticates the webhook and keeps initial typing active until the `conversation-agent` queue worker claims the turn. The worker then refreshes typing and delivers durable Telegram answers after the request has returned. Slack worker delivery needs no plaintext bot-token variable because it decrypts the installed workspace token from Postgres with `SECRETS_ENCRYPTION_KEY`. The `chat-delivery` worker resumes encrypted, quota-delayed command responses and never replays ambiguous writes.

`document-extract-orchestrator` service variables (keep this set minimal — ADR 0013):

    WORKER_MODE=document-extract
    DOCUMENT_EXTRACT_ENABLED=true
    DAYTONA_API_KEY=<daytona api key>
    DAYTONA_API_URL=https://app.daytona.io/api
    DAYTONA_TARGET=us
    DAYTONA_SNAPSHOT=auto
    DAYTONA_SNAPSHOT_ENSURE=true
    DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS=500
    DOCUMENT_EXTRACT_MAX_VISION_PAGES=20
    DATABASE_URL=${{ Postgres.DATABASE_URL }}
    REDIS_URL=${{ Redis.REDIS_URL }}
    OPENROUTER_API_KEY=<openrouter key>
    OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
    OPENROUTER_GUARDRAIL_ID=<official guardrail id>
    OPENROUTER_PRIVACY_POLICY_ATTESTATION=<generated orpa1 token>
    S3_ENDPOINT=http://${{ RustFS.RAILWAY_PRIVATE_DOMAIN }}:9000
    S3_ACCESS_KEY_ID=<from RustFS service vars>
    S3_SECRET_ACCESS_KEY=<from RustFS service vars>
    S3_REGION=us-east-1
    S3_FORCE_PATH_STYLE=true
    S3_BUCKET_DOCUMENTS=timeline-documents
    NODE_ENV=production
    TIMELINE_DEPLOYMENT_MODE=hosted
    LOG_LEVEL=info
    BILLING_CHARGES_ENABLED=false

`AUTH_URL` is also the canonical public origin. Requests that arrive through `www.thetimeline.cc` or the default `*.up.railway.app` host are redirected to this origin before Auth.js runs.

The production web app trusts only `X-Real-IP` for security and rate-limit buckets. Railway's public proxy must be the only ingress and must overwrite or remove any caller-supplied `X-Real-IP`. Do not expose an alternate path that forwards a client-provided value unchanged. When the trusted header is missing or invalid, requests deliberately share the `unknown` bucket instead of falling back to spoofable forwarding headers.

Self-hosted production must enforce the same boundary at a trusted reverse proxy: strip the incoming `X-Real-IP`, validate the remote client address, and set the header before forwarding to Timeline. `CF-Connecting-IP` and `X-Forwarded-For` are development-only fallbacks.

`OPENAI_APPS_CHALLENGE_TOKEN` is optional and belongs on the web service only. Set it to the exact plain-text token supplied by OpenAI's app-submission portal when domain verification is requested; it is returned verbatim from `/.well-known/openai-apps-challenge`. It is not an OAuth credential and is not required for normal MCP operation. Leave it unset outside that portal flow, or remove it after verification when the portal no longer requires it.

Railway uses the checked-in Dockerfiles for web and worker deploys. They accept the Sentry and public PostHog build/runtime variables above; source-map upload requires those values at build time. The web image also accepts `AUTH_URL` at build time (default `https://thetimeline.cc`) for prerendered public metadata, JSON-LD, and the cached `sitemap.xml`. For a non-canonical origin, override the Docker build argument `AUTH_URL` to match the web service's runtime origin and rebuild and redeploy the image. Changing only runtime `AUTH_URL` does not update those generated URLs. Runtime `AUTH_URL` still controls Auth.js, redirects, and request-time `robots.txt`. `SUPPORT_EMAIL`, Turnstile keys, and `LEGAL_PUBLICATION_READY` stay on the running web service; prerendered pages read the public subset from `/api/public/runtime`, and `/terms` is generated per request.

App runtimes use Bun `1.4.4`, pinned in `.bun-version`, `package.json`, and `oven/bun:1.4.4-debian` Docker images. Start and pre-deploy commands pass `bun --bun` so Next's standalone `server.js` Node shebang cannot exec Node. Bun 1.4's Node compatibility version is `26.3.0`; Sentry's Node SDK would otherwise report that as the runtime. Server `beforeSend` stamps `contexts.runtime` to `bun`/`1.4.4`, and `GET /api/health` includes `"runtime":"bun"`. Railway builds the repository Dockerfiles. Remove old Railpack and Node command overrides before the coordinated release — see [dashboard overrides](#dashboard-overrides).

Keep `NODE_ENV` set to `production` in both staging and production Railway environments. Use Railway's environment name and `SENTRY_ENVIRONMENT` for labels such as `staging`; the framework and the app env schema only accept `development`, `test`, or `production`. Set `TIMELINE_DEPLOYMENT_MODE=hosted` on every Timeline-operated service; only a separately licensed and operated deployment may select `self-managed` and assume responsibility for different provider-retention choices.

Production env validation rejects `LANGSMITH_TRACING=true` because rich traces can include private prompt and output content. Use LangSmith only in controlled development or evaluation environments with synthetic or explicitly approved data. The hosted production OpenRouter key must be restricted to the code-owned model catalog with applicable ZDR guardrails for every `zdr_required` role. Hosted production also requires `OPENROUTER_GUARDRAIL_ID` and the generated `OPENROUTER_PRIVACY_POLICY_ATTESTATION`. The token invalidates on inference-key, guardrail, catalog, or policy drift; it does not create or prove the provider settings. Verify the actual key assignment, `allowed_models`, and guardrail settings with a separate operator-only management-key deployment check and dated evidence. Never store the management key in web, worker, or document-extract runtime variables. The voice-transcription role remains the separately disclosed retained, no-training quality exception.

Use Railway's "shared variables" feature at the project level for anything used by 2+ services (everything except service-local overrides).

**About `S3_PUBLIC_ENDPOINT`:** the browser uploads voice notes, document files, and fetches audio for playback directly against this URL, so it must be publicly reachable over HTTPS. Expose the RustFS service via a Railway public domain (Settings → Networking → Generate Domain) and set `S3_PUBLIC_ENDPOINT` to that URL. `S3_ENDPOINT` stays on the private network — workers and server-side code keep using it.

**About `TURNSTILE_*`:** Turnstile is used only on anonymous abuse surfaces: email/password registration and the public support/contact form. The web Docker build does not receive these variables, so set them on the running `web` service. `/help/support` is statically prerendered and loads `TURNSTILE_SITE_KEY` at request time; sign-up is dynamic and reads the runtime env directly. OAuth signup and signed-in product flows rely on Redis-backed rate limits, team permissions, and existing quota checks. In production, leave neither key blank; the server action rejects missing or invalid Turnstile tokens.

<span id="staging-vs-production"></span>

## Staging vs production

The Git branch `main` is for development; `production` is the protected release branch. Verify the deployed source branch for web, worker and extractor before release. The intended release branch is `production`; a repository policy does not change Railway settings.

If a separate staging environment is introduced later, give it isolated Postgres, Redis, Qdrant, RustFS, and provider credentials. Verify its configured branch, domain and isolation before use; this guide does not assert whether a staging deployment currently exists.

<span id="volumes-and-persistence"></span>

## Volumes and persistence

Critical: Qdrant and RustFS **must** have persistent volumes attached. Railway services without volumes lose data on every deploy. Set these up at service creation time — adding volumes later is more painful.

| Service | Mount path        | Sized for                                 |
|---------|-------------------|-------------------------------------------|
| Qdrant  | `/qdrant/storage` | Start 10GB. Grows with vector count.      |
| RustFS  | `/data`           | Start 50GB. Grows with audio/attachments. |

PostgreSQL and Redis are Railway database templates rather than managed database services. Timeline remains responsible for their operation, persistence, backup configuration, and restore verification. Record the deployed volume and backup settings for each environment.

<span id="rustfs-bucket-initialization"></span>

## RustFS bucket initialization

After first RustFS deploy, create buckets. Run once per environment:

    rc alias set timeline-prod http://<rustfs-host>:9000 <access-key> <secret-key>
    rc bucket create --ignore-existing timeline-prod/timeline-audio
    rc bucket create --ignore-existing timeline-prod/timeline-attachments
    rc bucket create --ignore-existing timeline-prod/timeline-exports
    rc bucket create --ignore-existing timeline-prod/timeline-documents
    rc bucket version enable timeline-prod/timeline-audio
    rc bucket version enable timeline-prod/timeline-attachments
    rc bucket version enable timeline-prod/timeline-documents
    rc bucket version enable timeline-prod/timeline-exports

Versioning on audio, attachments, and documents is non-negotiable. Source-of-truth data; never overwrite blindly.

<span id="backups"></span>

## Backups

Do not assume a PostgreSQL backup exists from the template alone. Enable and inventory the production backup mechanism, record its schedule and retention, and prove a restore in an isolated environment before making a durability claim. The current repository cannot verify the deployed Railway dashboard state.

RustFS backup is an operating task, not a shipped repository guarantee. After choosing the secondary store, set up a scheduled service (Railway cron), for example:

    rclone sync s3:timeline-audio backblaze-b2:timeline-backup-audio
    rclone sync s3:timeline-attachments backblaze-b2:timeline-backup-attachments
    rclone sync s3:timeline-documents backblaze-b2:timeline-backup-documents
    rclone sync s3:timeline-exports backblaze-b2:timeline-backup-exports

Backblaze B2 or any cheap S3-compatible store works. Test restores quarterly.

Qdrant snapshots are also an operating task. Add a nightly job through Qdrant's snapshot API and upload the result to an independently protected store such as B2. Vector data can be regenerated by re-embedding source records, but a tested snapshot avoids that cost when the only failure is Qdrant data loss.

<span id="webhooks"></span>

## Webhooks

Telegram, Slack, Resend, and team-managed ingest webhooks point at the `web` service public URL:

- Telegram: `https://thetimeline.cc/api/telegram/webhook`
- Slack Events API: `https://thetimeline.cc/api/slack/events`
- Slack slash commands: `https://thetimeline.cc/api/slack/commands`
- Slack Interactivity: `https://thetimeline.cc/api/slack/interactions`
- Resend: `https://thetimeline.cc/api/email/inbound`
- Google Drive: `https://thetimeline.cc/api/webhooks/google-drive`
- Linear: `https://thetimeline.cc/api/webhooks/linear`
- GitHub App: `https://thetimeline.cc/api/webhooks/github`
- Monday.com: `https://thetimeline.cc/api/webhooks/monday?token=<MONDAY_WEBHOOK_SECRET>`
- Sentry native integration: `https://thetimeline.cc/api/webhooks/sentry`
- Ingest webhooks: `https://thetimeline.cc/api/webhooks/ingest` with `Authorization: Bearer tli_...`, or the secret URL copied from `/app/connections/sources`.

Native integration OAuth callbacks also land on the web service, including `/api/auth/callback/google` (sign-in; `openid email profile` only), `/api/integrations/google_drive/callback`, `/api/integrations/linear/callback`, `/api/integrations/github/callback`, `/api/integrations/monday/callback`, `/api/integrations/slack/callback`, and `/api/integrations/sentry/callback`.

The Telegram webhook and `/` command menu are registered automatically by the `web` service on startup. The Next.js instrumentation hook at `apps/web/src/instrumentation.ts` runs once per server process. If `TELEGRAM_BOT_TOKEN` is set, it calls `setMyCommands` for the default, private-chat, and group-chat scopes so Telegram clients can list bot commands when someone types `/`. In production it also reads `TELEGRAM_WEBHOOK_SECRET` and `AUTH_URL`, then always calls `setWebhook` (idempotent; required to push a rotated secret since `getWebhookInfo` doesn't expose Telegram's stored secret) and verifies via `getWebhookInfo`. Both calls are fire-and-forget so they never block readiness. Missing env vars → it logs a skip line and continues.

To register manually (e.g. from a laptop pointed at staging):

    curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
      -d "url=https://thetimeline.cc/api/telegram/webhook" \
      -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
      -d "allowed_updates=[\"message\",\"edited_message\",\"callback_query\"]"

The `web` service verifies the `X-Telegram-Bot-Api-Secret-Token` header on every request and rejects anything that doesn't match.

Ingest webhook credentials are managed in the dashboard and stored as database hashes, so Railway does not need a per-source env var. Rotate or disable them from Connections; new deliveries fail immediately after revocation.

<span id="deploy-flow"></span>

## Deploy flow

1.  Merge development PRs into `main`, then open a release PR from `main` to `production`. Follow the [branch and release CI policy in AGENTS.md](testing/README.md#branch-and-release-ci) for required checks and branch protections, and its [validation policy](testing/README.md#validation-policy) for scoped local work.

2.  Once all three Railway app services follow `production`, merging the release PR triggers deployment. Until the operator switches those sources, Railway continues following its configured branch. The Daytona snapshot publisher runs on matching production changes or manual dispatch.

3.  Railway builds each app service using the Dockerfile selected by its `railway.json`. The runner contains production dependencies and compiled workspace packages; worker maintenance scripts run from `apps/worker/dist/scripts`. The web build and deploy images run with `NODE_ENV=production`; deploy commands use `bun` directly; package-manager shims are not required there. The `@timeline/web` build also runs `apps/web/scripts/prepare-standalone.mjs`, which copies `.next/static`, `public`, and the shared `dist/messaging/email-templates` runtime assets into both the standalone root and app subtree so Railway serves the hashed CSS, JavaScript chunks, connector icons, self-hosted fonts, and outbound email templates.

4.  Migrations: run as a release-phase pre-deploy command on both app services. They also run from the web start wrapper and worker startup under the same Postgres advisory lock, so a web and worker deploy can overlap safely and each service can recover from an independent restart. The pre-deploy command is already wired in `apps/web/railway.json` and `apps/worker/railway.json`:

        "preDeployCommand": [
          "env NODE_ENV=production bun --bun --no-env-file packages/db/dist/migrate.js"
        ]

    The script (`packages/db/src/migrate.ts`) is built before deploy, and the Docker runtime keeps the compiled packages and production dependencies available to the release command. The same migrate entrypoint is called by `apps/web/start.mjs` before `apps/web/server.js` and by `apps/worker/src/index.ts` before queues start consuming jobs. It applies any new SQL files against `DATABASE_URL` and exits; failure blocks deploy or startup. Startup migrations make dev resets and service-only redeploys converge on the next app boot even when the other service is not redeployed.

    The worker still calls `waitForMigrations()` from `@timeline/db/wait-for-migrations` after the migrator returns. That readiness check polls `drizzle.__drizzle_migrations` until the row count matches the journal bundled with the worker image. Default timeout 5 minutes. This catches skipped release commands or mismatched images before background queues start using a schema they do not have.

    **Postgres pool guardrails.** Shared clients set `application_name` labels (`timeline-web`, `timeline-worker`, `timeline-migrator`, `timeline-migration-waiter`, `timeline-reset`, or `timeline-script`) so `pg_stat_activity` shows which service owns a lock. App pools use a 10 second `lock_timeout`, 120 second `statement_timeout`, and 60 second `idle_in_transaction_session_timeout`; migration sessions keep the short lock wait but get a 10 minute statement budget. A deploy that is blocked behind an old lock should fail clearly instead of waiting indefinitely.

    **SSL note.** Inside a Railway project, `DATABASE_URL` resolves to the PostgreSQL service's internal hostname and uses plain TCP. If you ever point this at the *external* Postgres proxy (e.g., to run `bun run db:migrate` from your laptop against staging), append `?sslmode=require` to the URL — postgres.js 4 still follows the connection string, not an out-of-band env var. `channel_binding` defaults to `prefer` and only applies over TLS, so internal Railway connections are unchanged.

5.  **Legal-version release warning.** Changing the current Terms or Privacy version intentionally makes every existing human session stale, but production first defaults `LEGAL_PUBLICATION_READY=false`. That default withholds binding Terms, legal acceptance, and first-time account signup while preserving existing users' signed-in dashboard access. Set it to true after approving the legal text for publication. Then signed-in app and invite routes redirect to `/legal/accept`; human product APIs return a no-store `428 legal_acceptance_required` response until the person accepts. Before a version bump, publish and review both documents, notify support and API consumers, and confirm the immutable acceptance-history migration is deployed. Service webhooks, cron jobs, health checks, inbound email, calendar feeds, and bearer-authenticated outbound MCP remain exempt because they cannot complete human clickwrap.

6.  Services restart with new image. Healthcheck on `web` (`/api/health`) must pass before traffic shifts.

7.  Workers restart with same image — they share the codebase, just different entry points.

<span id="cost-considerations"></span>

## Cost considerations

Railway charges per resource (CPU, RAM, network egress, volume size). At small scale this stack is roughly:

- `web` service: small instance, mostly idle outside webhook spikes
- `worker` service: small instance, most cost is during processing bursts
- Postgres: small instance + storage
- Redis: tiny
- Qdrant: size from current measured load, including maintenance and filesystem cache. Do not reuse historical limits without verification.
- RustFS: minimal compute, most cost is volume size

<span id="resource-caps"></span>

### CPU and memory caps

Set explicit limits for every service from measured startup, ingestion and search peaks. Include filesystem cache and maintenance headroom. [Historical samples](evidence/railway-capacity-2026-11.md) are not current configuration.


<span id="qdrant-serverless"></span>

### Qdrant Serverless rollout

Deploy the shared-client recovery changes to web and worker before enabling Serverless on Qdrant. Reads tolerate transient connection and gateway failures within a 30-second Qdrant budget; embedding/model time is separate. Writes first check availability, then execute once with a 120-second timeout (ten minutes for snapshots). Ambiguous writes are not replayed by the transport; existing embedding queue retries remain in place.

Set `QDRANT__TELEMETRY_DISABLED=true` on the Qdrant service, enable Serverless, and redeploy it: changing the setting alone does not update a running container. Retain private networking, the persistent storage mount, the active collection, and the 3 GB cap. Observe sleep through Railway rather than polling Qdrant. Verify a real private-network search and a separate isolated embedding cycle after sleep. Necessary integration and recovery work may prevent sleeping; do not disable it without reviewing its purpose. Volume charges remain while asleep.

If first-request recovery fails or exceeds the budget, disable Serverless and redeploy Qdrant. Keep the resilience code. Record deployment and cold-start acceptance results in the release PR; this runbook alone is not proof that Serverless has been enabled.

<span id="qdrant-memory"></span>

### Qdrant memory

Use on-disk vectors/payloads with the configured quantization and monitor cache growth. Preserve snapshots and rollback coverage during collection migration. Follow [vector maintenance](runbooks/reindex.md).
