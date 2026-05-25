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
- [x] **Telegram ingest:** link tokens, personal/group bindings, `/start`, `/link`, `/team`, `/whereami`, `/unlink`, `/help`, text ingest, edit handling, unverified Telegram attribution, `👀` reaction ack on every ingested message, and `/ask <question>` for in-chat agent answers (DM + group, rate-limited 10/min per Telegram user, reuses the same `withTeam` scope + agent tools as `/api/chat` via `agent.askAgent`).
- [x] **Voice and workers:** BullMQ queues, transcribe/extract/embed worker entry points, RustFS/S3 wrapper, Telegram audio ingest, web audio recording, transcription worker, timeline audio playback.
- [x] **Extraction and entities:** `entities`, `facts`, `fact_entities`, structured LLM extraction, entity resolution, merge UI, entity profile pages, re-extraction script.
- [x] **Embeddings and search:** Qdrant wrapper, event/fact embeddings, team/visibility-scoped vector queries, semantic search API/UI, re-embed script.
- [x] **Agent chat:** streaming chat UI, scoped tools, cited answers, shared `withTeam` data access, prompt/tool guardrails, hard tool-call cap. Also exposed in Telegram via `/ask` (non-streaming wrapper at `packages/shared/src/agent/ask.ts` reuses the same system prompt + tool set).
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
- [x] Add task objects: assignee, due date, status, source event, linked parent object. Agent can suggest tasks (`suggest_task` tool), humans approve/reject from the object page's "Recent changes" pane via `acceptObjectChange`/`rejectObjectChange`.
- [x] Add "changes since last visit" summaries per object. (`object_views` upserts on visit; banner on the object page surfaces the delta.)
- [x] Add object/activity notifications. (`notifications` table, in-process fan-out from `updateObject` to owner+assignee, `/app/inbox` page with mark-read.)
- [x] Add persisted chat history scoped to team and optionally linked to objects. (Schema, `objects.appendChatMessages`, `/api/chat` session resolution, and the `/app/chat` two-column layout with `SessionSidebar` + pinned-object chip all ship together.)
- [x] Add board views over objects: kanban by status/stage, table/list by type, saved filters. (`/app/boards` lists saved boards with a creation form; `/app/boards/[id]` renders kanban/table/list per `board.kind`. Kanban uses `@dnd-kit/core` with optimistic drag-to-move calling `updateObjectAction`. `/app/tasks` is a hardcoded preset.)

### Phase 8 follow-ups (shipped)

- [x] `/app/boards` + `/app/boards/[id]` UI: components in `apps/web/src/components/boards/` (`kanban-board.tsx`, `object-table.tsx`, `object-list.tsx`, `board-create-form.tsx`, `delete-board-button.tsx`); server actions in `apps/web/src/app/actions/boards.ts`.
- [x] `/app/tasks` convenience board: preset filter `{type:'task'}` grouped by status, reuses `<KanbanBoard>`.
- [x] `/api/chat` session persistence + chat sidebar: route also accepts `?session=<uuid>` as a query-string fallback; `/app/chat` is now a two-column layout; `<ChatPane>` hydrates `initialMessages`, propagates `sessionId`, and captures the `x-tl-session-id` response header on auto-created sessions; pinned-object chip wires to `unpinChatSessionAction`.
- [x] Agent tools: `get_object`, `list_objects`, `list_tasks`, `recent_changes`, `suggest_task`, `propose_object_change` shipped in `packages/shared/src/agent/tools.ts`. New service helpers `listObjectChanges` and `proposeObjectChange` back the read/write halves. System prompt bumped to `agent-v3-2026-05`.
- [x] Overdue detector: hourly BullMQ repeatable (`overdue-scan` queue, `apps/worker/src/workers/overdue.ts`) scans overdue tasks/follow_ups and fans out to owner+assignee. Dedup per-day via partial unique index `notifications_overdue_dedup_idx` in migration `0008_overdue_dedup.sql`.
- [x] Suggestion review UI: `suggested` rows in the "Recent changes" pane render Accept/Reject buttons. Accept calls `objects.acceptObjectChange` which re-uses `updateObject` so the full audit + notification path runs. A pending-suggestions banner appears on the object header when any are awaiting review.

