# Local development

Bring up the full Timeline stack on your machine with Docker Compose for infra and `bun run dev` for app + worker hot reload.

The full local stack runs in Docker Compose; the app and workers run on the host with hot reload.

<span id="prerequisites"></span>

## Prerequisites

- Bun 1.4.4 (see `.bun-version`)
- Docker Desktop (or compatible)

<span id="first-time-setup"></span>

## First-time setup

    curl -fsSL https://bun.com/install | bash -s "bun-v1.4.4"

Open a new shell after installing Bun. For a checkout previously installed with another package manager, remove generated root and workspace `node_modules` directories before running `bun run deps --frozen-lockfile`. Preserve `.env` and Docker volumes. Stop old Node development processes before starting the Bun app and workers.

    bun --version # must match .bun-version
    cp .env.example .env
    # Next.js dev server reads env from the app dir, so symlink:
    ln -sf ../../.env apps/web/.env

Fill in at minimum:

- `AUTH_SECRET` — `openssl rand -base64 32`
- `OPENROUTER_API_KEY` — a funded development key for demo indexing, semantic search, and AI features.
- `FIRECRAWL_API_KEY` — required before the web app or full worker boots. Get a key at [firecrawl.dev](https://firecrawl.dev); the free plan works.
- `SECRETS_ENCRYPTION_KEY` — 32-byte base64 key required as soon as you connect any integration or custom MCP server. Generate with `openssl rand -base64 32`. See [integrations setup](integrations.md).

Other third-party service keys can stay empty for the demo.

The rest of the defaults already match `docker-compose.yml`. When you use `docker compose --profile app up`, Compose forwards `TELEGRAM_BOT_TOKEN` and `SECRETS_ENCRYPTION_KEY` to the worker so Telegram and Slack direct-agent replies use the production-parity external-chat profile.

`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `SUPPORT_EMAIL` can stay empty locally. Empty Turnstile secrets fail open outside production so developers can create email/password accounts without a Cloudflare widget. Optional GitHub sign-in uses `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` with callback `http://localhost:3000/api/auth/callback/github`. Optional Google sign-in reuses the Drive OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) with callback `http://localhost:3000/api/auth/callback/google` and scopes `openid email profile` only — never Drive. See [Google sign-in setup](google-sign-in.md).

For local document parsing without Daytona, set `DOCUMENT_EXTRACT_ALLOW_INPROCESS=true`. This development-only option is rejected in production; leave it false when using a Daytona extractor.

Web and full worker startup require `FIRECRAWL_API_KEY`; missing configuration fails immediately. The document-extract-only worker does not require it. See the [website scan lifecycle](../relational-memory.md#website-scans). Team inbound addresses use `INBOUND_EMAIL_DOMAIN` from config.

Local Compose uses PostgreSQL 18. For an existing PostgreSQL 16 volume, follow the [data-preserving PostgreSQL upgrade procedure](postgres18.md) before startup. Keep `POSTGRES_DATA_VOLUME=postgres_data` until the documented migration; the image refuses old data rather than silently replacing it. Never use a volume reset to resolve this upgrade error.

When upgrading an existing Qdrant container, check its running image with `docker compose ps qdrant` before starting the updated Compose stack. Back up the stopped container's `/qdrant/storage` directory and upgrade through the latest patch of each intermediate minor version; a persisted 1.12 collection must not jump directly to 1.20.0. See the [Qdrant upgrade guide](https://qdrant.tech/documentation/operations/upgrades/). Recreating the container keeps its data volume and existing collection layout. After the server upgrade, use the collection-copy command below to adopt on-disk vectors without re-embedding; keep the source collection until the copy and demo verification pass.

Start infra:

    docker compose up -d
    docker compose ps           # all services should be "healthy"

This brings up Postgres (5432), Redis (6379), Qdrant (6333/6334), RustFS (9000 S3 API, 9001 console). RustFS uses `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY`, matching the app's local S3 credentials. The `rustfs-init` container uses the pinned `rustfs/rc:v0.1.36` client to create the required buckets, enable versioning, and allow direct browser document uploads from any local `localhost` or `127.0.0.1` port, including isolated worktree and E2E servers. Compose keeps Qdrant snapshots on the data volume (`QDRANT__STORAGE__SNAPSHOTS_PATH=/qdrant/storage/snapshots`) so snapshot create does not fail with overlayfs `EXDEV` / CrossesDevices on some Cloud Agent hosts. New collections store original vectors and payload on disk with scalar int8 quantization in RAM. An existing in-RAM `events` collection is not rewritten in place; copy it with `bun run --filter @timeline/worker qdrant-migrate-collection` (see [OpenRouter setup](../runbooks/reindex.md#qdrant-storage)) before expecting the lower memory footprint.

Install deps, run migrations, and optionally seed demo data:

    bun run deps
    set -a
    . ./.env
    set +a

    bun run db:generate            # only if you changed schema
    bun run db:migrate
    bun run demo:seed              # optional Acme Labs demo corpus; indexes vectors and verifies evidence
    bun run dev:seed:heavy         # optional extra volume for infinite-scroll / virtualization

Exporting the root environment is required for the database and worker commands. The root `bun run dev` script runs Turbo in loose env mode so those exported values reach the worker; Next.js reads the same values through `apps/web/.env`.

Run `bun run db:migrate` before restarting services after schema changes. The existing runner preserves migration ordering and takes an advisory lock.

`bun run demo:seed` runs the idempotent dev seed, indexes every fixture-version raw event, fact, document chunk, and meeting chunk through the production embed worker path, and then runs `bun run demo:verify`. The commands refuse production and only use local database and Qdrant hosts unless `ALLOW_DEV_SEED` is exactly `I_UNDERSTAND_THIS_SEEDS_KNOWN_DEV_CREDENTIALS`. Before writing fixture documents, the seed also requires a loopback `S3_ENDPOINT` and the `timeline-documents` bucket. Another isolated development store requires the separate exact acknowledgement `ALLOW_DEV_SEED_STORAGE=I_UNDERSTAND_THIS_WRITES_DEMO_DATA_TO_ISOLATED_STORAGE`; neither override permits `NODE_ENV=production`. The full command requires `AUTH_SECRET`, `DATABASE_URL`, `SECRETS_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, and `QDRANT_URL`. Fixture times are relative offsets resolved from the current date on the first seed; later reruns reuse the persisted `demo_seed_now` clock. It creates eight Acme Labs logins, all with password `timeline-dev`: `owner@timeline.dev`, `member@timeline.dev`, `jordan@timeline.dev`, `sam@timeline.dev`, `riley@timeline.dev`, `casey@timeline.dev`, `quinn@timeline.dev`, and `harper@timeline.dev`, plus an empty first-run workspace at `onboarding@timeline.dev` (Noah Blake's Team) with nothing connected. The seeded GitHub, Linear, Monday.com, Sentry, and Google Drive credentials are fake, encrypted, and disabled for sync. The timeline is a month of weekday-scale capture: about a hundred raw events per workday that group into fewer moments. Daily digest send stays disabled so the worker can run without outbound email or chat-bot configuration. Seed still creates the default email digest destination for the team, plus disabled Slack and Telegram destinations, and twenty weekdays of digest history. Verification checks all eight Acme Labs login identities plus the empty-team login, active team roles, and password usability without printing password hashes. It downloads seeded RustFS objects and verifies their actual SHA-256 bytes, then uses a real query embedding and team/user-scoped Qdrant searches to confirm every expected Northstar raw-event, fact, document-chunk, and meeting-chunk point. It also requires every expanded corpus document version to be `embedded` with a confirmed Qdrant point for each corpus chunk id. A missing embedding prerequisite fails closed, and documents remain `chunked` until Qdrant confirms applied point writes. Seeded canonical objects and document versions leave legacy `source_event_id` empty and expose demo provenance through reconciliation evidence, associations, and applied outputs. The glossary, story, and fake credentials live in [docs/demo-corpus.md](../demo-corpus.md). `bun run demo:reset` wipes the local stack and seeds again. `bun run dev:seed:heavy` adds enough extra Acme Labs rows to force infinite-scroll fetches and virtualization on collection feeds.

Run the app:

    bun run dev

Open <http://localhost:3000>.

<span id="phase-1-walkthrough"></span>

## Verify a capture

1.  Sign up as user A — you land on `/app` with a default team.
2.  Post a text note — appears in the timeline.
3.  Go to **Team settings** → invite user B by email. If `RESEND_API_KEY` and `TRANSACTIONAL_EMAIL_FROM` are set, user B receives the invite email. Otherwise the invite is still created with a visible send error and copyable fallback URL.
4.  Open the invite URL in an incognito window, sign up as user B → user B is added to the team. If user B is already signed in with an account whose email matches the invite, the invite also appears in the team switcher modal with accept and decline actions; email verification is encouraged but not required for invite acceptance.
5.  Post a note as user B; both users see it.
6.  As user A, open the team switcher, create a second team, then switch teams → empty timeline (isolation works).

<span id="phase-3-walkthrough"></span>

## Verify voice transcription

1.  `docker compose up -d` — verify `rustfs`, `redis`, and `postgres` are healthy. The `rustfs-init` container should report `RustFS buckets ready.`
2.  `bun run dev` runs both Next.js and the BullMQ worker (`apps/worker`) in watch mode.
3.  Open `/app`, click **Record**, speak for a few seconds, click **Stop**, then press the form's **Post** button (the single submit handles both text and voice; add a note alongside the clip if you want). A new event lands with an audio player, your typed note when present, and a "Transcribing…" placeholder for the pending transcript.
4.  With `OPENROUTER_API_KEY` set in `.env`, the transcript joins the note and replaces the placeholder within ~10s (page refresh required for now — no realtime pushdown yet). Without the key, the audio is still recorded and playable; the worker retries the transcribe job with exponential backoff until the key is provided and the worker restarts.
5.  Generic ingest webhook cross-source proposal evidence defaults to `CROSS_SOURCE_EVIDENCE_MODE=off`. Use `shadow` to record content-free pack metrics without changing proposals, or `enforced` to require exact per-change citations for that adapter. Other proposal adapters remain unchanged. Restart the worker after changing the mode.
6.  Telegram voice memos: send a voice note to the bot in a `/link`-ed DM (or bound group). The same flow runs: download → RustFS → enqueue → transcribe → backfill `content_text`.
7.  Re-deliver the same Telegram webhook to confirm idempotency: the row's `tg_update_id` is unique, so the second insert is a no-op and no second transcribe job is enqueued.

<span id="useful-commands"></span>

## Useful commands

This is a command reference, not a required local checklist. Follow the [validation policy in AGENTS.md](../testing/README.md#validation-policy) for scoped local checks and GitHub merge gates.

    bun run dev                              # next + worker, watch mode
    bun run validate                         # format, typecheck, lint, knip
    bun run test                             # unit + integration tests (package suites run sequentially)
    bun run test:eval                        # fast deterministic agent/dashboard/retrieval/summary/proposal evals
    AGENT_LIVE_ENV_FILE=/path/.env bun run test:agent-eval:live
                                          # opt-in live LLM askAgent durable-state + provider/document retrieval eval
    SUGGESTIONS_LIVE_ENV_FILE=/path/.env bun run test:suggestions-eval:live
                                          # opt-in live LLM suggestion extraction/projection eval
    PROPOSAL_ENGINE_LIVE_ENV_FILE=/path/.env bun run test:proposal-engine:live
                                          # opt-in live messy proposal-engine eval (real models + vectors; not CI; implicit done, fallback mint)
    bun run test:reconciliation-eval         # deterministic reconciliation domain/eval checks + sampling CLI gate
    RECONCILIATION_LIVE_ENV_FILE=/path/.env bun run test:reconciliation-eval:live
                                          # opt-in live LLM planner + judge matrix
    # optional: RECONCILIATION_LIVE_ARTIFACT_DIR=/tmp/eval-run writes one exact output dir
    # optional: RECONCILIATION_LIVE_ARTIFACT_ROOT_DIR=eval-runs/reconciliation writes timestamped runs
    # optional: RECONCILIATION_LIVE_CALL_TIMEOUT_MS=90000 tunes each live planner/judge call
    # optional: RECONCILIATION_LIVE_MAX_ATTEMPTS=3 retries transient planner,
    # judge, and judge-consistency failures
    bun run test:e2e-env                     # deterministic E2E env/port contract check
    bun run test:dist-imports                # build db/shared and import compiled runtime modules with Bun
    bun run --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=audit
    bun run --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=audit --fail-on-release-gate
    # optional: repeat --allow-degraded-source=<event_source> for known historical degraded replay rows
    bun run --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=backfill --dry-run --page-size=500
    TIMELINE_ENV_FILE=/path/to/.env bun run --filter @timeline/worker reconciliation-legacy-provenance -- --team=<uuid> --fail-on-legacy
    TIMELINE_ENV_FILE=/path/to/.env bun run --filter @timeline/worker reconciliation-production-sampling -- --input=/tmp/eval-run --out=/tmp/reconciliation-production-sampling.json --team=<uuid> --run-kind=closed_beta --fail-on-failures
    # production sampling accepts repeated --input paths; --run-kind defaults to manual
    # and may be manual, closed_beta, or post_deploy. Use --fail-on-failures for
    # release gates that should stop on any failed sample. Repeat
    # --confirm-fixture=<caseName>:<packetFingerprint> for reviewed failed samples
    # that should become deterministic fixtures. Team-persisted runs retain the
    # required scenario policy and promotion blockers; Team → Reconciliation shows
    # promotion readiness separately from fixture failures.
    # bun run dev also starts the reconciliation queue consumer for enqueued
    # evidence_audit/evidence_backfill/scope_reconcile jobs. Admins can enqueue
    # source-scoped audit/backfill and repair scoped team/object/cluster evidence
    # plus approval projections from /app/team/reconciliation. Completed
    # audit/backfill jobs persist reconciliation_runs metrics, including
    # release-gate failures for audit runs.
    bun run check:web-bundle                 # scan built Next server chunks after a web build
    bun run e2e                              # Playwright core journeys; requires compose infra + migrations + 4 GiB free disk space
    bun run e2e:prod-smoke                   # build + standalone-server smoke; requires compose infra + migrations
    bun run e2e:setup / bun run e2e:cleanup     # seed/remove deterministic e2e users and team
    bun run dev:seed                         # seed local demo data with disabled fake integrations and reconciliation provenance
    bun run demo:seed                        # seed, production-path index, and verify the private/local fictional demo corpus
    bun run demo:reset                       # wipe local Postgres/Qdrant/S3/Redis, migrate, and seed again
    bun run dev:seed:heavy                   # extra Acme Labs volume for infinite-scroll / virtualization after the corpus
    bun run demo:index                       # re-index fixture vectors through the real embed worker path
    bun run demo:verify                      # verify logins, downloaded document bytes, scoped Qdrant points, and corpus floors
    bun run lint && bun run typecheck           # quick static checks
    bun run knip                             # dead code / unused deps
    bun run format                           # prettier write
    bun run db:studio                        # drizzle studio at localhost:4983
    docker compose logs -f postgres       # tail a service
    bun run demo:reset                  # disposable demo fixtures only

Local E2E commands auto-detect published ports from a running `timeline-e2e-*` isolated Docker stack before falling back to the standard `localhost:5432`, `6379`, `9000`, and `6333` ports. Set `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, or `QDRANT_URL` explicitly to override this, or set `E2E_USE_DOCKER_PORTS=0` to force the fallback defaults. Remote fixture services require the explicit `E2E_REMOTE_FIXTURES=isolated` opt-in; use only disposable synthetic data. Ordinary exported application secrets are replaced with fixture defaults. Configure custom fixture secrets with `E2E_AUTH_SECRET`, `E2E_SECRETS_ENCRYPTION_KEY`, `E2E_S3_ACCESS_KEY_ID`, `E2E_S3_SECRET_ACCESS_KEY`, and `E2E_QDRANT_API_KEY`. Setup and cleanup enforce the service guard before opening a database transaction. Keep `apps/web/bunfig.toml`: it prevents Bun subprocesses from loading the developer environment before the isolated E2E environment reaches Next.js. The E2E launcher separately disables Next.js environment-file loading.

The static CI job runs formatting, TypeScript compilation, linting, Knip, the offline Bun suite, runtime smoke checks, React Doctor, deterministic reconciliation evaluations, environment contracts, and compiled-package import checks. Compilation uses TypeScript 7's `tsc` from `@typescript/native`; ESLint and other tools that import the compiler API use the TypeScript 6 compatibility package under the `typescript` package name. Shared `compilerOptions` in `tsconfig.base.json` include `erasableSyntaxOnly` for Bun type stripping. The web `lib` list uses `dom`, which includes `dom.iterable` in TypeScript 6. The separate production browser smoke job builds the web application. Run broader relevant test commands separately, including `bun run test:eval` for agent, retrieval, summary, dashboard chat, or proposal changes, and run the production build and bundle hygiene checks manually when changing deploy output, bundling, or server/client import boundaries.

<span id="resetting-local-data"></span>

## Resetting local data

Use `bun run demo:reset` only for the disposable demo database configured by the local setup. It resets fixtures; it is not a PostgreSQL upgrade or production repair. For old database volumes, follow [PostgreSQL migration](postgres18.md). Never delete volumes to fix a major-version startup error.


## Troubleshooting

- **`DATABASE_URL is required`** — `.env` not picked up. Confirm the file exists at the repo root and Next.js was restarted.
- **Migrations stuck** — `docker compose logs postgres`; ensure container is healthy.
- **Port already in use** — another local Postgres/Redis on the same port. Stop it, or edit `docker-compose.yml` to remap.

For the opt-in provider evaluation, follow [live website scan testing](../testing/README.md#live-website-scan).
