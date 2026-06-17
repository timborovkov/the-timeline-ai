# The Timeline - Build Plan

Ordered roadmap. Keep this file short: shipped work is summarized, open work is
actionable.

## Current Status

The product baseline through Phase 13 is largely shipped: foundations, capture
surfaces, workers, extraction, embeddings, agent chat, objects, curated boards,
tasks, documents, meeting bots, calendar basics/subscriptions,
integrations/custom MCPs, Slack, onboarding, visibility controls, exports, job
recovery, public help/legal, and approval-backed object and board memory.

This file now tracks only remaining work and recurring operating obligations.
Use the repository history, release notes, and phase PRs for shipped
implementation detail.

## Beta Readiness

- [ ] Audit the remaining security-relevant actions that landed after the
      generic `audit_log`: team export creation/download, job retry, and job
      dismissal should use the existing `team.export_create`, `job.retry`, and
      `job.dismiss` audit action names.
- [ ] Add per-team monthly vision-spend caps and a dashboard. Vision OCR is much
      more expensive than text extraction; teams need a clear budget guardrail
      before heavy PDF/image dogfooding.
- [ ] Add dogfood document content: contracts, deal docs, internal guides,
      policies, office rules, onboarding docs, and customer notes.
- [ ] Surface meeting bot failed states in the operations/job dashboard with a
      useful retry or rejoin path. Failed meetings are already captured as
      `meetings.status='failed'`.

## Workspace Reconciliation

- [ ] Wire workspace reconciliation into future authoritative external sync
      paths when calendar/provider imports directly update artifacts they own.

## Boards

- [ ] Strengthen board-agent behavior after real usage: board-scoped answers
      should cite evidence, distinguish accepted board state from pending
      suggestions, and direct commands should apply unambiguous board updates
      through the same permission and audit paths as manual board edits.

## Object Relationships

- [ ] Finish the scoped plan in
      [docs/object-relationships-plan.md](docs/object-relationships-plan.md).
- [x] Add the first live Connected Work surface to object detail pages so
      source-backed open work, recent completed work, calendar events, and
      repeated people/object context appear before durable relationships are
      accepted.
- [x] Use supporting object evidence to suggest short-name/acronym duplicate
      object candidates such as `DFK` / `DFK Finland Oy`, while keeping bare
      three-letter name similarity below the proposal threshold.
- [x] Have the suggestion worker propose approval-backed `related` object
      relationships from relationship-shaped evidence, using extracted facts as
      candidate input and bounded raw/conversation context for verification.
- [x] Support relationship proposal bundles that create missing endpoint
      objects and the relationship together when each object independently
      qualifies as durable information, using bundle-local refs and ordered
      acceptance so `Accept all` creates endpoints before applying the link.
- [x] Surface accepted and pending relationships on both object detail pages,
      with relationship activity and evidence available nearby while cited
      per-edge explanations remain part of the later graph/mind-map slice.
- [x] Replace manual UUID relationship linking with object search/select in the
      object detail UI.
- [x] Collapse the generic `linked` relationship kind into `related`, migrate
      existing rows, remove `linked` from UI/tool inputs, and dedupe symmetric
      `related` relationships/proposals by sorted object pair while preserving
      direction for directional relationship kinds.
- [x] Expand Connected Work beyond the first slice with boards, pending
      approvals, and documents ordered by object-page usefulness.
- [x] Add timeline moments to Connected Work so source-backed event context
      appears after active work and before document context.
- [x] Add object-centered Memory Repair entry point on object detail pages that
      queues duplicate and low-signal archive cleanup focused on the selected
      object while preserving rejected-pair suppression.
- [x] Extend object-centered Memory Repair beyond duplicate cleanup so it can
      queue focused fact-backed relationship proposals without reoffering
      rejected edges.
- [x] Extend object-centered Memory Repair to create missing full-name
      person-object relationship bundles when connected evidence names a
      durable person not yet in object memory.
- [x] Keep object-page pending approval dependencies available for relationship
      proposals without surfacing unrelated bundle items, and render
      relationship/person rows with readable endpoint names instead of raw refs.
- [x] Strengthen relationship/person proposal generation from Connected Work so
      operationally useful task/company, decision/company, and person/company
      connections graduate into approval-backed object memory.
- [ ] After object relationships have real usage, design a graph/mind-map view
      with filters, density controls, and cited edge explanations. Do not ship
      the full graph in the first relationship implementation slice.

## Object Summaries

- [x] Ship the first scoped implementation from
      [docs/object-summaries-plan.md](docs/object-summaries-plan.md): persisted
      structured generated summaries, team-visible source packets, background
      refresh from canonical object/fact updates, object-page generation/retry,
      search and embedding updates, and chat retrieval consumption with
      underlying-source citations.
