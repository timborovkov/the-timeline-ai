# The Timeline — Build Plan

Ordered roadmap. Keep this file short: shipped work is bundled, open work is actionable.

## Current Status

Phases 0-10 are shipped on `main`. Phase 11 (Third-Party Integrations +
Custom MCPs) is in review on this branch: migration `0012`, AES-256-GCM
secrets, integrations module + scope helpers, Drive/Linear/GitHub provider
adapters, MCP client manager + team-scoped CRUD + namespaced agent tools,
sync worker + 5-minute repeatable, settings UI + audit log, SVG connector
logos, and docs.

Open PRs not counted here yet:

- Phase 11 — Third-Party Integrations + Custom MCPs (this branch).

## Completed Bundle

- [x] **Foundations and deployment:** pnpm/Turborepo monorepo, TypeScript project refs, lint/format/knip/build CI, Dockerfiles, local Docker Compose stack, `.env.example`, Railway service configs, Railway project/environments/services, deploy-time migrations, `/api/health`.
- [x] **Teams and basic capture:** auth, teams, rename, members, invites, team switcher with team creation, `raw_events`, team-scoped query helpers, row visibility filtering, text capture, timeline list.
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

Foundation, processing pipeline, agent surface, and the document drive UI shipped together in three reviewable slices on one branch (migration `0010_phase9_documents.sql`). The new `documents` module in `packages/shared/src/documents/` (scope + chunker + object-key) sits alongside the existing `objects` module; folders/documents reuse `event_visibility` so the same `withTeam` visibility predicate gates the drive. Every doc activity writes a `raw_events` row with `source='document'` and a structured `sourceMetadata` payload so the existing timeline / notification / search plumbing lights up without bespoke wiring.

- [x] Document storage schema: `folders` (nested tree), `documents` (folder_id nullable = team root), `document_versions` (immutable, versioned object_key in RustFS), `document_chunks`. Soft-delete via `deleted_at`. `document_versions.source_event_id` back-references the upload `raw_events` row. (`packages/db/src/schema/documents.ts`, migration `0010_phase9_documents.sql`.)
- [x] Folder/document UI: drag-drop upload, breadcrumb navigation, nested folders (one-level-at-a-time browsing via `?folder=<id>`), rename/delete/restore, owner display, version history with processing-status badges, signed-URL download per version. (`apps/web/src/app/app/documents/`, `apps/web/src/components/documents/`.)
- [x] RustFS storage with versioned immutable object keys: `${teamId}/${documentId}/v${version}/${filename}`. New `S3_BUCKET_DOCUMENTS` env. Renames change the DB row only; the object is never overwritten in place. (`packages/shared/src/documents/object-key.ts`, `packages/shared/src/s3/client.ts`.)
- [x] Log document activity to the timeline. New `'document'` value on the `event_source` enum; every upload/new-version/rename/move/delete/restore/visibility-change writes a `raw_events` row in the same transaction as the doc mutation with `sourceMetadata.action` + previous values. (`packages/shared/src/documents/scope.ts`.)
- [x] Document processing worker: text / markdown / json / xml read directly. PDF and image (jpg/png/etc.) route through `llm.extractTextFromMedia` (`packages/shared/src/llm/vision.ts`) — vision LLM via OpenRouter, model pinned to `VISION_MODEL` env. DOCX uses `mammoth` for native raw-text extraction (cheaper + lossless vs. vision-on-Office-XML). Filename-extension fallback handles uploads where Content-Type came through as `application/octet-stream`. Audio/video remain out of scope (audio has its own transcribe worker). Chunker (~800 token target / ~120 overlap) in `packages/shared/src/chunk.ts`. (`apps/worker/src/workers/documentExtract.ts`.)
- [x] Vector payloads for documents: `point_kind: 'doc-chunk'` discriminator, plus `document_id` / `document_version_id` / `document_chunk_id` / `folder_id` / `owner_user_id` / `updated_at`. `searchEvents` excludes doc-chunk points via `must_not`; `searchDocumentChunks` filters to `kind: 'doc-chunk'`. Pre-Phase-9 points without `point_kind` work unchanged (no backfill required). (`packages/shared/src/qdrant/client.ts`.)
- [x] Agent tools: `search_documents`, `get_document`, `get_document_chunk`, `list_recent_document_changes`. All chunk text goes through `fenceExternalContent` (Rule 8 — uploaded documents are an untrusted source). (`packages/shared/src/agent/tools.ts`.)
- [x] Citation format extended: `[doc:<documentId>#v<version>:chunk:<chunkId>]` mandatory whenever the agent uses document content. System prompt bumped to `agent-v5-2026-05` with documents-as-untrusted-source clarification. Citation chip in `apps/web/src/components/chat/citation.tsx` resolves to `/app/documents/<documentId>?version=<n>#chunk-<chunkId>`.
- [x] Reprocess / re-embed scripts: `redocument-extract` (re-drives the worker; `--force` resets pending), `redocument-embed` (per-chunk embed enqueue with `--target-collection` for zero-downtime model cutover). Mirror the existing `reembed.ts` / `reextract.ts` shape. (`apps/worker/src/scripts/`.)
- [x] Safety: all deletes are soft (`deleted_at`); object blobs are retained. Deleted-document chunks are filtered out of search (worker skip-stamp + scope visibility join). Visibility changes write a `visibility_change` raw_event so audit is preserved. Hard purge is deferred to admin-only follow-up.
- [ ] Per-team monthly vision-spend caps + dashboard. Vision tokens are 5-10x text tokens; without caps a 100-page PDF dump per team could surprise the bill. Tracked in Phase 13 (cost guardrails / monitoring).
- [ ] Dogfood content: contracts, deal docs, internal guides, policies, office rules, onboarding docs, customer notes. Pending real content.