### Phase 8 follow-ups (shipped) — embed the rest of the object graph

Phase 5 only covered `raw_events` and `facts` in Qdrant. This pass extends embedding coverage to the workspace object graph so the agent's retrieval tools see the full org map.

- [x] Embed `objects` on insert/update: text = type + name + aliases + status/stage/priority/due narrative. Re-embedded on every `updateObject`.
- [x] Embed `object_notes` on insert/update: text = note body. (Soft-deleted notes are skipped.)
- [x] Embed `object_changes` using the operator's prose `note` when present, else a compact `field: prev → next` diff. Internal markers (`__create__`, `__note_*__`) are skipped — the parent `raw_events` row carries the narrative.
- [x] Embed `entities` (canonical name + aliases) for entity disambiguation retrieval. Enqueued from `extract/resolve.ts` on insert and on alias merge, and from `createObject`/`updateObject` for workspace-typed entities.
- [x] Extended Qdrant payload in [`packages/shared/src/qdrant/client.ts`](packages/shared/src/qdrant/client.ts) with `source_kind` enum + per-kind id fields (`object_id`, `note_id`, `change_id`, `entity_id`); `event_id` widened to nullable. `PointScope` widened in [`packages/shared/src/qdrant/point-id.ts`](packages/shared/src/qdrant/point-id.ts). Existing event/fact points keep working without re-embed (hash unchanged); legacy points without `source_kind` are read-tolerated by the dedup path.
- [x] Reembed script walks every source kind with paired `--skip-objects`, `--skip-notes`, `--skip-changes`, `--skip-entities` flags. ([`apps/worker/src/scripts/reembed.ts`](apps/worker/src/scripts/reembed.ts))
- [x] Agent `search_timeline` accepts optional `source_kind` filter (single or array); `searchEvents` plumbs it through to Qdrant and defensively skips non-event-anchored hits in the event-id dedup. ([`packages/shared/src/agent/tools.ts`](packages/shared/src/agent/tools.ts), [`packages/shared/src/team-scope.ts`](packages/shared/src/team-scope.ts))
- [x] Coverage audit script [`apps/worker/src/scripts/embed-coverage.ts`](apps/worker/src/scripts/embed-coverage.ts) compares per-kind row counts to payload-filtered Qdrant counts and exits non-zero when drift exceeds `--threshold` (default 1%). Run via `pnpm --filter @timeline/worker embed-coverage -- --team=<uuid>`.

Out of scope (future): a `search_workspace` agent tool that returns workspace-graph hits with their own hydration path (current `search_timeline` only resolves event-anchored kinds); a backfill that stamps `source_kind` onto legacy event/fact points (read-side fallback handles them today); `documents`, `meeting_chunks`, `integration_events`, `chat_messages` source kinds (reserved in the enum, wired in their respective phases).

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

## Phase 10 — Meeting Bots (Google Meet, Teams, Zoom)

Goal: let the timeline agent join Google Meet, Microsoft Teams, and Zoom calls, capture transcripts in real time, and write meeting events, notes, and extracted facts/tasks into the same pipeline as Telegram, email, and web capture. Meetings become a first-class source — searchable, embedded, cited by the agent.

Default provider: **Recall.ai** (proven in the sister project Vernix at `/Users/timborovkov/Desktop/Projects/Vernix`). The adapter layer keeps it swappable for Attendee.dev (self-hosted, cost control), Meeting BaaS, or future native Meet/Teams APIs. Reusable patterns from Vernix worth borrowing: webhook → Zod validation → DB lookup by botId metadata; split signed status webhook from unsigned realtime transcript webhook; pre-built provider adapter shape. We diverge from Vernix on storage — meeting chunks go into the **shared team Qdrant collection** with `source_kind=meeting_chunk` + `meeting_id` payload, not a per-meeting collection, to keep retrieval uniform with the rest of the org map.

