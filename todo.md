# The Timeline — Build Plan

Ordered roadmap. Keep this file short: shipped work is bundled, open work is actionable.

## Current Status

Phases 0-7 are shipped on `main` via PRs #1-#9. Railway deploy work is complete, deploy-time migrations are wired, and pino logging is live via PR #11.

Open PRs not counted here yet:

- PR #10 — UI redesign: spacious editorial calm, mobile nav, loading/error states.
- PR #12 — Telegram webhook auto-registration on web startup.

## Completed Bundle

- [x] **Foundations and deployment:** pnpm/Turborepo monorepo, TypeScript project refs, lint/format/knip/build CI, Dockerfiles, local Docker Compose stack, `.env.example`, Railway service configs, Railway project/environments/services, deploy-time migrations, `/api/health`.
- [x] **Teams and basic capture:** auth, teams, members, invites, team switcher, `raw_events`, team-scoped query helpers, row visibility filtering, text capture, timeline list.
- [x] **Telegram ingest:** link tokens, personal/group bindings, `/start`, `/link`, `/team`, `/whereami`, `/unlink`, `/help`, text ingest, edit handling, unverified Telegram attribution.
- [x] **Voice and workers:** BullMQ queues, transcribe/extract/embed worker entry points, RustFS/S3 wrapper, Telegram audio ingest, web audio recording, transcription worker, timeline audio playback.
- [x] **Extraction and entities:** `entities`, `facts`, `fact_entities`, structured LLM extraction, entity resolution, merge UI, entity profile pages, re-extraction script.
- [x] **Embeddings and search:** Qdrant wrapper, event/fact embeddings, team/visibility-scoped vector queries, semantic search API/UI, re-embed script.
- [x] **Agent chat:** streaming chat UI, scoped tools, cited answers, shared `withTeam` data access, prompt/tool guardrails, hard tool-call cap.
- [x] **Email ingest:** per-team inbound addresses, Postmark webhook, sender verification, parsing, attachment storage, audio attachment routing, CC/BCC forwarding, forwarded-header parsing, thread linking, retryable infra failures.
- [x] **Observability baseline:** structured pino logging across web, worker, and shared packages.

## Immediate Hardening

- [ ] Add per-user rate limits for `/api/search`, `/api/chat`, and capture/webhook endpoints. Use one token-bucket design keyed by `(userId or source, route, teamId)` where possible.
- [ ] Add Postmark IP allowlist and rate-limit 401s on `/api/email/inbound`.
- [ ] Add owner-safety rules: a team must always have at least one owner, or ownership must be transferred explicitly.
- [ ] Decide whether OAuth signup should honor invite tokens. Today the GitHub button is hidden on invite signup, but this comes back when more OAuth providers land.
- [ ] Add web-path reconciler for orphaned transcribe/extract/embed jobs, including email attachment/audio child recovery where safe.
- [ ] Review prompt-injection boundaries for all source content the agent can read back, especially email bodies. Prefer per-source fenced/tool-output framing before adding more external integrations.
- [ ] Fix Qdrant `deletePoints` semantics before redaction/right-to-be-forgotten work. A 404 should not be blindly treated as success once deletion matters.
- [ ] Wire streaming aborts through request disconnects to avoid unnecessary OpenRouter spend.

## Phase 8 — Product Surface: Objects, Boards, And Workflows

Goal: turn the timeline from searchable memory into an object relation management system. Not just CRM for customers: durable objects can be projects, people, deals, vendors, incidents, documents, decisions, hiring loops, or anything the team tracks.

- [ ] Generalize `entities` into first-class workspace objects with type, status, owner, stage, priority, due date, custom metadata, aliases, and relationships.
- [ ] Add object pages that show timeline events, extracted facts, related objects, manual notes, status changes, open tasks, and agent-suggested changes.
- [ ] Add board views over objects: kanban by status/stage, table/list by type, saved filters for "deals", "projects", "people", "follow-ups", etc.
- [ ] Add manual object edits. Every manual change writes an immutable timeline event and a structured object-change record.
- [ ] Add task objects: assignee, due date, status, source event, linked parent object. Agent can suggest tasks, humans approve/edit/complete them.
- [ ] Add "changes since last visit" summaries per object: new events, newly extracted facts, status changes, completed tasks, stale follow-ups.
- [ ] Add object/activity notifications: "this deal changed", "this project is blocked", "a promised follow-up is overdue".
- [ ] Add persisted chat history scoped to team and optionally linked to objects. Chats become part of the team's memory when saved.