- [x] Finish remaining summary polish after dogfooding: indirect linked-task
      invalidation and deeper source-chip navigation for facts, relationships,
      object changes, notes, tasks, and timeline events.

## Calendar

### Recurrence

- [x] Add recurring event schema support: parent `rrule`, materialized
      occurrence rows on a recent-past/future rolling window, `recurring_parent_id`,
      `original_start_at`, and `is_exception`.
- [x] Add recurrence expansion worker and re-expansion semantics: "this event"
      marks an exception; "this and all future" deletes and re-expands
      non-exception children from the chosen occurrence onward.
- [x] Add recurring event editing UI with "this event", "this and all future",
      and "all events" modes, plus an exception badge on modified occurrences.
- [x] Extend approval-backed calendar suggestions so recurring events,
      tentative proposed slots, confirmed-slot updates, and occurrence-level
      reschedules materialize through the same approval path as tasks and
      objects.

### External Sync

- [ ] Add `connected_calendars`: per-user provider connection, encrypted OAuth
      or CalDAV credentials, selected calendars, privacy flag, sync cursor, last
      sync state, and default imported-event visibility.
- [ ] Add Google Calendar import: OAuth 2.0, incremental `syncToken`, and push
      notifications for near-real-time import.
- [ ] Add generic CalDAV import for iCloud, Fastmail, Nextcloud, Synology, and
      similar providers. Use polling because CalDAV has no universal push
      mechanism.
- [ ] Import external events as native `calendar_events` with provider source,
      `external_event_id` deduplication, and private visibility for private
      connected calendars.
- [ ] Preserve external deletions as soft-deleted calendar events with
      cancellation/tombstone raw-event metadata.
- [ ] Post-MVP: optionally push internal Timeline events to connected Google
      Calendar. Timeline remains authoritative; outbound push is best-effort.

### Reminders

- [ ] Add a stateless reminder worker on a 5-minute BullMQ repeatable. Query
      events whose reminders are due in the next window and fire notifications.
- [ ] Implement reminder cascade: team default
      `team_calendar_settings.default_reminder_minutes`, overridden by
      per-event `calendar_events.reminder_minutes`.
- [x] Add daily event digest per user. Delivery uses the shared messaging
      module, stores a dashboard-readable digest payload, sends email only for
      the digest, supports per-user opt-out in Team settings, and keeps
      individual in-app notifications inbox-only.
- [ ] Extend overdue/missed alerts to calendar events past `start_at` with no
      attendance or completion signal.

## Backup And Operations

- [ ] Add a RustFS backup cron service on Railway: nightly `rclone sync` to
      Backblaze B2 or the chosen secondary object store.
- [ ] Add a Qdrant snapshot cron: nightly snapshot via the Qdrant API, uploaded
      to RustFS or B2.
- [ ] Confirm Railway Postgres backup retention and document the restore
      procedure.
- [ ] Run a full restore drill from backups to a scratch environment. Repeat
      quarterly.
- [ ] Build monitoring dashboards for Railway metrics, Sentry, worker queue
      depth, document processing failures, integration sync failures, meeting
      bot failures, and OpenRouter spend.

## Soft Launch

- [ ] Run a closed beta with 3-5 friendly teams and weekly feedback sessions.
- [ ] Instrument capture friction: time from "open app" to "event recorded."
      Target under 10 seconds for text and under 15 seconds for voice.
- [ ] Instrument agent answer quality with thumbs up/down. Target greater than
      85% positive.
- [ ] Instrument object usefulness: teams should manually or automatically
      update tracked objects every workday.
- [ ] Instrument document usefulness: internal-policy/document questions should
      return cited answers from the correct document version.
- [ ] Iterate on extraction prompts based on misses, then re-extract historical
      events as prompts improve.
- [ ] Decide pricing model: per seat, per team, usage-based, or hybrid.

## Standing Items

- [ ] Verify backups weekly and run restore drills quarterly.
- [ ] Monitor Qdrant RAM usage and plan a move to sharded or managed Qdrant
      before it becomes painful.
- [ ] Maintain an OpenRouter spend dashboard with per-feature cost tracking.
- [ ] Rotate API keys quarterly.
- [ ] Audit team isolation on every schema, integration, MCP, or data-access
      change.
- [ ] Test re-extraction and re-embedding procedures quarterly, even when not
      urgently needed.
- [ ] Keep Dockerfiles and `railway.json` in sync with deployed reality.
- [ ] Keep org-wide searchable embeddings complete for every team-scoped content
      surface: raw events, facts, entities, objects, object notes, object
      changes, documents, document chunks, meeting transcript chunks, meeting
      summaries, integration events, calendar events, and optionally chat
      messages. Verify with periodic row-count vs. Qdrant payload audits.