- [ ] Pick provider — default Recall.ai. Document the per-minute cost, silent vs. recording modes, and fallbacks (Attendee.dev, Meeting BaaS, native APIs) in `docs/setup/meeting-bots.html`.
- [ ] Add provider adapter at `packages/shared/src/meeting-bots/` with a `MeetingBotProvider` interface — `joinMeeting(url, opts)`, `leaveMeeting(botId)`, `getStatus(botId)`. Recall.ai first impl; reference Vernix `src/lib/meeting-bot/recall.ts` for shape (botId, metadata round-trip, silent/voice modes).
- [ ] Schema: extend `raw_events.source` enum with `'meeting'`. New `meetings` table — `id, team_id, provider_id (e.g. recall:botId), meeting_url, title, status (pending|joining|active|processing|completed|failed), started_at, ended_at, participants jsonb, metadata jsonb`. New `meeting_transcript_chunks` — `id, meeting_id, speaker, text, start_ms, end_ms, raw_event_id`. Each finalized chunk produces a `raw_events` row (source=meeting) so it flows through the existing extract → embed pipeline; chunks are also embedded directly so retrieval works at speaker/utterance granularity.
- [ ] Webhook handlers under `apps/web/src/app/api/webhooks/recall/` — split `status` (Svix-signed, bot/call lifecycle) from `transcript` (unsigned realtime, validated by Zod + botId→meeting lookup). Mirror Vernix's `src/app/api/webhooks/recall/{status,transcript}/route.ts`.
- [ ] Bot lifecycle worker: on `bot.call_ended` flip meeting to `processing`; on `transcript.done` run end-of-meeting summary, extract action items as tasks/object updates, finalize embeddings, mark `completed`. Re-use the existing extract worker — don't fork.
- [ ] Visibility: meetings default to `team`. Host can set `private` or `specific_users` before or during the call via the same control as other sources.
- [ ] UI surface — "Schedule meeting bot" entry in the capture composer: paste a Meet/Teams/Zoom link, choose silent vs. recording, choose visibility, optional title/agenda. Live indicator while the bot is in the call. Meeting page shows transcript, summary, extracted facts/tasks, and the timeline events generated.
- [ ] Calendar integration (stretch — can move to Phase 11): connect Google Calendar / Outlook so the bot auto-joins meetings on a user's calendar; opt-in per calendar.
- [ ] Cost guardrails: per-team monthly minute cap with admin override. Track per-meeting minutes in a `meeting_usage` row (mirrors Vernix `usageEvents`).
- [ ] Reliability: bot-failed events surface in the failed-jobs queue (Phase 12/13 monitoring dashboard) with retry/rejoin.
- [ ] Privacy/compliance: explicit "bot is recording" notice in the meeting, retention policy for raw audio (default: discard after transcript+embed completes), team-level toggle to require host consent before the bot joins.

## Phase 11 — Third-Party Integrations And Custom MCPs

Goal: sync external systems into the same timeline/object pipeline. Integrations span three classes: (1) curated native connectors with provider-specific sync logic (Drive, Linear, GitHub), (2) curated MCP-backed connectors when an official MCP exists, and (3) **custom MCP servers** that any team can connect to bring their own tools and data. Reference for MCP plumbing: Vernix `src/lib/mcp/` and `src/lib/db/schema.ts` (`mcpServers`, `mcpOauthTokens`).

