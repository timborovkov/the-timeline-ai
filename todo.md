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

- [x] Add per-user rate limits for `/api/search`, `/api/chat`, and capture/webhook endpoints. Redis token bucket in `packages/shared/src/rate-limit/`.
- [x] Add Postmark IP allowlist and rate-limit 401s on `/api/email/inbound`. `POSTMARK_INBOUND_IPS` + per-IP 401 lockout via the shared token bucket.
- [x] Add owner-safety rules: a team must always have at least one owner, or ownership must be transferred explicitly. Helper `assertNotLastOwner` in `packages/shared/src/team-roles.ts`; new `transferOwnershipAction` and `changeMemberRoleAction`.
- [x] Decide whether OAuth signup should honor invite tokens. Today the GitHub button passes the token via a signed `pending_invite` cookie; `createUser` skips the default solo team when one is pending.
- [x] Add web-path reconciler for orphaned transcribe/extract/embed jobs, including email attachment/audio child recovery where safe. `apps/web/src/lib/reconcile-jobs.ts` + `/api/cron/reconcile` gated on `CRON_SECRET`.
- [x] Review prompt-injection boundaries for all source content the agent can read back, especially email bodies. Tool outputs now fence `content_text`/`snippet` in `<external_content>`; Rule 8 names the tag and `AGENT_PROMPT_VERSION` bumped to `agent-v3-2026-05`.
- [x] Fix Qdrant `deletePoints` semantics before redaction/right-to-be-forgotten work. `deletePoints(ids, { verifyDeleted: true })` re-GETs each id and throws on still-present.
- [x] Wire streaming aborts through request disconnects to avoid unnecessary OpenRouter spend. `llm.streamChat` takes `abortSignal`; `/api/chat` passes `req.signal`.

## Phase 8 — Product Surface: Objects, Boards, And Workflows

Goal: turn the timeline from searchable memory into an object relation management system. Not just CRM for customers: durable objects can be projects, people, deals, vendors, incidents, documents, decisions, hiring loops, or anything the team tracks.

Data + server layer landed in PR #15 (migration `0007_phase8_objects.sql`). The
`entities` table now carries `status`/`stage`/`priority`/`owner_user_id`/
`assignee_user_id`/`due_at`/`agent_suggested`/`archived_at`, eight new tables
back relationships, audit, notes, last-visit, boards, notifications, chat
sessions and messages, and a new `packages/shared/src/objects` module exposes
the helpers (`listObjects`, `getObject`, `createObject`, `updateObject`,
`addRelationship`, `createNote`, `markVisited`, `listNotifications`,
`saveBoardView`, `appendChatMessages`, …) all routed through `withTeam`.

- [x] Generalize `entities` into first-class workspace objects with type, status, owner, stage, priority, due date, custom metadata, aliases, and relationships.
- [x] Add object pages that show timeline events, extracted facts, related objects, manual notes, status changes, open tasks, and agent-suggested changes. (`/app/objects/[id]` renders status/stage/priority/due editors, notes CRUD, related/linked objects, open tasks, and a recent-changes audit list. Timeline events for the object also land via `updateObject` writing a system raw_event per save.)
- [x] Add manual object edits. Every manual change writes an immutable timeline event and a structured object-change record. (Verified in `updateObject` — one `raw_events` row per save, one `object_changes` row per modified field.)
- [x] Add task objects: assignee, due date, status, source event, linked parent object. Agent can suggest tasks, humans approve/edit/complete them. (Tasks are `type='task'` with `parentObjectId` mapping to a `child` relationship. Agent suggestion surface is the `status='suggested'` + `agent_suggested=true` flag pair; UI for accept/reject pending in follow-up.)
- [x] Add "changes since last visit" summaries per object. (`object_views` upserts on visit; banner on the object page surfaces the delta.)
- [x] Add object/activity notifications. (`notifications` table, in-process fan-out from `updateObject` to owner+assignee, `/app/inbox` page with mark-read.)
- [x] Add persisted chat history scoped to team and optionally linked to objects. (Schema + `objects.appendChatMessages` + session/link/archive server actions shipped; wiring into `/api/chat` and the chat sidebar UI is the next follow-up below.)
- [~] Add board views over objects: kanban by status/stage, table/list by type, saved filters. (`board_views` schema + `saveBoardViewAction`/`deleteBoardViewAction`/`listBoardViews` ready; the `/app/boards` and `/app/boards/[id]` renderers — kanban drag-to-update-status, table/list filter UI — ship in a follow-up.)