## Phase 10 — Meeting Bots (Google Meet, Teams, Zoom)

Goal: let the timeline agent join Google Meet, Microsoft Teams, and Zoom calls, capture transcripts in real time, and write meeting events, notes, and extracted facts/tasks into the same pipeline as Telegram, email, and web capture. Meetings become a first-class source — searchable, embedded, cited by the agent.

Default provider: **Recall.ai**. The adapter layer keeps it swappable for Attendee.dev (self-hosted, cost control), Meeting BaaS, or future native Meet/Teams APIs. Patterns: webhook → Zod validation → DB lookup by botId metadata; split signed status webhook from unsigned realtime transcript webhook; pre-built provider adapter shape. Storage: meeting chunks go into the **shared team Qdrant collection** with `source_kind=meeting_chunk` + `meeting_id` payload, not a per-meeting collection, to keep retrieval uniform with the rest of the org map.

Phase 10 ships silent transcript capture only — no voice/agent mode, no
calendar auto-join (both removed from scope per the build decision; revisit
in a follow-up phase if/when there's demand).

- [x] Pick provider — Recall.ai is the default. Per-minute cost, silent-mode default, and Attendee.dev / Meeting BaaS / native-API fallbacks documented in [`docs/setup/meeting-bots.html`](docs/setup/meeting-bots.html).
- [x] Provider adapter at [`packages/shared/src/meeting-bots/`](packages/shared/src/meeting-bots/) implements `MeetingBotProvider` (`joinMeeting` / `leaveMeeting` / `getStatus`). Recall.ai shape — silent-only (no `output_media`, no voice secrets), botId + metadata round-trip, Token-prefixed auth.
- [x] Schema: `raw_events.source` extended with `'meeting'`; new [`meetings`](packages/db/src/schema/meetings.ts), `meeting_transcript_chunks`, `meeting_usage`, and `team_meeting_settings` tables. Migration [`0011_phase10_meetings.sql`](packages/db/drizzle/0011_phase10_meetings.sql). Each finalised chunk lands as a `meeting_transcript_chunks` row; chunks are embedded via `source_kind='meeting_chunk'` for utterance-granular retrieval. One consolidated `raw_events` row (source=meeting) is created by the meeting-finalize worker with the full transcript as `contentText` and the LLM summary in `sourceMetadata.summary`. Idempotent under webhook replay via partial unique index on `(meeting_id, provider_chunk_id)`.
- [x] Webhook handlers under [`apps/web/src/app/api/webhooks/recall/`](apps/web/src/app/api/webhooks/recall/) — `status` is Svix-signed (custom HMAC-SHA256 verifier in [`packages/shared/src/meeting-bots/svix.ts`](packages/shared/src/meeting-bots/svix.ts); accepts both `svix-*` and `webhook-*` headers); `transcript` is unsigned and validated by Zod + botId→meeting lookup + per-bot rate limit.
- [x] Bot lifecycle worker [`apps/worker/src/workers/meetingFinalize.ts`](apps/worker/src/workers/meetingFinalize.ts): on `bot.call_ended` the status webhook flips the meeting to `processing` and enqueues finalize, which generates the summary, extracts action items, creates one consolidated `raw_events` row (full transcript + summary), backfills `rawEventId` on all chunks, enqueues extract + embed for that single event, records minutes (idempotent via `meeting_usage` unique index), and flips to `completed`.
- [x] Visibility: meetings default to `team`. Compose with `private` (creator only) or `specific_users` — the visibility is copied onto every generated `raw_events` row so the existing `visibilityFilter` works unchanged. Per-utterance overrides are not in scope.
- [x] UI surface — [`/app/meetings`](apps/web/src/app/app/meetings/page.tsx) lists recent meetings + current-month minutes against the team cap. [`ScheduleMeetingBotForm`](apps/web/src/components/meeting-forms.tsx) takes URL, optional title, visibility, and consent. Meeting detail page shows status, speaker-by-speaker transcript, summary, and (once finalised) extracted action items.
- [x] Cost guardrails: per-team monthly minute cap (`team_meeting_settings.meeting_minutes_cap`, default 600) with admin override flag. Each finalised meeting writes a `meeting_usage` row; the schedule action sums the current month before allowing a new bot. 0 = disabled, null = unlimited.
- [x] Privacy/compliance: `require_host_consent` (default true) blocks scheduling unless the caller has ticked the consent box. Timestamp stored on `meetings.metadata.consent_given_at`. Raw audio is NOT copied to S3 — Recall's default retention applies to the recording artifact; the transcript text is the only persistent record.
- [ ] Reliability follow-up: surface bot-failed states in the Phase 13/14 monitoring dashboard with retry/rejoin. Failure is captured cleanly on `meetings.status='failed'` today; a dedicated dashboard ships with that phase.

## Phase 11 — Calendar

Goal: give the timeline a proper calendar layer. The internal timeline calendar is the primary surface — agents and users track deadlines, agreed meetings, follow-ups, and any time-anchored commitment here, just like objects and tasks live natively in the workspace. External calendar sync (Google Calendar, iCloud/CalDAV) layers on top as import-only; push-to-external is a low-priority post-MVP follow-up. No full two-way sync.

### Schema and data model

- [x] `calendar_events` table (new first-class table, NOT an entity type): team-scoped, title, description, `start_at`/`end_at` timestamps (UTC), `timezone` (IANA, e.g. `America/New_York`), all-day flag, location, visibility (`private`/`team`/`specific_users`), `show_as` (busy/free), creator user, `reminder_minutes` (nullable, overrides team default), source (`internal`/`google`/`caldav`), `external_calendar_id`, `external_event_id`, `agent_suggested` boolean, `deleted_at` (soft-delete), and `metadata` JSONB. Migrations `0017_phase11_calendar.sql` and `0018_phase11_calendar_dedup.sql`.
- [ ] Recurrence: `rrule` (RFC 5545) column on parent event. Worker materializes individual occurrences into `calendar_events` rows on a 3-month rolling window. Self-referential FK `recurring_parent_id` → `calendar_events.id`. `original_start_at` (stable occurrence identifier, survives rescheduling). `is_exception` flag for manually-edited occurrences (re-expansion skips these). "Edit this" = mark exception. "Edit all future" = delete-and-reexpand non-exception children ≥ now.
- [x] `calendar_event_entities` join table: `(calendar_event_id, entity_id, relationship_type)` for explicit object/entity links. Scope helpers verify linked entities belong to the active team before insert. Implicit links happen through extraction on the raw_events.
- [x] `team_calendar_settings` table: `default_reminder_minutes` (default 15), team-level calendar preferences.
- [ ] `connected_calendars` table: per-user external calendar connections. Provider (`google`/`caldav`), OAuth tokens / CalDAV credentials, selected calendars, `is_private` boolean, sync cursor, last sync state, default visibility for imported events.

### Timeline integration

- [x] Two `raw_events` rows per calendar event: one at creation time (`occurred_at` = now, `source='calendar'`, action = `'scheduled'`) and one at the event's `start_at` (`occurred_at` = event start, action = `'event'`). User-visible updates/deletes write additional raw_events at mutation time; deletes tombstone the linked scheduled/event rows so active timeline reads and direct event lookups only show the cancellation audit row.
- [x] Calendar event embeddings: `source_kind='calendar_event'` in Qdrant. Team-visible events enqueue embeddings after the DB transaction commits; private/specific-user updates and deletes remove stale Qdrant points for the configured embedding model after commit. Search payloads hydrate through the start-at raw event, whose text mirrors the rich calendar summary, so results carry the event occurrence timestamp and details. `embed-coverage` counts active team-visible calendar events.
- [x] Private event rendering: private events are opaque to teammates, not invisible. Calendar UI shows "Busy" blocks for other users' private events. Application-layer redaction in the calendar scope returns busy content while preserving time blocks; agent and timeline use existing visibility filtering unchanged.

### UI

- [x] Timeline calendar UI: month view at `/app/calendar` with event creation and detail links. Server fetch ranges and client day buckets use the same UTC month boundaries, and the grid renders events spanning into the visible month, including events that start before the month and end inside it. Create/edit/delete uses the calendar scope's raw-event audit trail.
- [ ] Week/day calendar views.
- [ ] Recurring event editing UI: "this event" / "this and all future" / "all events" edit modes. Exception badge on modified occurrences.

### Agent surface

- [x] Agent calendar tools: `suggest_calendar_event`, `list_calendar_events`, and `get_calendar_event`. Unbounded calendar listing defaults to upcoming events. Agent-created suggestions use `agent_suggested=true`; human review UI remains a follow-up.
- [ ] Calendar update tool and accept/reject UI for agent-suggested calendar events.

### External calendar sync (import-only for MVP)

- [ ] Google Calendar connector: OAuth 2.0, incremental sync via `syncToken`, push notifications (webhooks) for near-real-time import. Provider adapter interface mirrors the meeting-bots pattern.
- [ ] Generic CalDAV connector: covers iCloud, Fastmail, Nextcloud, Synology, etc. User provides server URL + credentials (app-specific password). Polling-based sync (CalDAV has no push). Same adapter interface as Google.
- [ ] Imported events land as native `calendar_events` with `source='google'`/`source='caldav'` and back-reference `external_event_id` for dedup. Private connected calendars import with `visibility='private'`.
- [ ] External event deletion: soft-delete the `calendar_events` row + tombstone marker on raw_events `sourceMetadata`. Timeline shows the event was cancelled; history preserved.
- [ ] (Post-MVP, low priority) Push internal events to connected Google Calendar so they appear on the user's phone. Timeline is authoritative; outbound push is fire-and-forget.

### Notifications and reminders

- [ ] Dedicated reminder worker: BullMQ repeatable on 5-minute loop. Queries for events with reminders due in the next 5 minutes. Fires notifications. Stateless — no per-event scheduled jobs.
- [ ] Reminder cascade: team default (`team_calendar_settings.default_reminder_minutes`) → per-event override (`calendar_events.reminder_minutes`). Two layers.
- [ ] Daily digest: one summary of today's events per user per morning. Delivery channel is user's choice: inbox notification, email (Postmark outbound), and/or Telegram. Per-user delivery preferences (platform-wide, not calendar-specific — reusable for overdue alerts, agent suggestions, etc.).
- [ ] Overdue/missed event alerts: extend existing overdue-scan worker to include calendar events past their `start_at` with no attendance/completion signal.

## Phase 12 — Third-Party Integrations And Custom MCPs

Goal: sync external systems into the same timeline/object pipeline. Integrations span three classes: (1) curated native connectors with provider-specific sync logic (Drive, Linear, GitHub), (2) curated MCP-backed connectors when an official MCP exists, and (3) **custom MCP servers** that any team can connect to bring their own tools and data.

Shipped together on this branch. Migration `0012_phase11_integrations.sql`
adds `integrations`, `integration_sync_state`, `integration_selections`,
`integration_audit_log`, `mcp_servers`, `mcp_oauth_tokens`, and extends
`event_source` with `'integration'`. All auth material is AES-256-GCM
encrypted at rest via [`packages/shared/src/crypto/secrets.ts`](packages/shared/src/crypto/secrets.ts)
using the new `SECRETS_ENCRYPTION_KEY` env var. Per-team helpers in
[`packages/shared/src/integrations/`](packages/shared/src/integrations) and
[`packages/shared/src/mcp/`](packages/shared/src/mcp) are spread into
`withTeam` as `.integrations` and `.mcp`.

- [x] Integration account model — [`packages/db/src/schema/integrations.ts`](packages/db/src/schema/integrations.ts) + [`packages/shared/src/integrations/scope.ts`](packages/shared/src/integrations/scope.ts). One row per (team, provider, externalAccountId); tokens encrypted.
- [x] Integration event schema — `raw_events.source='integration'` plus structured `source_metadata.{provider, external_object_id, event_type, dedup_key, actor, ...}`. Partial unique index `raw_events_integration_dedup_unq` per team. Embedded with `source_kind='integration_event'` via [`packages/shared/src/qdrant/client.ts`](packages/shared/src/qdrant/client.ts) extension.
- [x] Google Drive sync — OAuth2 + Drive `changes.list` cursor in [`packages/shared/src/integrations/providers/google-drive.ts`](packages/shared/src/integrations/providers/google-drive.ts). Push-notification wake-up at `/api/webhooks/google-drive`.
- [x] Drive vector strategy — change-feed metadata events embed via the standard raw_event path (`source_kind='integration_event'`). Importing a Drive file body into the team document drive reuses the Phase 9 `documentExtract` pipeline; aggressive full-file harvest stays as a follow-up.
- [x] Linear sync — OAuth2 + GraphQL `issues(filter: { updatedAt: { gt: $since } })` cursor in [`packages/shared/src/integrations/providers/linear.ts`](packages/shared/src/integrations/providers/linear.ts). HMAC-signed webhook at `/api/webhooks/linear`.
- [x] GitHub sync — OAuth + REST cursor over PRs and issues per repo in [`packages/shared/src/integrations/providers/github.ts`](packages/shared/src/integrations/providers/github.ts). HMAC-signed webhook at `/api/webhooks/github`.
- [x] Backfill + incremental sync jobs — `integration-sync` queue + worker at [`apps/worker/src/workers/integrationSync.ts`](apps/worker/src/workers/integrationSync.ts). 5-minute repeatable tick fans incremental syncs out to every enabled integration. Idempotent under the dedup-key index.
- [x] MCP adapter boundary — [`packages/shared/src/mcp/client.ts`](packages/shared/src/mcp/client.ts) speaks JSON-RPC 2.0 over the MCP streamable-HTTP transport (`initialize`, `tools/list`, `tools/call`). Outputs run through `fenceExternalContent` before the agent sees them.
- [x] Custom MCP server connections — `mcp_servers` per-team with AES-GCM `auth_config`, plus `mcp_oauth_tokens` for OAuth tokens + dynamic-client metadata. CRUD via `/api/team/mcp-servers[/:id]` and `withTeam(...).mcp`.
- [x] MCP OAuth state — HMAC-signed state at [`packages/shared/src/mcp/oauth-state.ts`](packages/shared/src/mcp/oauth-state.ts) carrying `(teamId, mcpServerId, userId)`; 15-min TTL.
- [x] Tool registry + namespaced invocation — `McpClientManager` (5-min cache + pending-dedup) discovers tools per team and namespaces them `mcp__<serverIdCompact>__<toolName>`. `buildMcpTools` merges them into the agent's toolset in [`packages/shared/src/agent/tools.ts`](packages/shared/src/agent/tools.ts). Agent prompt bumped to `agent-v6-2026-05`.
- [x] MCP settings UI — `/app/team/mcp-servers` lists connected servers, lets admins enable/disable, shows tool inventory, supports a `Test call` button per tool.
- [x] Integration settings UI — `/app/team/integrations` renders the catalog (Drive/Linear/GitHub with SVG logos) + connected list with sync-now + disconnect + last-error inline. Timeline also surfaces a connections strip linking to Telegram and integrations.
- [x] Integration audit log + replay — every connect/sync/error writes a row in `integration_audit_log`, surfaced at `/app/team/integrations/audit` (admin-only); admin replay via `pnpm --filter @timeline/worker integration-resync -- --team=<uuid> [--from-zero]`.
- [x] Per-user MCP overlay — `mcp_servers.user_id` (migration `0015_phase11_mcp_user_overlay.sql`). Personal MCPs visible only to their owner, layered on top of the team-shared catalog. UI at [`/app/me/mcp-servers`](apps/web/src/app/app/me/mcp-servers/page.tsx); `McpClientManager` keys cache on `teamId:userId` for personal entries.
- [x] MCP server health ping — `mcp-health` BullMQ queue + worker at [`apps/worker/src/workers/mcpHealth.ts`](apps/worker/src/workers/mcpHealth.ts). 5-min repeatable, 10s timeout per server; updates `last_connected_at` / `last_error` without waiting on a chat turn.
- [x] OAuth refresh-on-expiry — `loadOauthAccessToken` ([`packages/shared/src/mcp/client.ts`](packages/shared/src/mcp/client.ts)) checks `expiresAt` (60s skew) and refreshes via `oauthRefreshToken` with persisted discovery + client info, re-encrypts, and surfaces `last_error` on failure. Per-(team, server) pending map dedups concurrent refreshes.
- [x] Inline reconnect UX — `McpNeedsReauthError` ([`packages/shared/src/mcp/client.ts`](packages/shared/src/mcp/client.ts)) propagates through `buildMcpTools` as `{ ok: false, error: 'needs_reauth' }`. Chat `ToolStep` ([`apps/web/src/components/chat/tool-step.tsx`](apps/web/src/components/chat/tool-step.tsx)) renders a "Reconnect <server>" CTA inline; non-admins see an "ask a team admin" hint instead.
- [x] **Timeline-as-MCP-server (outbound).** External agents (Claude Desktop, Cursor, etc.) can connect this Timeline as an MCP server. Endpoint [`/api/mcp/server`](apps/web/src/app/api/mcp/server/route.ts) speaks JSON-RPC 2.0 over streamable HTTP (`tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`); bearer auth via `tla_*` keys stored as SHA-256 hashes (migration `0016_phase11_mcp_outbound.sql`). Tools exposed: `timeline.search_events`, `get_event`, `list_events`, `get_entity`, `search_documents`. Outbound bearer keys never see `private` / `specific_users` events. Admins mint/revoke keys at [`/app/team/mcp-share`](apps/web/src/app/app/team/mcp-share/page.tsx). Wildcard CORS (Authorization-header auth so credentials-less). Setup walkthrough: [`docs/setup/integrations.html`](docs/setup/integrations.html).

## Phase 13 — Polish And Hardening

Beta-readiness gate. Keep this phase split into independently reviewable slices;
do not turn it into an enterprise compliance or billing pass. Usage tracking,
right-to-be-forgotten deletion workflows, and global operator dashboards stay
out of scope.

### Slice 13.1 — Timeline onboarding tutorial

- [ ] Add a dismissible onboarding checklist at the top of `/app/timeline`,
      since the timeline is the app's landing page.
- [ ] Track team-level completion with per-user dismissal. Any teammate
      completing a setup step marks it done for the team; each user can hide
      the checklist for themselves.
- [ ] Treat onboarding as a tutorial, not a proof-of-ingest flow. Configuring
      or opening the relevant surface is enough; do not require first
      successful external data arrival.
- [ ] Checklist steps: capture first note, connect Telegram, set up email
      forwarding, upload first document, connect first integration.
- [ ] Keep the checklist reopenable from a setup/help affordance in the app.

### Slice 13.2 — Visibility defaults and one-off edits

- [ ] Add source-specific visibility defaults with a team-wide fallback.
      Defaults apply only to future captures/imports.
- [ ] Sources needing explicit defaults: web text/audio capture, Telegram,
      email, documents, meetings, integrations, and later external calendars.
- [ ] Keep quick capture surfaces binary (`private` / `team`) for speed;
      support `specific_users` where member-picking already fits the workflow:
      documents, calendar events, meetings, integration defaults, and event
      detail/edit surfaces.
- [ ] Add an explicit `visibility_owner_user_id` concept for source-owned
      events instead of overloading attribution. Defaults: web capture =
      capturer, Telegram DM = linked user, Telegram group = group linker/source
      owner, email = verified team sender else source owner, documents =
      owner/uploader, meetings = scheduler, integrations = connector owner.
- [ ] Only the visibility owner can change an existing event's visibility.
      Admin/owner status does not grant access to private events and does not
      allow rewriting someone else's event visibility.
- [ ] Expanding or narrowing existing visibility is a one-off edit, not a bulk
      retroactive default change. Audit every visibility change.

### Slice 13.3 — Generic trust audit log

- [x] Add a generic append-only `audit_log` table for sensitive reads/actions
      going forward. Leave `integration_audit_log` as provider sync history.
- [x] Audit sensitive/security-relevant actions only: visibility changes,
      private/restricted event detail reads, private/restricted document
      view/download/signed URL generation, team export creation, job
      retries/dismissals, settings changes, and integration/MCP
      connect/disconnect. Current product surfaces write trust-audit rows for
      private/restricted event and document detail reads, document signed URL
      generation, document visibility changes, team settings changes,
      integration connect/disconnect/settings updates, custom MCP
      connect/disconnect/settings updates, and Timeline-as-MCP key
      mint/revoke. Future team export and job-dashboard slices should reuse
      the existing `team.export_create`, `job.retry`, and `job.dismiss`
      audit actions when those product paths land.
- [x] Do not audit every timeline page load, team-visible row impression, or
      ordinary search result preview.
- [x] Make audit log visible to team owners/admins only, while preserving
      visibility boundaries. If the viewer cannot see a private/restricted
      target, show redacted target labels and ids, not titles, filenames, body
      text, or snippets.
- [x] Retain audit rows indefinitely with no user-facing delete. Audit metadata
      must stay coarse and avoid raw sensitive content.

### Slice 13.4 — Team export job

- [ ] Build async team data exports as a background job with status (`queued`,
      `running`, `ready`, `failed`, `expired`) instead of a synchronous request.
- [ ] Owners/admins can export team-visible data and source-owned admin data,
      but cannot export other users' private/restricted content unless they are
      already allowed to see it.
- [ ] Generate a zip archive containing structured JSON/JSONL files such as
      `manifest.json`, `raw_events.jsonl`, `facts.jsonl`, `objects.jsonl`,
      `tasks.jsonl`, `documents.jsonl`, `document_versions.jsonl`,
      `integrations.jsonl`, `audit_log.jsonl`, `files.jsonl`, and
      `README.txt`.
- [ ] Include signed file URLs in `files.jsonl`, not binary blobs in the zip.
      Signed URLs and the export archive expire after 24 hours.
- [ ] Never export integration secrets/tokens in plaintext. Include an
      omissions summary/count for private or restricted records excluded from
      the export.
- [ ] Audit export creation and signed URL generation.

### Slice 13.5 — Team-scoped job dashboard

- [ ] Add a team-scoped product dashboard for owners/admins to recover failed
      or stuck jobs that affect their own team's data. Do not build a
      cross-team/internal operator dashboard in this phase.
- [ ] Surface product nouns, not BullMQ internals: transcription, extraction,
      embedding, document processing, meeting finalization, and integration
      sync.
- [ ] Provide retry UI only for idempotent jobs tied to visible team artifacts:
      raw-event transcription/extraction/embedding, fact/object/document
      chunk/calendar event embedding, document version extraction, meeting
      finalization, and integration sync.
- [ ] Provide an ignore/dismiss path for irrecoverable failures.
- [ ] Do not expose repeatable scheduler ticks, external webhook delivery
      failures, MCP health pings, or low-level jobs with no user-understandable
      target.

### Slice 13.6 — Pagination and caching

- [ ] Add cursor pagination for the timeline; no unbounded timeline query should
      remain on the main feed.
- [ ] Paginate object-page sections independently: events, facts, changes,
      tasks, and related records where needed.
- [ ] Paginate document search results/chunks.
- [ ] Introduce React Query selectively for interactive/paginated client-side
      server state: infinite timeline pagination, object section pagination,
      document search, job dashboard polling/retry status, and onboarding
      checklist refreshes.
- [ ] Keep simple RSC/server-action settings pages as-is; do not migrate the
      whole app to React Query.
- [ ] Add short-lived Redis caches for hot team/user/visibility-aware reads
      where useful. Cache keys must include `teamId`, `userId`,
      visibility-relevant filters, cursor/page params, and app version; no
      cache may bypass per-user visibility checks.
- [ ] Target correctness under large beta data first: roughly 50k+ raw events,
      10k+ facts, and 5k+ documents/chunks per team should remain usable.

### Slice 13.7 — Public help docs and support contact

- [ ] Build public Next.js help pages under `/help`, not repo-internal `docs/`.
      Use a lightweight dedicated docs layout with navbar, footer, theme
      toggle, links to the landing page, and auth-aware
      dashboard/sign-in/sign-up links.
- [ ] First help pages: capture surfaces, document drive, boards,
      integrations, object management, and a `/help` index.
- [ ] Help pages may link to live app routes for signed-in users. Logged-out
      users should see sign-in/sign-up CTAs instead of dead app links.
- [ ] Add a public support/contact form with request type (`technical_support`,
      `sales`, or similar), name, email, message, current page, and signed-in
      user/team context when available.
- [ ] Send support requests through Postmark to `SUPPORT_EMAIL` and store every
      request in a `support_requests` table so internal operators can inspect
      the DB. No in-app support admin UI is required for Phase 13.
- [ ] Protect public support forms with Cloudflare Turnstile in production, a
      honeypot field, and rate limits.

### Slice 13.8 — Standardized abuse-control rate limits

- [ ] Extend the typed rate-limit constants in
      `packages/shared/src/rate-limit/buckets.ts` so each public/expensive
      surface has an explicit named policy: signup, support form, AI chat,
      meeting scheduling, exports, document upload/finalize, and existing
      webhook buckets.
- [ ] Use Cloudflare Turnstile only on public or anonymous abuse surfaces:
      public support/contact and email/password registration. OAuth sign-up,
      signed-in chat, meetings, documents, integrations, and internal app forms
      rely on rate limits and existing quota/permission checks.
- [ ] Add `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `SUPPORT_EMAIL` env
      wiring and document the production behavior.
- [ ] Keep usage tracking, billing dashboards, and model-spend caps out of Phase
      13.

## Phase 14 — Backup And Operations

- [ ] RustFS backup cron service on Railway: nightly `rclone sync` to Backblaze B2 or chosen secondary store.
- [ ] Qdrant snapshot cron: nightly snapshot via Qdrant API, uploaded to RustFS or B2.
- [ ] Confirm Railway Postgres backup retention and document restore procedure.
- [ ] Run full restore drill from backups to a scratch environment. Repeat quarterly.
- [ ] Monitoring dashboards: Railway metrics, Sentry, worker queue depth, document processing failures, integration sync failures, OpenRouter spend.

## Phase 15 — Soft Launch

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
