# The Timeline - Build Plan

Ordered roadmap. Keep this file short: shipped work is summarized, open work is
actionable.

## Current Status

The product baseline through Phase 13 is largely shipped: foundations, capture
surfaces, workers, extraction, embeddings, agent chat, objects/boards/tasks,
documents, meeting bots, calendar basics, integrations/custom MCPs, Slack,
onboarding, visibility controls, exports, job recovery, public help/legal, and
approval-backed object memory.

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

## Calendar

### Recurrence

- [ ] Add recurring event schema support: parent `rrule`, materialized
      occurrence rows on a 3-month rolling window, `recurring_parent_id`,
      `original_start_at`, and `is_exception`.
- [ ] Add recurrence expansion worker and re-expansion semantics: "this event"
      marks an exception; "this and all future" deletes and re-expands
      non-exception children from the chosen occurrence onward.
- [ ] Add recurring event editing UI with "this event", "this and all future",
      and "all events" modes, plus an exception badge on modified occurrences.

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
- [ ] Add daily event digest per user. Delivery should reuse platform-level
      preferences and support inbox notification, email, and/or Telegram.
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
