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

**Carryover from Phase 5 review:**
- [ ] Per-user rate limit on `/api/search`. Authenticated team members can spam the endpoint and burn OpenRouter quota + Qdrant CPU. The same fix will apply to `/api/chat` in Phase 6; solve them together.
- [ ] Qdrant wrapper `deletePoints` treats a 404 as soft-success. Will matter when a redaction / right-to-be-forgotten path lands; today there are no callers.
- [ ] Embedding-based fuzzy entity resolution. Phase 4 deferred this, Phase 5 laid the groundwork (vectors exist), Phase 6 may surface the need when the agent runs `get_entity` on near-duplicates. Still resolver-by-name-and-alias until then.
- [ ] Web-path reconciler for orphaned transcribe / extract / embed jobs. Phase 3/4/5 mark rows with `*_failed_at` on enqueue failure but there's no scheduled job that retries them. Manual reextract / reembed scripts are the escape hatch.

## Phase 6 — Agent chat

- [x] Chat UI: streaming responses via Vercel AI SDK (`@ai-sdk/react` `useChat` + `DefaultChatTransport`). Per-team scope, in-tab session only.
- [x] Agent tools (function calls): `search_timeline(query, filters)`, `get_entity(id_or_name)`, `list_events(filters)`, `get_event(id)`. All scoped to current team via `withTeam(db, teamId, userId)` constructed server-side; tool input schemas have no teamId field.
- [x] Agent system prompt: enforce citations. Every claim must reference a raw event ID. Versioned via `AGENT_PROMPT_VERSION`, stamped on every completion's log line.
- [x] UI: render citations as `[ev:<uuid>]` / `[ent:<uuid>]` chips linking to `/app/timeline?focus=<id>` and `/app/entities/<id>`.
- [x] `llm.streamChat()` sibling of `chatStructured` — env-gated, model-pinned (`AGENT_MODEL ?? CHAT_MODEL_DEFAULT`), deps-injectable for tests via `MockLanguageModelV3`.
- [x] `withTeam` extended with `getEventWithFacts`, `getEntity`, `searchEvents` — `/api/search` and the entity profile page now share the same code path as the agent tools.
- [x] Hard tool-call cap (5) via `stopWhen: stepCountIs(5)`. Tool errors are caught inside each `execute` and returned as `{ error }` so the stream stays alive.
- [x] Agent guardrails: tool input schemas reject teamId; tests verify cross-team event_id / entity_id / alias-collision inputs resolve to null/empty.

**Checkpoint:** ✅ Shipped in PR #7 (Phase 6). Product is now actually useful. Test with real team usage for two weeks before continuing.

**Carryover from Phase 6 review (file separately, do NOT solve in this PR):**
- [ ] Persisted multi-session chat history. Today the chat is in-tab only — refresh wipes it. Decide between row-per-message in Postgres vs an event-log table that doubles as the agent's memory. Pairs with proactive-agent (Phase 8+).
- [ ] Per-user rate limit on `/api/chat` AND `/api/search`. Both now hit the same code path (`withTeam.searchEvents` → embed + Qdrant), so a single token bucket keyed on (userId, route) covers both. Filed alongside the Phase 5 search rate-limit carryover.
- [ ] Split-pane chat-with-timeline layout. `AppShell` was rewritten as a two-pane sidebar shell (sidebar + `max-w-3xl` main column, see [`design.md`](./design.md)), but chat and timeline still live on separate routes. Showing the timeline alongside the chat composer is the remaining UI task.
- [ ] Embedding-similarity entity resolution inside `get_entity`. The tool currently does exact canonical-name / alias match (Phase 4 semantics). Near-duplicate entities will surface as separate hits and confuse the agent; revisit when it bites in dogfood.
- [ ] Streaming abort on client disconnect. `streamText` runs to step-cap even if the user closes the tab; wire `req.signal` through to the SDK once we see real OpenRouter cost.
- [ ] System-prompt / tool-description leakage. Any team member can probe the agent to reveal its prompt — fine for v1 (no secret in there), but worth a security review before adding tools that touch external systems.

## Phase 7 — Email ingest

