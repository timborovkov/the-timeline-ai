# The Timeline — Build Plan

A concise, ordered TODO list. The order matters: infra and capture pipeline first, AI layer on top of solid foundations.

## Phase 0 — Foundations

- [x] Initialize pnpm + Turborepo monorepo: `apps/web`, `apps/worker`, `packages/shared`, `packages/db`.
- [x] Set up TypeScript project references across packages. Shared `tsconfig.base.json`.
- [x] Set up Prettier + ESLint at root, applied via Turbo.
- [x] Write Dockerfiles: `apps/web/Dockerfile` (Next.js standalone), `apps/worker/Dockerfile`. Both multi-stage with turbo prune.
- [x] Write `docker-compose.yml` for local dev: Postgres, Redis, Qdrant, RustFS, bucket-init container.
- [x] Document `.env.example` with every variable the app expects.
- [x] Verify full local stack starts cleanly: `docker compose up -d` → all healthchecks green.
- [ ] Create Railway project. Provision Postgres plugin, Redis plugin.
- [ ] Add Qdrant service on Railway (`qdrant/qdrant:v1.12.4` image + persistent volume).
- [ ] Add RustFS service on Railway (`rustfs/rustfs:latest` image + persistent volume). Run bucket init once.
- [x] Write `apps/web/railway.json` and `apps/worker/railway.json` (per-worker start command overrides in service settings).
- [ ] Set up two Railway environments: `staging` and `production`. Configure branch deploys (`main` → production, `staging` → staging).
- [ ] Set up OpenRouter account. Test chat, embeddings, transcription endpoints from local.
- [ ] Set up Postmark account. Configure inbound webhook URL (placeholder app endpoint).
- [ ] Register Telegram bot via BotFather. Disable privacy mode. Save token to Railway shared variables.
- [ ] Set up Sentry (or equivalent) for error tracking, structured logging.
- [x] Set up CI on GitHub Actions: lint, typecheck, format, knip, build on PR. Docker images verified locally / by Railway on deploy, not in CI (saves minutes).

## Phase 1 — Teams, users, basic capture

- [x] `packages/db`: Drizzle (or Prisma) setup with migrations. `pnpm db:migrate` and `pnpm db:generate` scripts.
- [x] Schema: `users`, `teams`, `team_members` (with role: `owner` / `admin` / `member`).
- [x] Auth flows in `apps/web`: sign up, sign in (email + OAuth), create team, invite member by email.
- [x] Team switcher in app shell.
- [x] Schema: `raw_events` (id, team_id, author_user_id, source, content_text, content_audio_url, occurred_at, created_at, visibility, source_metadata jsonb).
- [x] Web UI: text capture form. Submit → row in `raw_events`. No AI yet.
- [x] Timeline view: reverse-chronological list of raw events for current team. Filterable by author and date.
- [x] Enforce team isolation at the query layer (helper that always injects `team_id` — never trust the caller).
- [x] Row-level visibility filtering on timeline reads.
- [x] `/api/health` endpoint for Railway healthchecks.
- [ ] Deploy to Railway staging. Verify web service runs against Railway Postgres + Redis.

**Checkpoint:** A team can sign up, invite members, post text notes, see them in a timeline. No AI, no Telegram, no email. Deployed to staging. This is the spine — make sure it's solid.

## Phase 2 — Telegram bot (text only)

- [x] Schema: `telegram_users`, `telegram_user_teams` (with partial unique index on active), `telegram_chat_bindings`, `telegram_link_tokens`.
- [x] Telegram webhook endpoint at `/api/telegram/webhook`. Verify `X-Telegram-Bot-Api-Secret-Token` header on every request.
- [x] Set up webhook via `setWebhook` with secret token and `allowed_updates` filter.
- [x] `/start` command — DM welcome, group binding status.
- [x] Link token generation in web app (per team settings). Personal and group scopes. 15-min TTL. Single-use enforced via `consumed_at`.
- [x] `/link <token>` handler — DM (personal link) and group (chat binding). Scope validation; admin check for group binding.
- [x] Deep-link support: `t.me/YourBot?startgroup=TOKEN` for one-shot group binding.
- [x] `/team` command — list linked teams in DM, switch active via inline keyboard.
- [x] `/whereami` command — show current attribution. Works in both DMs and groups.
- [x] `/unlink` command — remove personal link or group binding (admin-only for groups). Confirmation required.
- [x] `/help` command — context-aware (DM vs group).
- [x] Message ingest: text messages in DMs (attributed via active team) and bound groups (attributed via binding). Write to `raw_events`.
- [x] Handle unlinked TG users in bound groups: attribute with `source_unverified` flag, prompt to link via DM.
- [x] Handle TG message edits: create new linked event, never mutate original.