### Phase 8 follow-ups (open)

- [ ] `/app/boards` + `/app/boards/[id]` UI: list saved boards, render kanban grouped by status/stage with drag-to-move, table + list variants reading the saved filter JSON. The server-side actions and `listObjects` filter shape are already in place.
- [ ] `/app/tasks` convenience board: preset filter `{type:'task'}` grouped by status. Trivial once `/app/boards` lands.
- [ ] `/api/chat` session persistence + chat sidebar: accept `?session=<id>`, call `objects.appendChatMessages` on `onFinish`, auto-create sessions on first message, render past sessions and pinned-object chip in `/app/chat`.
- [ ] Agent tools: `suggest_task`, `propose_object_change`, `get_object`, `list_objects`, `list_tasks`, `recent_changes` in `packages/shared/src/agent/tools.ts`. Existing `get_entity`/`search_timeline` keep working in the meantime.
- [ ] Overdue detector: recurring BullMQ job under `apps/worker/src/workers/` that scans `type IN ('task','follow_up') AND due_at < now() AND status NOT IN ('done','cancelled')` and emits `task_overdue`/`follow_up_overdue` notifications, deduped per-day on `(userId, entityId, kind)`.
- [ ] Suggestion review UI: surface `object_changes WHERE status='suggested'` on object pages with accept/reject buttons that flip status and apply the change.

## Phase 9 — Team Document Drive

Goal: give each team a private Google Drive-style knowledge base before external integrations. Documents become first-class timeline sources: uploads, deletes, moves, renames, and version changes are logged, processed, embedded, and cited by the agent.

- [ ] Add document storage schema: folders, documents, document versions, file blobs, document chunks, owners, visibility, timestamps, deleted_at, and source timeline event ids.
- [ ] Add folder/document UI: upload, rename, move, delete/restore, folder tree or breadcrumb navigation, owner display, created/updated timestamps, version history.
- [ ] Store document files in RustFS with immutable versioned object keys. Never overwrite a prior version in place.
- [ ] Log document activity to the timeline: upload, new version, rename, move, delete, restore, owner/visibility change.
- [ ] Add document processing workers: text extraction for text/markdown/docx where practical, PDF text extraction, OCR/AI vision for scanned PDFs/images, chunking, summarization, and embeddings.
- [ ] Add vector payloads for documents: `team_id`, `document_id`, `document_version_id`, `chunk_id`, `folder_id`, `owner_user_id`, `visibility`, `updated_at`, `embedding_model`.
- [ ] Add agent tools for document search and retrieval: search document chunks, get document metadata, get cited chunk/version, list recent document changes.
- [ ] Make document citations explicit in agent answers, e.g. `[doc:<id>#v<version>:chunk:<id>]`, linking to the document and exact version/chunk where possible.
- [ ] Add document reprocess/re-embed scripts. Changing OCR, chunking, or embedding models must be replayable and versioned.
- [ ] Add safety rules for deletes and retention: soft delete first, admin-only hard purge later, audit trail always preserved.
- [ ] Add initial document types/use cases to dogfood: contracts, deal docs, internal guides, policies, office rules, onboarding docs, customer notes.

## Phase 10 — Third-Party Integrations

Goal: sync external systems into the same timeline/object pipeline. MCPs are a good first integration layer where available; native APIs come later for higher-volume or webhook-heavy sources.

