# The Timeline

A team workspace that captures everything — messages, voice, email, documents, meetings — into a single searchable timeline with an AI agent that can retrieve, extract, and act on it.

## Language

### Core primitives

**Raw Event**:
An immutable record of something that happened. Every content surface (text, voice, email, document, meeting, calendar) writes raw events. The timeline is a view over raw events.
_Avoid_: log entry, activity

**Entity**:
A durable, typed workspace object (person, company, project, deal, task, follow-up, etc.) tracked on the `entities` table. Entities have status, stage, priority, owner, assignee, and are the unit of board views and object pages.
_Avoid_: object (ambiguous with generic programming), record, item

**Fact**:
A structured piece of knowledge extracted by the LLM from a raw event (e.g. "Acme's contract renews in March"). Linked to entities via `fact_entities`.
_Avoid_: insight, finding

**Visibility**:
Per-row access control. Three levels: `private` (author only), `team` (all members), `specific_users` (named UUIDs). Applied uniformly on raw events, entities, documents, meetings, and calendar events.
_Avoid_: permissions, access level

### Calendar

**Calendar Event**:
A time-anchored record in the `calendar_events` table (new first-class table, NOT an entity). Has start/end timestamps, IANA timezone, visibility, optional recurrence, and optional links to entities. Produces two **Raw Events**: one at creation time ("scheduled"), one at the event's start time ("event"). Private calendar events are opaque to teammates — they see a "busy" block (time + owner, no content) rather than nothing.
_Avoid_: appointment, meeting (reserved for meeting-bot captures)

**Recurring Event (parent)**:
A **Calendar Event** with an RFC 5545 `rrule`. A worker materializes individual occurrences as child **Calendar Event** rows on a 3-month rolling window. The parent is never rendered directly — only its materialized children appear on the calendar and timeline.
_Avoid_: repeating event, series

**Occurrence**:
A materialized child of a **Recurring Event**. Linked via `recurring_parent_id` FK. Identified by `original_start_at` (stable even if rescheduled). Can be marked `is_exception` when manually edited — re-expansion skips exceptions.
_Avoid_: instance

**Connected Calendar**:
An external calendar (Google Calendar or any CalDAV provider) linked by a user. Import-only for MVP — events sync into `calendar_events` with `source='google'`/`source='caldav'`. Can be marked `private`, which imports all events with `visibility='private'`. Push-to-external is a post-MVP follow-up.
_Avoid_: synced calendar, linked calendar

**Tombstone**:
A marker on a **Raw Event**'s `sourceMetadata` indicating the source **Calendar Event** was deleted externally. The timeline preserves history ("this meeting was cancelled") rather than erasing it.
_Avoid_: deleted marker, cancellation flag

### Notifications

**Reminder**:
A time-based alert before a **Calendar Event** starts. Cascades: team default (`team_calendar_settings.default_reminder_minutes`) → per-event override. Fired by a dedicated 5-minute-loop worker, not per-event scheduled jobs.
_Avoid_: alarm, alert

**Daily Digest**:
A morning summary of today's upcoming **Calendar Events** for a user. Delivered via the user's chosen channel(s): inbox, email, and/or Telegram. Delivery channel preferences are platform-wide (not calendar-specific).
_Avoid_: daily summary, morning briefing

## Flagged ambiguities

**"Meeting" vs "Calendar Event"**: A **Meeting** is a Recall.ai bot capture (Phase 10) — it has transcript chunks, a bot lifecycle, speaker attribution. A **Calendar Event** is a time slot on the calendar. A meeting-bot session may be *linked to* a calendar event, but they are distinct tables with distinct lifecycles. Do not conflate them.

## Example dialogue

> **Dev**: When a user creates a recurring standup, what actually happens in the DB?
>
> **Domain expert**: You get one **Recurring Event** row with the RRULE — that's the parent. The materialization worker expands it into **Occurrence** rows for the next 3 months. Each occurrence is its own **Calendar Event** row with a `recurring_parent_id` pointing back. Each one also produces two **Raw Events** — one for "scheduled" and one at the actual start time — so they show up on the timeline.
>
> **Dev**: What if someone edits just next Tuesday's standup?
>
> **Domain expert**: That occurrence gets `is_exception = true`. When the worker re-expands (say the parent's time changed), it skips exceptions. The edited occurrence keeps its modifications.
>
> **Dev**: And if Sarah looks at Tim's calendar and Tim has a private dentist appointment?
>
> **Domain expert**: Sarah sees a "busy" block — she knows Tim has something from 2-3pm but can't see the title or description. Tim's agent can see the full event because `private` visibility means "only the author sees content." The calendar endpoint does application-layer redaction for other users.