**Checkpoint:** Users can type into Telegram and have it land in the timeline, attributed correctly. Multiple teams, switching works.

**Carryover from Phase 1 review:**
- [ ] OAuth signup currently doesn't honor invite tokens — the GitHub button is hidden on `/sign-up?invite=…`. Decide whether to thread the invite token through OAuth state and honor it post-callback (when Telegram OAuth or extra providers land).
- [ ] No safeguard against removing the last owner of a team. Owners can't be removed by admins (already enforced), but an owner can be removed by another owner with no transfer flow. Add either a "must have ≥1 owner" check or an explicit transfer-ownership action.

## Phase 3 — Voice notes and worker infrastructure

- [x] `apps/worker`: BullMQ setup. Queue names (`transcribe`, `extract`, `embed`) reserved in `@timeline/shared/queue`; only `transcribe` has a real consumer in Phase 3.
- [x] Worker entry point at `apps/worker/src/workers/transcribe.ts` (extract/embed deferred to Phase 4/5; queue names already exported).
- [x] S3 client (`@aws-sdk/client-s3`) configured for RustFS with `forcePathStyle: true`. Wrapper in `packages/shared/src/s3`.
- [x] Telegram audio handler: voice/audio download → upload to RustFS (`timeline-audio` bucket) → create raw event → enqueue transcription job (in `packages/shared/src/telegram/dispatcher.ts`).
- [x] Transcription worker: pull audio from RustFS → OpenRouter `/audio/transcriptions` → update raw event with transcript. Downstream extract enqueue lands in Phase 4.
- [x] Web UI: in-browser audio recording (MediaRecorder API). Pre-signed upload URL → direct PUT to RustFS → same downstream pipeline (`apps/web/src/components/audio-recorder.tsx`).
- [x] Timeline display: signed audio player + "Transcribing…" placeholder.
- [ ] Deploy worker service to Railway staging. Configure start command per worker type. (Follow-up: needs Railway env vars + fresh deploy.)

**Checkpoint:** Voice memo in Telegram or web → audible + readable in timeline within ~30 seconds.

## Phase 4 — Extraction and entities

- [x] Schema: `entities` (id, team_id, type, canonical_name, aliases jsonb, metadata jsonb, merged_into_id).
- [x] Schema: `facts` (id, team_id, raw_event_id, statement, confidence, extracted_at, model_version).
- [x] Schema: `fact_entities` (fact_id, entity_id, role) — facts reference entities with a role ("subject", "object", "topic").
- [x] Internal LLM wrapper in `packages/shared`: `llm.chatStructured()`, `llm.transcribeAudio()`. `llm.embed()` reserved as stub for Phase 5.
- [x] Extraction prompt: given raw event text + last-5-team-events context, output structured JSON with facts and entity mentions. Pin model version in config.
- [x] Extraction worker: triggered on raw event creation (and on transcription completion for audio). Writes facts and entity mentions. Embed enqueue deferred to Phase 5.
- [x] Entity resolution: for each mention, look up existing entities by name/alias within team. LLM-assisted disambiguation when ambiguous. Create new entity if no match. (No fuzzy/embedding dedup until Phase 5.)
- [x] Entity merge UI: admin can merge two entities (e.g., "Apple" and "Apple Inc"). Updates all references.
- [x] Entity page: profile view showing all events, facts, and related entities for one entity.
- [x] Re-extraction script: replay all raw events for a team through current extraction pipeline. Versioned, idempotent.

**Checkpoint:** Capture a few voice notes mentioning a person and a company. They appear as entities with auto-generated profile pages aggregating everything said about them.

## Phase 5 — Embeddings and semantic search

- [x] Qdrant client wrapper in `packages/shared`. Collection setup: one collection `events`, vector size 1536, cosine distance.
- [x] Pin `EMBEDDING_MODEL=openai/text-embedding-3-small` and `EMBEDDING_DIMENSIONS=1536` in env. Document re-embed procedure.
- [x] Embedding worker: on raw event finalization (post-transcription) and on fact extraction, embed text. Store model name in Qdrant payload.
- [x] Qdrant upserts with payload: `team_id`, `event_id`, `fact_id` (nullable), `entity_ids[]`, `occurred_at`, `author_user_id`, `source`, `visibility`, `embedding_model`.
- [x] Every Qdrant query filters on `team_id` (enforced via wrapper, no raw client access). Plus visibility filter based on calling user.
- [x] Search endpoint: text query → embed → Qdrant filtered search → return events/facts.
- [x] Web UI search bar: semantic search over team timeline. Result cards link to source event.
- [x] Re-embed script: same shape as re-extraction. Documented procedure, never silent.