- [ ] Design integration account model: provider, connected user/team, scopes, refresh tokens/secrets, sync cursor, last sync state, visibility defaults.
- [ ] Add integration event schema: external source id, external object id, provider, event type, occurred_at, actor, raw payload pointer, sync batch id, dedup key.
- [ ] Google Drive knowledge sync: map selected Drive folders/files into the internal document model. Import metadata, comments/activity, shared-with changes, document change summaries, and selected file versions.
- [ ] Decide Drive vector strategy: reuse the internal document chunking/embedding pipeline for selected folders/docs; for broad Drive sync, embed deltas, comments, metadata, and curated summaries before full file bodies.
- [ ] Linear sync: issues, comments, status/assignee/priority changes, project milestones, linked GitHub PRs. Map issues/projects to workspace objects.
- [ ] GitHub sync: PRs, issues, reviews, merged commits, release notes, CI state changes. Map repos/PRs/issues/releases to workspace objects.
- [ ] Add provider-specific backfill + incremental sync jobs. Every sync must be idempotent and resumable.
- [ ] Add MCP adapter boundary: normalize MCP tool outputs into integration events and object changes, with provider-specific rate-limit/error handling outside the core pipeline.
- [ ] Add integration settings UI: connect/disconnect, choose folders/projects/repos, visibility defaults, sync health, last error.
- [ ] Add integration audit log and replay: show what was imported, when, by which connector version, and allow re-sync from cursor.

## Phase 11 — Polish And Hardening

- [ ] Onboarding flow: new team creation includes Telegram bot setup, email forwarding, first document upload, and first integration setup.
- [ ] Per-event visibility controls in UI (`private` / `team` / specific users). Defaults configurable per team/source.
- [ ] Audit log: who viewed/modified what. Useful for trust.
- [ ] Team data export: full JSON dump including raw events, facts, objects, tasks, documents, document versions, integrations, and signed file URLs.
- [ ] Background job monitoring dashboard. Failed jobs queue with retry UI.
- [ ] Performance: timeline pagination, object-page pagination, document search pagination, hot entity/object query caching.
- [ ] User-facing docs for capture surfaces, document drive, boards, integrations, and object management.

## Phase 12 — Backup And Operations

- [ ] RustFS backup cron service on Railway: nightly `rclone sync` to Backblaze B2 or chosen secondary store.
- [ ] Qdrant snapshot cron: nightly snapshot via Qdrant API, uploaded to RustFS or B2.
- [ ] Confirm Railway Postgres backup retention and document restore procedure.
- [ ] Run full restore drill from backups to a scratch environment. Repeat quarterly.
- [ ] Monitoring dashboards: Railway metrics, Sentry, worker queue depth, document processing failures, integration sync failures, OpenRouter spend.

## Phase 13 — Soft Launch

- [ ] Closed beta with 3-5 friendly teams. Weekly feedback sessions.
- [ ] Instrument capture friction: time from "open app" to "event recorded." Target: under 10 seconds for text, under 15 for voice.
- [ ] Instrument agent quality: thumbs up/down on answers. Target: >85% positive.
- [ ] Instrument object usefulness: teams should manually or automatically update tracked objects every workday.
- [ ] Instrument document usefulness: internal-policy/document questions should return cited answers from the correct document version.
- [ ] Iterate on extraction prompts based on misses. Re-extract historical events as prompts improve.
- [ ] Pricing model decision: per seat, per team, usage-based, or hybrid.

## Standing Items

- [ ] Backups verified weekly. Restore drill quarterly.
- [ ] Qdrant RAM usage monitored. Plan move to sharded or managed Qdrant before pain.
- [ ] OpenRouter spend dashboard. Per-feature cost tracking.
- [ ] Security: rotate API keys quarterly, audit team isolation on every schema/integration change.
- [ ] Re-extraction and re-embedding procedures tested quarterly even when not needed.
- [ ] Keep Dockerfiles and `railway.json` in sync with reality.