## Phase 9 — Third-Party Integrations

Goal: sync external systems into the same timeline/object pipeline. MCPs are a good first integration layer where available; native APIs come later for higher-volume or webhook-heavy sources.

- [ ] Design integration account model: provider, connected user/team, scopes, refresh tokens/secrets, sync cursor, last sync state, visibility defaults.
- [ ] Add integration event schema: external source id, external object id, provider, event type, occurred_at, actor, raw payload pointer, sync batch id, dedup key.
- [ ] Google Drive knowledge sync: ingest file metadata, comments/activity, shared-with changes, and document change summaries. Do not blindly vectorize whole drives by default.
- [ ] Decide Drive vector strategy: embed object/file summaries, document titles/metadata, comments, and meaningful deltas first; embed full document chunks only for selected folders/docs.
- [ ] Linear sync: issues, comments, status/assignee/priority changes, project milestones, linked GitHub PRs. Map issues/projects to workspace objects.
- [ ] GitHub sync: PRs, issues, reviews, merged commits, release notes, CI state changes. Map repos/PRs/issues/releases to workspace objects.
- [ ] Add provider-specific backfill + incremental sync jobs. Every sync must be idempotent and resumable.
- [ ] Add MCP adapter boundary: normalize MCP tool outputs into integration events and object changes, with provider-specific rate-limit/error handling outside the core pipeline.
- [ ] Add integration settings UI: connect/disconnect, choose folders/projects/repos, visibility defaults, sync health, last error.
- [ ] Add integration audit log and replay: show what was imported, when, by which connector version, and allow re-sync from cursor.

## Phase 10 — Polish And Hardening

- [ ] Onboarding flow: new team creation includes Telegram bot setup, email forwarding, and first integration setup.
- [ ] Per-event visibility controls in UI (`private` / `team` / specific users). Defaults configurable per team/source.
- [ ] Audit log: who viewed/modified what. Useful for trust.
- [ ] Team data export: full JSON dump including raw events, facts, objects, tasks, integrations, and signed file URLs.
- [ ] Background job monitoring dashboard. Failed jobs queue with retry UI.
- [ ] Performance: timeline pagination, object-page pagination, hot entity/object query caching.
- [ ] User-facing docs for capture surfaces, boards, integrations, and object management.

## Phase 11 — Backup And Operations

- [ ] RustFS backup cron service on Railway: nightly `rclone sync` to Backblaze B2 or chosen secondary store.
- [ ] Qdrant snapshot cron: nightly snapshot via Qdrant API, uploaded to RustFS or B2.
- [ ] Confirm Railway Postgres backup retention and document restore procedure.
- [ ] Run full restore drill from backups to a scratch environment. Repeat quarterly.
- [ ] Monitoring dashboards: Railway metrics, Sentry, worker queue depth, integration sync failures, OpenRouter spend.

## Phase 12 — Soft Launch

- [ ] Closed beta with 3-5 friendly teams. Weekly feedback sessions.
- [ ] Instrument capture friction: time from "open app" to "event recorded." Target: under 10 seconds for text, under 15 for voice.
- [ ] Instrument agent quality: thumbs up/down on answers. Target: >85% positive.
- [ ] Instrument object usefulness: teams should manually or automatically update tracked objects every workday.
- [ ] Iterate on extraction prompts based on misses. Re-extract historical events as prompts improve.
- [ ] Pricing model decision: per seat, per team, usage-based, or hybrid.

## Standing Items

- [ ] Backups verified weekly. Restore drill quarterly.
- [ ] Qdrant RAM usage monitored. Plan move to sharded or managed Qdrant before pain.
- [ ] OpenRouter spend dashboard. Per-feature cost tracking.
- [ ] Security: rotate API keys quarterly, audit team isolation on every schema/integration change.
- [ ] Re-extraction and re-embedding procedures tested quarterly even when not needed.
- [ ] Keep Dockerfiles and `railway.json` in sync with reality.