**Checkpoint:** Search "licensing discussion with Apple" returns the right events even when the exact phrase isn't in any of them.

## Phase 6 — Agent chat

- [ ] Chat UI: streaming responses via Vercel AI SDK. Per-team scope.
- [ ] Agent tools (function calls): `search_timeline(query, filters)`, `get_entity(id_or_name)`, `list_events(filters)`, `get_event(id)`. All scoped to current team at the tool implementation level.
- [ ] Agent system prompt: enforce citations. Every claim must reference a raw event ID.
- [ ] UI: render citations as expandable links to the source event.
- [ ] Test cases from the brief: "What did the team work on yesterday?", "What was discussed with John Ternus last time?", "What's outstanding for Acme?".
- [ ] Agent guardrails: reject queries that try to cross team boundaries. Verify all tool calls scope to current team.

**Checkpoint:** The product is now actually useful. Test with real team usage for two weeks before continuing.

## Phase 7 — Email ingest

- [ ] Per-team inbound email address (e.g., `<team-slug>@in.thetimeline.app`). Map in DB.
- [ ] Postmark inbound webhook endpoint at `/api/email/inbound`. Verify Postmark signature.
- [ ] Parser: subject, from, to, cc, body (text + HTML), attachments.
- [ ] Sender verification: match `from` against team member emails. Unknown senders → quarantine, notify team owner.
- [ ] Attachment handling: upload to RustFS (`timeline-attachments` bucket), link from raw event. Same audio pipeline for audio attachments.
- [ ] CC/BCC pattern: any team member CC'ing the team address adds the thread to timeline.
- [ ] Forward pattern: parse forwarded headers to attribute correctly.
- [ ] Thread linking: emails in the same thread become linked events (via `In-Reply-To` and `References` headers).

**Checkpoint:** Forward a sales email thread to the team address. It lands in the timeline, threaded, with all parties extracted as entities.

## Phase 8 — Polish and hardening

- [ ] Onboarding flow: new team creation includes Telegram bot setup walkthrough and email forwarding example.
- [ ] Per-event visibility controls in UI (private / team / specific users). Defaults configurable per team.
- [ ] Audit log: who viewed/modified what. Useful for trust.
- [ ] Team data export: full JSON dump including raw events, facts, entities, audio file URLs (signed for 7-day access).
- [ ] Rate limiting on capture endpoints (per user, per team).
- [ ] Background job monitoring dashboard (Bull Board or equivalent). Failed jobs queue with retry UI.
- [ ] Performance: timeline pagination, Qdrant query result caching for hot entities.
- [ ] Documentation: user-facing guides for each capture surface.

## Phase 9 — Backup and operations

- [ ] RustFS backup cron service on Railway: nightly `rclone sync` to Backblaze B2 (or chosen secondary store).
- [ ] Qdrant snapshot cron: nightly snapshot via Qdrant API, uploaded to RustFS or B2.
- [ ] Postgres backup confirmation: verify Railway plugin retention, document restore procedure.
- [ ] Restore drill: full restore from backups to a scratch environment. Run quarterly.
- [ ] Monitoring dashboards: Railway metrics + Sentry + worker queue depth. Alert on queue depth > N, error rate > X%.

## Phase 10 — Soft launch

- [ ] Closed beta with 3–5 friendly teams. Weekly feedback sessions.
- [ ] Instrument capture friction: time from "open app" to "event recorded." Target: under 10 seconds for text, under 15 for voice.
- [ ] Instrument agent quality: thumbs up/down on answers. Target: >85% positive.
- [ ] Iterate on extraction prompts based on misses. Re-extract historical events as prompts improve.
- [ ] Pricing model decision (per seat? per team? usage-based on LLM cost?).

## Standing items (do throughout)

- [ ] Backups verified weekly. Restore drill quarterly.
- [ ] Qdrant RAM usage monitored. Plan move to sharded or managed Qdrant before pain.
- [ ] OpenRouter spend dashboard. Per-feature cost tracking.
- [ ] Security: rotate API keys quarterly, audit team isolation on every schema change.
- [ ] Re-extraction and re-embedding procedures tested quarterly even when not needed — so they work when they are needed.
- [ ] Keep Dockerfiles and `railway.json` in sync with reality. Verified locally / by Railway on deploy.
