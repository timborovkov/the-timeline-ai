# The Timeline — Calendar

Calendar state is approval-backed workspace memory. The agent can suggest one-off events, recurring series, occurrence changes, cancellations, and proposed time slots, but canonical calendar rows change only after a teammate accepts the suggestion.

<span id="mental-model"></span>

## Mental model

Calendar events are canonical workspace artifacts, separate from workspace objects and tasks. They are still part of the same suggestion review loop: when Slack, Telegram, email, meetings, or chat evidence says something should be scheduled, the product records a calendar suggestion with cited raw-event evidence. Accepting that suggestion creates or updates real `calendar_events` rows.

A calendar suggestion needs a concrete timed range or an all-day date span. If the evidence only implies future work without a schedule, it should become a task or object-memory suggestion instead of a placeholder calendar event.

<span id="workspace-timezone"></span>

## Workspace timezone

Each team has a workspace timezone stored in `team_calendar_settings.default_timezone`. Admins configure it from Team settings, and new teams initialize it from the creator's browser timezone when available with `Europe/Helsinki` as the product fallback. Existing teams that still carried the old implicit `UTC` default were backfilled to `Europe/Helsinki`. Timeline grouping and timestamps, calendar views, event defaults, saved meeting schedules, daily digests, and workspace-relative chat dates use this timezone unless a specific calendar event supplies its own `calendar_events.timezone`.

<span id="agent-suggestions"></span>

## Agent suggestions

The agent can propose these calendar changes from background extraction or chat tools:

- One-off meetings, deadlines, and all-day date-only commitments.
- Recurring event series using full RFC 5545 `RRULE` strings.
- Single-occurrence moves, edits, and cancellations for materialized recurring rows.
- `this_and_future` changes that split a recurring series from one occurrence onward.
- Grouped tentative slots for scheduling with customers or other third parties.
- Confirmation updates that keep the selected slot and cancel the alternatives.

Agent tools should report that a suggestion was recorded, not that an event was created. The accepted suggestion is the handoff point where the visible calendar changes.

Calendar approval cards may show resolution hints when a proposed create resembles existing calendar state. Non-proposal exact duplicates can reuse the existing event, but semantic matches are only explanatory: accepting a create does not move or rewrite a merely similar event. A real move, cancellation, or edit must be an update suggestion that targets the event explicitly.

<span id="due-dates"></span>

## Due dates

Task and follow-up due dates are mirrored to the team calendar as free due-date events. Timeline uses the assignee first, then the owner, as the responsible person for the inbox notification and calendar title. Suggested tasks do not notify anyone or appear on the calendar until a human accepts them.

Board item due dates use the board-local responsible person instead of the underlying object's owner or assignee. When that person is set, the in-app inbox receives a board-specific due-date notification, and the calendar event description includes the board name and responsible person so teammates can see who owns the deadline.

<span id="recurring-events"></span>

## Recurring events

Recurrence is stored on a parent event. The parent owns `startAt`, `endAt`, `timezone`, and `rrule`. A worker expands a rolling window of recent past and future occurrences into child rows with `recurringParentId` and `originalStartAt`.

For a daily call at 16:00 every day except Saturday, the canonical schedule is a recurring parent with an RRULE such as `FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SU`. If the team later agrees to move tomorrow's call to 15:00, the suggestion should target tomorrow's materialized occurrence with `recurrenceEditMode: "single"`. Re-expansion preserves that exception and does not recreate the original 16:00 row for that date.

Whole-series edits update the parent and rematerialize active child rows. A shared series lock remains held until both changes commit, so concurrent approval or direct edits cannot interleave with the rebuild. A `this_and_future` edit ends the old parent before the changed occurrence, creates a new parent for the future schedule, preserves finite `COUNT` semantics where applicable, and rematerializes the new window.

<span id="tentative-slots"></span>

## Tentative slots