- [x] Per-team inbound email address (e.g., `<team-slug>@in.thetimeline.app`). Map in DB.
- [x] Postmark inbound webhook endpoint at `/api/email/inbound`. Verify Postmark signature (HTTP Basic Auth, constant-time compare).
- [x] Parser: subject, from, to, cc, body (text + HTML), attachments.
- [x] Sender verification: match `from` against team member emails. Unknown senders → land with `sender_unverified=true` flag (matches Phase 2's `source_unverified` pattern); structured log line in lieu of a digest until outbound mail lands in Phase 8.
- [x] Attachment handling: upload to RustFS (`timeline-attachments` bucket), link from raw event. Same audio pipeline for audio attachments — content-type routed, with extension fallback only for `application/octet-stream` so MIME spoofing can't slip into transcribe.
- [x] CC/BCC pattern: any team member CC'ing the team address adds the thread to timeline.
- [x] Forward pattern: parse forwarded headers (Gmail / Apple Mail / Outlook variants) into `source_metadata.forwarded_from`; team member who pressed Forward stays as `authorUserId`.
- [x] Thread linking: emails in the same thread inherit `source_metadata.thread_root_id` via `In-Reply-To` and `References` headers (JSONB-only — no schema column, mirrors Phase 2's `edits_event_id` precedent).

**Checkpoint:** Forward a sales email thread to the team address. It lands in the timeline, threaded, with all parties extracted as entities.

**Carryover from Phase 7 review (file separately, do NOT solve in this PR):**
- [ ] Per-domain sender allowlist (e.g. "anyone @apple.com is trusted for this team"). v1 requires exact email match against `users.email`; vendor reps emailing in from off-roster addresses will land as unverified.
- [ ] Outbound email send. v1 ingest is read-only. Reply-via-email-to-comment, notification digests for unverified senders (currently a `console.warn` only), and team digests all need a sending surface.
- [ ] HTML rendering in timeline event card. v1 displays plain-text body and an attachment count; the raw HTML is preserved in `source_metadata.html_body` for later.
- [ ] Per-event visibility controls for email (including thread-level "private" so a sensitive forward can be scoped to specific users). Default today is `team`.
- [ ] Retroactive clear of `sender_unverified` when an unverified sender's email later joins the team. Today the flag is sticky on already-landed rows.
- [ ] Per-source delimited-content framing across ALL agent tool outputs (deeper prompt-injection sandbox than the v2 system prompt). Phase 6 flagged this; Phase 7 makes it load-bearing because email bodies are the first untrusted ingest the agent reads back. Today the system prompt instructs the agent to treat email content as quoted data; further hardening (markdown fencing, escape tables) is pending.
- [ ] Per-user rate limit on `/api/email/inbound` (in addition to the existing `/api/search` + `/api/chat` carryover). Postmark itself rate-limits inbound, so lower priority than the agent endpoints.
- [ ] Web-path reconciler for orphaned extract/embed jobs on email events. Folded into the existing Phase 3/4/5 reconciler ticket.
- [ ] Email dedup recovery for orphan attachments / audio children. The Phase 7 dispatcher's dedup short-circuit re-enqueues extract+embed only (idempotent at worker level); attachment S3 uploads and audio-child raw_events are NOT redone because creating a duplicate child row would corrupt the timeline. The rare case "delivery #1 inserted parent + crashed BEFORE attachment uploads, Postmark retry hits dedup" leaves an orphan parent. Reconciler should periodically scan for email events whose `source_metadata.raw_postmark.Attachments` names files that have no corresponding entry in `source_metadata.attachments[]`.
- [ ] Multi-alias-per-team inbound addresses. v1 uses a single `teams.inbound_email` column; a `team_email_aliases` table is a Phase 8 settings task.
- [ ] MailboxHash routing trust model. `<hex>+<slug>@inbound.postmarkapp.com` lets anyone who knows a slug land mail in that team (with `sender_unverified` badge + agent prompt mitigation, but extraction/embedding still runs). Real production should use a real MX domain — `POSTMARK_INBOUND_ADDRESS` is dev-only. Phase 8: add a per-team "accept-mailbox-hash-mode" opt-in and reject MailboxHash routing for teams that haven't opted in.
- [x] DB-outage silent drop on `/api/email/inbound`. Today every error path returns 200 so Postmark never retries. For transient infra (DB, S3, queue down) we should return 503 so Postmark retries. ✅ Closed in Bugbot round 5: `all_teams_failed` → 503 (every matched team's ingest threw); top-level crash → 503; soft logic failures (Zod, no team) stay 200.
- [ ] Postmark IP allowlist on the inbound route. Without it, anyone with the basic-auth secret can call the webhook. Postmark publishes egress IPs; consume them at the edge (or in the route).
- [ ] Rate-limit 401 responses on `/api/email/inbound` to slow secret brute-force.

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