- [ ] Design integration account model: provider, connected user/team, scopes, refresh tokens/secrets, sync cursor, last sync state, visibility defaults.
- [ ] Add integration event schema: external source id, external object id, provider, event type, occurred_at, actor, raw payload pointer, sync batch id, dedup key. These flow into raw_events with `source='integration'` and are embedded with `source_kind=integration_event`.
- [ ] Google Drive knowledge sync: map selected Drive folders/files into the internal document model. Import metadata, comments/activity, shared-with changes, document change summaries, and selected file versions.
- [ ] Decide Drive vector strategy: reuse the internal document chunking/embedding pipeline for selected folders/docs; for broad Drive sync, embed deltas, comments, metadata, and curated summaries before full file bodies.
- [ ] Linear sync: issues, comments, status/assignee/priority changes, project milestones, linked GitHub PRs. Map issues/projects to workspace objects.
- [ ] GitHub sync: PRs, issues, reviews, merged commits, release notes, CI state changes. Map repos/PRs/issues/releases to workspace objects.
- [ ] Add provider-specific backfill + incremental sync jobs. Every sync must be idempotent and resumable.
- [ ] Add MCP adapter boundary (covers both curated and custom MCPs): normalize MCP tool outputs and resource subscriptions into integration events and object changes, with provider-specific rate-limit/error handling outside the core pipeline.
- [ ] **Custom MCP server connections** — schema mirroring Vernix `mcpServers`: `id, team_id, added_by_user_id, name, url, auth_type (none|bearer|header|basic|oauth|url_key), auth_config jsonb (encrypted secrets), enabled, cached_tools jsonb, last_connected_at, last_error`. Per-team scoped (we are a team product, not solo).
- [ ] **MCP OAuth provider** — implement `OAuthClientProvider` from the MCP SDK (reference Vernix `src/lib/mcp/oauth-provider.ts`). State JWT carries `team_id + mcp_server_id`. Pre-registered clients via env vars for popular MCPs (GitHub, Linear, Slack); dynamic client registration for arbitrary servers. Callback at `/api/mcp/oauth/callback`.
- [ ] **Tool registry + namespaced invocation** — `McpClientManager` connects to all enabled MCP servers per team, discovers tools via `client.listTools()`, namespaces them `mcp__<server_id>__<tool_name>` to avoid collisions, caches in `mcp_servers.cached_tools` for the UI. Agent invokes via the namespaced path. Reference Vernix `src/lib/mcp/client.ts`.
- [ ] **MCP settings UI** — connect/disconnect, list connected servers, show tool inventory per server, test-call a tool, OAuth status, last-error surfacing, enable/disable without removing.
- [ ] Add integration settings UI: connect/disconnect, choose folders/projects/repos, visibility defaults, sync health, last error.
- [ ] Add integration audit log and replay: show what was imported, when, by which connector version, and allow re-sync from cursor.
- [ ] (Future, informational — no item) Vernix exposes itself as an MCP server at `/api/mcp` so external agents can query meetings/tasks. We may want to do the same later so external agents can query the timeline. Out of scope for this phase.

## Phase 12 — Polish And Hardening

- [ ] Onboarding flow: new team creation includes Telegram bot setup, email forwarding, first document upload, and first integration setup.
- [ ] Per-event visibility controls in UI (`private` / `team` / specific users). Defaults configurable per team/source.
- [ ] Audit log: who viewed/modified what. Useful for trust.
- [ ] Team data export: full JSON dump including raw events, facts, objects, tasks, documents, document versions, integrations, and signed file URLs.
- [ ] Background job monitoring dashboard. Failed jobs queue with retry UI.
- [ ] Performance: timeline pagination, object-page pagination, document search pagination, hot entity/object query caching.
- [ ] User-facing docs for capture surfaces, document drive, boards, integrations, and object management.

## Phase 13 — Backup And Operations

- [ ] RustFS backup cron service on Railway: nightly `rclone sync` to Backblaze B2 or chosen secondary store.
- [ ] Qdrant snapshot cron: nightly snapshot via Qdrant API, uploaded to RustFS or B2.
- [ ] Confirm Railway Postgres backup retention and document restore procedure.
- [ ] Run full restore drill from backups to a scratch environment. Repeat quarterly.
- [ ] Monitoring dashboards: Railway metrics, Sentry, worker queue depth, document processing failures, integration sync failures, OpenRouter spend.

## Phase 14 — Soft Launch

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
- [ ] **Org-wide searchable embeddings:** every team-scoped content surface — raw events, facts, entities, objects, object notes, object changes, documents, document chunks, meeting transcript chunks, meeting summaries, integration events, and (optionally) chat messages — has embeddings in the shared Qdrant collection, with payload `source_kind` identifying the kind and the source-kind-specific id. Verified by a periodic audit script that compares row counts in each source table to payload-filtered Qdrant counts.