Proposed slots are visible calendar holds after approval. For example, if the team proposes five Apple meeting times, accepting the suggestion creates five events with `showAs: "tentative"` and shared proposal-group metadata. They should look tentative in the UI and should not pretend the meeting is confirmed.

When later evidence confirms one slot, the confirmation suggestion updates the chosen event to confirmed busy time, changes its title from a proposal label to the actual meeting title, and cancels the sibling tentative events in the same group. The sibling raw audit events are tombstoned and their vector points are deleted so search and calendar context stop treating the old options as active.

<span id="calendar-subscriptions"></span>

## Calendar subscriptions

Each member can create a read-only calendar subscription URL for their Timeline calendar. The URL is a bearer credential: it is shown only when created or reset, can be disabled at any time, and exports the subscriber's visible calendar surface without cookies.

Subscription feeds include team events, the subscriber's private event details, authorized specific-user events, and other members' private events only as redacted busy blocks. Materialized recurring occurrences export as individual feed events, so external calendar apps see the concrete schedule in the current materialization window. Tentative holds export as tentative iCalendar events instead of confirmed meetings.

<span id="manual-editing"></span>

## Manual editing

The calendar UI offers common recurrence presets, with raw RRULE input inside Advanced repeat rule. All-day forms ask for the first and last included days; the UI converts the last day to an exclusive end boundary when saving. Event deletion requires confirmation naming the event and selected recurrence scope; cancellation leaves it unchanged. Event details show recurrence and tentative status, and editing a recurring occurrence asks whether the change applies to this event, this and all future events, or the whole series.

The page leads with the calendar grid, then shows an infinite-scrolling event list. The list starts on upcoming events from today, supports past and all-event scopes, and searches event title, description, location, or redacted busy blocks through the team-scoped calendar query. These scopes cover the rolling list window of two years before and after today, so `eventScope=all` means all events in that window rather than the full historical archive. Past and future buckets are separated by event start time, while the all-event scope includes any event intersecting the rolling window. The list state is shareable through `eventScope=past|all` and `eventQ` URL parameters.

The Timeline is the historical activity surface, so its default query ends at the current instant even though recurrence workers materialize later occurrences. Teammates can opt in to a bounded seven-day upcoming Timeline view; longer future schedules belong here on the Calendar page. Timeline date filters and infinite scroll enforce the same seven-day future cap. In Moments mode, identical calendar scheduling, update, or cancellation notices with the same action, actor, access scope, and minute appear as one moment, including notices spanning raw-event pages. The inspector retains every source event; actual scheduled occurrences remain distinct, and All events retains the individual audit entries. Renaming a derived scheduling mirror retains its previous notice references so saved links and personal pins continue to resolve under the current visibility rules.

Manual edits use the same recurrence modes as accepted suggestions: `single`, `series`, and `this_and_future`. This keeps direct calendar edits and agent-approved edits consistent.

<span id="implementation-reference"></span>

## Implementation reference

- Shared calendar behavior lives in `packages/shared/src/calendar/scope.ts` and `packages/shared/src/calendar/recurrence.ts`, with raw timeline event helpers in `packages/shared/src/calendar/raw-events.ts`. The scoped calendar port exposes `listCalendarEventPage` for the searchable event list in addition to the grid-oriented `listCalendarEvents` range query.
- Task and board due-date calendar mirroring lives in `packages/shared/src/calendar/due-dates.ts`.
- Calendar suggestion acceptance lives in `packages/shared/src/suggestions/index.ts`.
- Recurrence materialization is queued through `calendar-recurrence` and handled by `apps/worker/src/workers/calendarRecurrence.ts`.
- Manual calendar controls live in `apps/web/src/components/calendar/calendar-view.tsx`. Folded calendar approvals reuse `apps/web/src/components/approvals/approvals-client.tsx`.
- Read-only subscription URLs are managed by `apps/web/src/components/calendar/calendar-subscription-panel.tsx` and served from `apps/web/src/app/api/calendar/feed/[token]/route.ts`.
