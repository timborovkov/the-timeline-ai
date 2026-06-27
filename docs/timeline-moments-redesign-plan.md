# Timeline Moments Redesign Plan

## Goal

The Timeline browser should feel like a clear chronological record of work,
not a raw activity log. Source events remain immutable and fully inspectable,
but the default UI should show **moments**: human-meaningful bundles that answer
"what happened?", "why might it matter?", and "what evidence backs it?"

This plan covers the full transformation of `/app/timeline`: event grouping,
AI-assisted summaries, source-specific rules, future integration support, UI
composition, rollout, and verification.

## Current Problem

The existing timeline already has a `TimelineMoment` layer, but the screen still
reads like normalized event storage:

- High-volume integration events appear as first-class rows, especially GitHub
  workflow runs, PR updates, reviews, and commits.
- Row metadata exposes provider event types, object IDs, author labels, source
  counts, and visibility before the user understands the substance.
- The inspector is useful for provenance, but its language is internal:
  "Why this row exists" and "Source details" feel like debug labels.
- Rows are visually flat and dense in the wrong way: the rail exists, but the
  moment title is not strong enough to make the page scan as a timeline.
- Future sources will make the flood worse unless the product has a source
  adapter contract for grouping and display.

The redesign should keep the Operational Archive identity from `design.md`, but
move technical evidence into the evidence layer instead of making it the first
reading path.

## Fit With Current System

This redesign is not a separate product surface. It is a shared projection over
existing evidence and workspace state. The current system already has most of
the ingredients:

- raw events for immutable source evidence
- `TimelineMoment` logic for first-pass grouping
- artifact clusters for cross-source work artifacts
- impact items for tasks, boards, objects, documents, calendar rows, decisions,
  and approvals
- native integration metadata from provider adapters
- timeline/event search for chat agents
- object summaries, object relationships, digests, handoffs, and updates that
  already need cited source context

The rework should become the missing middle layer:

```text
raw events
  -> source clusters / artifact clusters
  -> timeline moments
  -> UI, chat agents, digests, handoffs, object pages, outbound MCP
```

The important boundary: moments are a **projection**, not a new source of truth.
Raw events remain the receipt. Artifact clusters and approval-backed workspace
state remain the durable interpretation layer. Moment presentation makes the
record readable and retrievable.

## Overlaps And Ownership

Several existing plans and modules touch the same territory. The redesign should
clarify ownership rather than duplicate behavior.

| Area | Existing owner | Redesign relationship |
| --- | --- | --- |
| Raw timeline evidence | `withTeam(...).timeline` raw event reads/search | Moments sit above raw reads; raw event search remains available for audit/debug. |
| Artifact clusters | Artifact reconciliation and provenance ADRs | Moments read cluster associations and related evidence; they do not decide canonical artifact state. |
| Workspace reconciliation | Approval-backed object/task/calendar reconciliation | Reconciliation can use moments as context packets, but state changes still flow through approvals or authoritative provider sync. |
| Object summaries | Object summary generation/search/chat retrieval | Object summaries may consume moments as compact evidence packets, but cite raw events underneath. |
| Object relationships | Connected Work, relationship proposals, graph plans | Object pages can show moment context around an object; relationships remain their own approval-backed memory. |
| Integration ingest | Provider adapters and `writeIntegrationEvents` | Providers must emit enough grouping metadata for moments; timeline UI should not reverse-engineer provider semantics from noisy strings. |
| Agent dashboard/retrieval | Shared agent tools and retrieval planner | Agents should search moments first for normal questions, then expand raw event evidence for citations. |
| Design system | `design.md` Timeline rules | The visual direction fits the operational surface rules; update `design.md` only when implementation changes row/inspector patterns. |
| Ingest webhooks | Evidence-only webhook plan | Webhooks get source/time/object grouping, but remain non-authoritative unless another approval/provider path promotes state. |

The biggest overlap is with agent retrieval. Today the agent plan names
`search_timeline_events`; after this redesign, raw event search should become
the advanced/audit path while moment search becomes the normal retrieval path
for "what happened?" questions.

## Product Principles

1. **Moments by default, source events on demand.** The first screen shows
   bundled work moments. The raw event log is still available as an advanced
   view and through the inspector.
2. **Deterministic grouping before AI.** Stable metadata, provider IDs, thread
   IDs, timestamps, and artifact clusters decide the initial bundle. AI can
   summarize or suggest cross-source relationships, but it must not be the only
   reason unrelated events are grouped.
3. **AI writes labels, not history.** AI-generated titles and summaries are
   presentation artifacts with citations. They do not rewrite raw events or
   become canonical workspace state.
4. **Evidence stays structural.** Every moment exposes source count, source
   types, authoritative evidence, related evidence, and raw event links.
5. **Impact beats plumbing.** If a moment touched a task, board item, object,
   document, calendar event, decision, approval, incident, PR, or deal, that
   consequence is more important than the provider webhook name.
6. **Future sources plug into the same contract.** New adapters define grouping
   keys, display labels, impact hints, and evidence roles rather than adding
   one-off UI rules.
7. **Team isolation and visibility are non-negotiable.** Moment building must
   use `withTeam(db, teamId, userId)`, respect event visibility, and never leak
   redacted or private impact context through a grouped row.
8. **Agents consume the same projection.** Chat, search, digests, handoffs, MCP
   answers, and evals should retrieve moment summaries plus cited raw events
   from the same team-scoped projection the UI uses, not scrape presentation
   strings or reimplement their own bundling rules.

## Terminology

| Term | Meaning |
| --- | --- |
| Raw event | Immutable source row captured from web, chat, email, meetings, documents, calendar, integrations, or webhooks. |
| Source cluster | Deterministic bundle of raw events from the same source family and grouping key, such as a Telegram time window or GitHub PR. |
| Moment | User-facing timeline row. Usually backed by one source cluster, sometimes by a deterministic artifact cluster plus related source clusters. |
| Artifact cluster | Evidence-backed bundle for a real-world work artifact, such as a PR, incident, contract, deal, task, or scheduling thread. |
| Source evidence | Raw event snippets and metadata that prove why the moment exists. |
| Impact | Workspace consequences: objects, tasks, boards, documents, decisions, approvals, calendar items, incidents, deals, releases, or follow-ups. |
| Source event view | Advanced view that lists raw source events exactly as captured. |

## Target Experience

The default timeline should scan like this:

```text
TODAY

18:04-18:32  GitHub
             CI passed for audit-ai PR #292
             3 workflow runs · PR #292 · 1 related review
             Impact: Pull request · Fix scoping tie-out extraction
             Evidence: 5 events

16:06-16:09  Telegram
             Scheduling thread about the next meeting
             AuditAI · Tim, Mikael, Otto · 12 messages
             "Done / 16.20-16.30 asti vapaa..."
             Evidence: 12 messages

15:58        Meeting
             Internal daily call captured without transcript
             Notetaker joined · transcript unavailable
             Impact: Meeting record
             Evidence: 1 event
```

Clicking a row opens an inspector that reads:

```text
MOMENT
Scheduling thread about the next meeting

EVIDENCE SUMMARY
Telegram · AuditAI · 12 messages · 3 senders · 16:06-16:09

SOURCE EVIDENCE
[message cards, capped with overflow]

IMPACT
[calendar/task/object/document links when present]

TECHNICAL DETAILS
[provider IDs, visibility controls, raw metadata, audit controls]
```

## Information Architecture

### Timeline Modes

The route should support two top-level modes:

| Mode | Purpose | Default |
| --- | --- | --- |
| Moments | Human-readable bundled timeline for daily use. | Yes |
| Source events | Raw event log for debugging, audit, and power-user filtering. | No |

The mode switch should be local to `/app/timeline` and persist per user. The
source event mode can initially reuse much of the existing row treatment, but
should be visually labeled as advanced.

### Filters

Keep the current preset filters, but make them operate on moments:

- All
- Chat
- Meetings
- Email
- Documents
- Calendar
- Integrations

Add advanced filter categories behind the existing filter panel:

- Exact source: Telegram, Slack, GitHub, Linear, Google Drive, Monday.com,
  Sentry, ingest webhook, future providers.
- Impact: task, board, object, calendar, document, decision, approval, incident,
  deal, release.
- Evidence role: authoritative, supporting, conflicting, mention-only.
- Confidence: deterministic, AI-suggested, user-confirmed.
- Visibility: team, private, specific users.
- Moment kind: conversation, meeting, code review, CI/deploy, incident,
  document change, calendar change, CRM update, support thread.

### Inspector

Rename and reorganize inspector sections:

| Current | New |
| --- | --- |
| Why this row exists | Moment |
| Source truth | Evidence summary |
| Impact context | Impact |
| Source evidence | Source evidence |
| Source details | Technical details |
| Event controls | Controls |

Technical details should be collapsed by default for non-error rows. Evidence
and impact should be open by default.

## Data Model Strategy

### Short-Term: Computed Moments

Start by enriching the current computed `TimelineMoment` projection in
`apps/web/src/lib/timeline-moments.ts`. This gives a fast UI improvement without
schema changes.

Add fields to the computed shape:

```ts
interface TimelineMoment {
  id: string;
  kind: TimelineMomentKind;
  title: string;
  subtitle: string | null;
  preview: string | null;
  confidence: 'deterministic' | 'ai_suggested' | 'user_confirmed';
  grouping: {
    strategy: string;
    key: string;
    sourceFamilies: string[];
  };
  evidenceSummary: {
    rawEventCount: number;
    sourceLabels: string[];
    actorLabels: string[];
    contextLabels: string[];
    timeRange: string;
  };
}
```

The current `summary` can remain during migration, but the UI should move to
`title`, `subtitle`, and `preview`.

### Medium-Term: Persisted Moment Presentation

Persist only presentation metadata that is expensive or AI-generated:

- `moment_key`
- `team_id`
- `title`
- `summary`
- `model`
- `prompt_version`
- `source_event_ids_hash`
- `generated_at`
- `stale_at`
- `confidence`

Do not persist a separate canonical "moment event" that replaces source events.
The persisted row is a cache of presentation, not a new source of truth.

### Long-Term: Source Adapter Contract

Every source family should implement or describe:

```ts
interface TimelineSourcePresentationAdapter {
  sourceFamily: string;
  exactSources: string[];
  groupingKey(event: TimelineEvent): string | null;
  groupingWindow?: { minutes: number };
  momentKind(eventGroup: TimelineEvent[]): TimelineMomentKind;
  deterministicTitle(eventGroup: TimelineEvent[]): string | null;
  subtitle(eventGroup: TimelineEvent[]): string | null;
  preview(eventGroup: TimelineEvent[]): string | null;
  impactHints(eventGroup: TimelineEvent[]): ImpactItem[];
  evidenceRole(event: TimelineEvent): EvidenceRole;
}
```

This adapter can live in `apps/web/src/lib/timeline-moments.ts` first, then move
to `packages/shared` before agents, digests, workers, or outbound MCP use the
same projection. The UI should not become the owner of timeline semantics.

## Grouping Pipeline

The moment-building pipeline should run in this order:

```text
visible raw events
  -> source-specific deterministic grouping
  -> parent/thread attachment
  -> artifact-cluster association
  -> impact hydration
  -> deterministic title/subtitle/preview
  -> AI title/summary only when deterministic text is weak
  -> UI moment rows
```

### Step 1: Visible Raw Events

All input events must already be filtered by team and viewer visibility. Never
group hidden private events into a visible moment count. If a hidden event
belongs to the same provider object, the visible user should see only:

```text
Evidence: 3 visible events
```

Do not show "5 events, 2 hidden" unless the product explicitly has a redaction
language for that viewer.

### Step 2: Deterministic Source Grouping

Use source metadata first:

- parent raw event ID
- provider object ID
- thread ID
- channel/chat/mailbox ID
- calendar event ID
- document ID
- meeting ID
- external URL or canonical object URL
- artifact cluster ID
- bounded time windows for chat/webhook streams

### Step 3: Artifact Association

If several source clusters belong to the same artifact cluster, keep them as
separate moments unless the artifact relationship is strong enough to improve
the timeline.

Default rule:

- Same source + same artifact + close time: merge.
- Different source + same authoritative artifact: merge only for compact daily
  narrative surfaces, not for audit mode.
- Different source + weak related evidence: keep separate and show `Related`.

### Step 4: Impact Hydration

Hydrate impact after grouping so the row can say what changed. Existing
`scope.timeline.listImpactItems(eventIds)` is the right direction, but it should
support moment-level event IDs and richer impact kinds over time.

### Step 5: Presentation

Generate title/subtitle/preview in this order:

1. Source-specific deterministic formatter.
2. Artifact title or object title.
3. AI-generated presentation cache.
4. Safe fallback: current source label plus summarized event content.

## Companion Work

The timeline rework should ship with a small set of adjacent changes. Without
these, the UI can look better while agents, digests, or integrations keep using
the old noisy event model.

### Shared Projection Boundary

Move stable moment-building semantics toward `packages/shared` as soon as the
first UI slice proves the shape. `apps/web` can prototype the presentation, but
the source grouping contract should not remain web-only once chat, digests,
handoffs, workers, or outbound MCP need it.

Required companion changes:

- define a shared `TimelineMoment` or `TimelineMomentDto` shape
- expose team-scoped list/search/expand methods under the timeline scope
- keep UI-only hydration such as signed audio URLs in the web layer
- keep agent retrieval snippets and citation expansion in shared/server code

### Integration Metadata Bar

Every native provider adapter should emit enough metadata for moment grouping.
The minimum useful bar:

- provider
- event type
- external object ID
- external object URL
- resource type and human resource name
- actor
- authoritative/supporting evidence role where known
- provider-specific identifiers such as PR number, issue key, workflow run ID,
  deployment ID, monitor ID, ticket ID, deal ID, document/page/file ID

Provider metadata tests should fail when a high-volume integration event lacks
the grouping fields needed to avoid timeline floods.

### Agent Retrieval Parity

Chat agents, Slack/Telegram ask surfaces, background proposal agents, digests,
handoffs, and updates should all be able to retrieve moments. The retrieval
planner should prefer moments for normal narrative questions, then expand raw
events only for evidence.

Required companion changes:

- moment search tool or `mode='moments'` on existing timeline search
- moment expansion tool for citations and inspector-style evidence
- evals proving moment retrieval improves noisy GitHub/chat/webhook questions
- privacy tests proving hidden events do not leak through moment summaries,
  counts, or related evidence

### Raw Event Escape Hatch

Do not remove the raw event log. It should become explicit:

- UI mode: `Moments | Source events`
- agent path: `search_timeline_moments` for normal questions,
  `search_timeline_events` for audit/debug
- inspector path: source evidence cards link to exact raw event anchors

This keeps the product honest: moments make the archive readable, but raw events
make it auditable.

### Demo And Seed Coverage

The local seed and demo script should include enough clustered evidence to prove
the redesign:

- GitHub PR with workflow runs, review, commit, and status updates
- Telegram or Slack burst with multiple senders
- meeting with transcript unavailable or generated summary
- document attachment promoted into document evidence
- at least one related artifact cluster connecting conversation and integration
  evidence

Without this, contributors will test the UI against thin one-event examples and
miss the actual problem.

### Design System Sync

The current visual direction fits `design.md` because Timeline is already an
operational surface with indexed rows and an inspector. Update `design.md` only
when implementation changes reusable patterns, such as:

- moment row anatomy
- inspector section names/order
- raw event mode treatment
- evidence chip behavior
- source marker/rail styling

### Observability And Debugging

Moment grouping needs debug visibility because bad grouping is easy to miss.
Add a collapsed inspector/debug area or dev-only diagnostics showing:

- grouping strategy
- grouping key
- source adapter used
- raw event IDs included
- AI presentation cache key/version when present
- fallback reason when deterministic or AI presentation failed

This should be visible enough for support and dogfooding without turning the
main row back into a technical log.

## Source-Specific Rules

### Web Notes

Group by:

- individual event by default
- explicit parent event when present
- same author + same object/task/document reference + short time window

Display:

- title from first sentence or explicit object/task title
- preview from body
- impact from attached object/task/document metadata

Edge cases:

- Long pasted text should be line-clamped and available in inspector.
- Multiple captures in one minute should not merge unless they share a target
  object or parent.

### Telegram

Group by:

- `tg_parent_raw_event_id` when present
- chat ID + 15-minute window
- sender cluster within chat when no better thread exists

Display:

- title from AI when 3+ messages or multiple senders
- deterministic fallback: `Telegram thread in {chat}`
- subtitle: chat name, senders, message count, time range
- preview: strongest first message or AI one-sentence summary

Edge cases:

- Emoji-only or short acknowledgement bursts should collapse into the thread,
  not become standalone moments.
- Edited/deleted messages should stay in evidence with status, but the title
  should not oscillate on every edit.
- Attachments should show document/image/audio preview chips when available.
- Languages should be preserved. Do not translate source text unless the user
  requests translation.

### Slack

Group by:

- channel ID + thread timestamp
- parent raw event ID
- channel ID + short window for unthreaded bursts

Display:

- title from thread topic, linked object, or AI summary
- subtitle: channel, participants, message count
- preview: first substantive message or AI summary

Edge cases:

- Reactions should appear as evidence metadata, not standalone moments unless a
  reaction triggers a workflow decision.
- Bot messages should be folded into the thread unless they are authoritative
  status updates.
- Files shared in Slack should also connect to captured files/documents.

### Email

Group by:

- provider thread ID
- message ID / in-reply-to / references
- normalized subject fallback

Display:

- title: subject without noisy prefixes
- subtitle: sender/recipient summary and message count
- preview: latest substantive body snippet

Edge cases:

- Newsletters and automated notifications should be demoted unless connected to
  an object or explicitly captured as evidence.
- Attachments should become document impact items.
- Long threads should cap evidence cards and expose overflow.

### Meetings

Group by:

- meeting ID
- calendar event ID when meeting ID is missing
- saved meeting link ID for recurring capture

Display:

- title from meeting title or generated summary
- subtitle: participants, transcript status, duration
- preview: meeting summary or transcript status

Edge cases:

- "No transcript" and failed transcript states must be visible in the row.
- Multiple transcript chunks should never become multiple timeline moments.
- Recurring meetings should show occurrence date/time clearly.
- Consent/host-confirmation state remains in meeting surfaces and inspector.

### Calendar

Group by:

- calendar event ID
- recurring series ID + occurrence ID
- proposal group ID for tentative slots

Display:

- title from event title
- subtitle: time span, calendar, recurrence marker
- preview: status change such as created, rescheduled, cancelled, or proposed

Edge cases:

- All-day and multi-day events need clear date ranges.
- Recurrence exceptions should show both the series and modified occurrence.
- Proposed slots should group as a choice set until one slot is confirmed.
- Calendar imports may be authoritative for calendar state, but not for unrelated
  tasks or objects.

### Documents And Captured Files

Group by:

- document ID
- document version ID for version-specific events
- parent raw event ID for files captured from chat/email/webhook

Display:

- title: human document title, not generated storage filename
- subtitle: upload/version/extraction state
- preview: model-generated document understanding when available

Edge cases:

- Generated filenames should remain hidden in the row and available in details.
- Failed extraction/indexing states should show a retry path where available.
- A document attached to chat should appear as impact in the chat moment and as
  a document moment only when the document itself changes state.

### Native Integrations

Group by:

- provider
- external object ID
- external URL
- event family
- bounded time window when provider object IDs are missing

Display:

- title around the external work object: PR, issue, board item, ticket, deal,
  incident, pipeline, deployment, release, document, or customer record
- subtitle: provider, object label, event count, time range
- preview: lifecycle change or latest substantive comment

Edge cases:

- CI/workflow noise should bundle under PR, commit, branch, deployment, or
  workflow run family.
- Repeated status checks should become one moment with counts and latest state.
- Provider retries, duplicate webhooks, and replayed backfills must not create
  duplicate moments.
- Deleted or inaccessible provider objects should keep evidence but use a
  neutral label such as `Deleted GitHub object` when necessary.

### Generic Ingest Webhooks

Group by:

- webhook ID/name
- explicit external object ID if payload supplies one
- payload topic/key configured by the webhook
- bounded time window fallback

Display:

- title from configured webhook label plus payload title
- subtitle: webhook name, event count, time range
- preview: sanitized payload summary

Edge cases:

- Webhook payloads are evidence-only and should not become authoritative state
  without a separate approval or adapter.
- Untrusted payload content must stay fenced before any agent sees it.
- Unknown payload schemas should still group by source/time rather than flooding
  one row per delivery.

### System Events

Group by:

- job kind + target object + time window
- onboarding/recovery/action kind

Display:

- title: human operational outcome
- subtitle: system area and status

Edge cases:

- Background maintenance noise should be hidden from default moments unless it
  affects user-visible work or needs attention.
- Failures should include recovery actions.

## Provider-Specific Integration Examples

### GitHub

Group hierarchy:

1. Pull request ID
2. Issue ID
3. Commit SHA or branch
4. Workflow run ID, rolled up to PR/commit when linked
5. Repository + time window fallback

Moment examples:

- `PR #292 moved forward`
- `CI passed for PR #292 after 3 runs`
- `Bugbot review commented on PR #292`
- `Release v1.8.0 published`

Do not show a separate row for every `workflow_run.success` when several runs
belong to the same PR/commit context.

### Linear / Jira / Asana / Monday.com / Trello / Basecamp

Group hierarchy:

1. Task/issue/card/item ID
2. Project/board/sprint/lane when item ID is missing
3. Comment/update thread
4. Provider resource + time window fallback

Moment examples:

- `Audit task moved to In Progress`
- `Monday board item received 4 updates`
- `Jira issue AUD-42 was assigned to Mikael`

Status transitions and owner changes should be more prominent than internal
provider event names.

### Sentry / Datadog

Group hierarchy:

1. Incident/issue/monitor ID
2. Release/deployment marker
3. Service/environment + time window fallback

Moment examples:

- `Sentry issue resolved after regression spike`
- `Production monitor recovered`
- `Release introduced 2 new error groups`

Alerts should bundle by incident lifecycle. Do not flood rows for every
occurrence count update.

### CRM And Sales: Salesforce, HubSpot, Pipedrive, Attio, Close

Group hierarchy:

1. Deal/opportunity ID
2. Company/account ID
3. Contact/person ID
4. Activity thread or note
5. Pipeline/stage + time window fallback

Moment examples:

- `Acme deal moved to Legal Review`
- `HubSpot contact added a follow-up note`
- `Salesforce opportunity amount changed`

Deal stage changes are authoritative for CRM state; notes and emails are
supporting evidence unless approved into Timeline task/object state.

### Support: Zendesk / Intercom

Group hierarchy:

1. Ticket/conversation ID
2. Customer/company ID
3. Assignee/status lifecycle

Moment examples:

- `Zendesk ticket reopened by Acme`
- `Intercom conversation escalated to engineering`
- `Support thread mentions onboarding blocker`

Status, priority, assignment, and SLA changes should be impact chips. Long
reply threads should summarize, not list every reply.

### Docs/Wiki/Design: Google Drive, Notion, Confluence, Figma

Group hierarchy:

1. File/page/design file ID
2. Version/comment thread
3. Folder/project/space fallback

Moment examples:

- `Contract draft uploaded`
- `Confluence page updated with launch checklist`
- `Figma handoff received 5 comments`

Large document versions should not dump content into the row. Show the document
title, change type, processing status, and preview/summary when available.

### Chat/Community: Discord

Discord should follow Slack-like rules:

- server + channel + thread ID when available
- channel + short window fallback
- attachments and reactions as evidence metadata

Voice summaries, if added later, should behave like meeting transcript moments,
not raw message rows.

## AI Usage

### Where AI Helps

Use `llm.chatStructured()` from `packages/shared`; do not call provider SDKs
directly from app or worker code.

AI should generate:

- moment title
- one-sentence moment summary
- topic/category hint
- suggested cross-source artifact relationship
- "substantive message" selection for preview
- impact hint such as scheduling, blocker, decision, follow-up, incident, deal
  movement, support escalation

### Where AI Must Not Be Trusted Alone

AI must not:

- decide viewer visibility
- mutate raw events
- silently merge unrelated events without deterministic overlap
- create canonical task/object/calendar state without an approval path
- mark provider state authoritative unless the provider adapter says it is
- hide source evidence that contradicts the summary
- translate or rewrite quotes in a way that loses source truth

### AI Output Contract

Structured output should include:

```ts
interface MomentPresentationSuggestion {
  title: string;
  summary: string;
  previewEventIds: string[];
  topicLabels: string[];
  impactHints: {
    kind: string;
    label: string;
    confidence: number;
    sourceEventIds: string[];
  }[];
  crossSourceLinks: {
    artifactLabel: string;
    confidence: number;
    sourceEventIds: string[];
    rationale: string;
  }[];
}
```

Every output must be bounded:

- max input raw events per prompt
- max characters per event
- source IDs passed as opaque IDs
- external content fenced before prompt assembly when required
- model/version/prompt version recorded for cache invalidation

### Cache Invalidation

Regenerate AI presentation when:

- source event ID set changes
- source content hash changes
- impact hydration changes materially
- artifact cluster association changes
- prompt version changes
- model changes

Do not regenerate on every page load.

## Agent Access And Retrieval

The reworked timeline should become a retrieval surface for chat agents and
automation, not only a visual browser. Agents need the same de-noised work
moments users see, while still retaining citations to exact raw events.

### Agent-Facing Contract

Expose a team-scoped moment search/list API from `packages/shared`, likely under
the existing `withTeam(...).timeline` module once the projection moves out of
`apps/web`:

```ts
interface TimelineMomentSearchResult {
  momentId: string;
  title: string;
  summary: string;
  occurredAt: string;
  timeRange: { from: string; to: string };
  sources: string[];
  actors: string[];
  contexts: string[];
  impactItems: ImpactItem[];
  artifactClusters: SearchEventArtifactCluster[];
  citations: {
    rawEventId: string;
    source: string;
    occurredAt: string;
    snippet: string;
  }[];
  confidence: 'deterministic' | 'ai_suggested' | 'user_confirmed';
}
```

Agents should receive:

- a compact moment title/summary for planning and answer synthesis
- enough structured metadata to filter by source, impact, actor, artifact, and
  time range
- cited raw event snippets for every claim
- links back to full raw events or inspector routes when the UI needs to open
  evidence

Agents should not receive:

- hidden events or hidden impact from another viewer's visibility scope
- raw provider metadata unless a tool explicitly asks for technical evidence
- AI-generated summaries without the underlying citation set
- unfenced external/MCP content

### Retrieval Behavior

Moment retrieval should sit above raw event retrieval:

```text
user question
  -> retrieve matching objects/documents/tasks/calendar rows
  -> retrieve timeline moments by semantic + structured filters
  -> expand only the most relevant moments into raw evidence
  -> synthesize answer with citations
```

This prevents chat answers from being dominated by repeated integration events
while preserving auditability. For example, a question like "what happened with
PR #292 today?" should retrieve the `PR #292 moved forward` moment, then expand
its GitHub workflow/review/comment evidence only as needed.

### Agent Tooling

Add or update internal agent tools so they can choose the right level of detail:

| Tool shape | Purpose |
| --- | --- |
| `search_timeline_moments` | Default agent retrieval over bundled moments. |
| `get_timeline_moment` | Expand one moment into evidence, impact, related artifacts, and technical details. |
| `search_timeline_events` | Advanced raw event retrieval for audit/debug questions. |
| `search_integration_events` | Provider-specific evidence search, still fenced as external content. |

The exact names can follow existing tool conventions, but the separation matters:
agents should not have to choose between "too much raw log" and "uncited
summary."

### Digests, Handoffs, And Updates

Daily digests, stakeholder updates, handoffs, and object summaries should be
able to consume moments as a first pass. This gives them:

- fewer duplicate provider updates
- better coverage of chat bursts and long email threads
- clearer impact-oriented summaries
- cheaper prompts because raw evidence expands only after ranking

Generated outputs must still cite raw events, not only moment IDs. Moment IDs
are retrieval handles; raw events remain the receipt.

### Outbound MCP Server

Timeline-as-MCP-server should expose moment-level retrieval for team-visible
events. Bearer-key access remains team-scoped and must keep the existing
privacy boundary: team bearer keys cannot see private or specific-user events.
The moment projection must be computed from the same visible event set the MCP
caller is allowed to access.

### Eval Implications

Agent evals should include pairs that prove moments improve answer quality:

- repeated CI/webhook noise should not drown out the actual PR state
- chat scheduling threads should summarize into a single answerable moment
- conflicting evidence should be surfaced instead of flattened
- raw-event audit questions should still find the exact original events
- private events should not leak through moment summaries or counts

## UI Redesign

### Moment Row Anatomy

Each row should have:

1. time/time range
2. source marker icon
3. title
4. subtitle with context and actors
5. preview line
6. impact strip
7. evidence count
8. related evidence chip when applicable
9. status chips for transcript/extraction/sync failures

Provider event type and raw object IDs should not appear in the row unless the
user is in Source events mode.

### Visual Treatment

Keep the flat indexed timeline from `design.md`, but rebalance hierarchy:

- title: Switzer, sentence case, `text-sm` or `text-base`, medium weight
- metadata: mono uppercase, smaller and quieter
- source count: compact evidence chip, not a competing right-column sentence
- impact: chips underneath title/preview, not only aligned far right
- selected row: left signal bar plus inspector connection
- source marker: icon or simple square on the rail

The timeline should still feel like an operational archive, but not like a
database table.

### Inspector

Inspector default order:

1. Moment
2. Evidence summary
3. Impact
4. Source evidence
5. Related evidence
6. Controls
7. Technical details

Source evidence cards should be capped with overflow. Long raw source payloads
open a quick-view dialog before navigating.

### Empty, Loading, Error

- Loading skeletons should match moment rows, not raw event rows.
- Empty state should use the established mono line plus direct action.
- Error state should keep filters visible and provide retry.
- If AI presentation is stale or unavailable, fall back to deterministic
  presentation without blocking the page.

## API And Query Changes

### Current Endpoint

`GET /api/timeline` currently returns raw `items` plus hydration maps:

- authors
- audioUrls
- impactItems
- artifactClusters
- capturedFiles

### Proposed Response Shape

Add a versioned moment response while preserving raw event compatibility:

```ts
interface TimelineMomentsPage {
  mode: 'moments';
  moments: TimelineMomentDto[];
  rawEventsById: Record<string, TimelineEvent>;
  nextCursor: string | null;
  hydration: {
    authors: Record<string, Author>;
    audioUrls: Record<string, string>;
    capturedFiles: Record<string, TimelineCapturedFile[]>;
  };
}
```

The client can initially keep building moments locally, but the API should move
toward server-built moment DTOs so pagination and AI presentation are stable.
Once agents consume moments, the API DTO and the shared agent DTO should be
siblings derived from the same `packages/shared` projection. The web API can
include UI hydration such as signed audio URLs and captured-file previews; agent
retrieval should include citation snippets and structured filters.

### Pagination

Moment pagination is harder than event pagination. A page of 50 raw events may
collapse into 5 moments or expand into 50. The collector should scan enough raw
events to return a target number of visible moments while preserving a raw-event
cursor.

Rules:

- default target: 25 moments
- raw scan cap: configurable, e.g. 250 events per request
- if focused event is requested, include its entire deterministic group
- never split a source cluster across pages when the group key is known
- if a group is huge, show one moment and cap evidence in the inspector

## Rollout Plan

### M0: Fit And Dependency Prep

Files:

- `docs/timeline-moments-redesign-plan.md`
- `docs/integration-ingest-plan.md`
- `todo.md`

Work:

- Confirm this plan is the active timeline UX plan.
- Cross-link or update agent/integration docs when implementation starts.
- Decide whether moment search is a new agent tool family or a mode on existing
  timeline search.
- Identify provider metadata gaps for GitHub, Linear, Monday.com, Slack, Sentry,
  and generic webhooks.

Acceptance:

- No stale UX plan references remain.
- Implementation issues can be sliced by UI, shared projection, provider
  metadata, and agent retrieval.

### M1: Presentation Contract And Deterministic Titles

Files:

- `apps/web/src/lib/timeline-moments.ts`
- `apps/web/src/lib/timeline-moments.test.ts`
- `apps/web/src/components/timeline-list.tsx`
- `apps/web/src/components/timeline-list.test.tsx`

Work:

- Add `title`, `subtitle`, `preview`, `kind`, and `confidence` to
  `TimelineMoment`.
- Implement deterministic formatters for web, Telegram, Slack, email,
  meeting, calendar, document, integration, ingest webhook, and system.
- Retune row UI to prioritize title/subtitle/preview.
- Rename inspector sections.

Acceptance:

- Existing tests updated.
- New tests cover source-specific title/subtitle behavior.
- Screenshots show rows reading as moments instead of raw source events.

### M2: Integration Bundling

Files:

- `apps/web/src/lib/timeline-moments.ts`
- integration provider metadata writers in `packages/shared/src/integrations`
- provider tests where metadata is incomplete

Work:

- Standardize integration metadata needed for grouping:
  `provider`, `event_type`, `external_object_id`, `external_object_url`,
  `repository`, `pull_request_number`, `issue_number`, `workflow_run_id`,
  `commit_sha`, `deployment_id`, `release_id`, `resource_type`, `resource_name`.
- Add GitHub-specific grouping logic for PR/commit/workflow/release/deploy.
- Add generic provider object grouping fallback.
- Add provider metadata tests for grouping-critical fields.
- Update seeded demo events if needed so local screenshots demonstrate bundling.

Acceptance:

- CI runs and PR updates collapse into meaningful PR/workflow moments.
- Replayed or duplicate events do not duplicate visible moments.

### M3: Timeline Modes And Advanced Source Event View

Files:

- `apps/web/src/app/app/timeline/page.tsx`
- `apps/web/src/components/timeline-feed.tsx`
- `apps/web/src/components/timeline-list.tsx`
- `apps/web/src/lib/timeline-controls.ts`

Work:

- Add `mode=moments|events` query/state.
- Default to Moments.
- Reuse existing raw row style in Source events mode, explicitly labeled.
- Persist mode per user if a preferences mechanism exists; otherwise use URL.

Acceptance:

- Power users can still inspect raw log order.
- Normal users land on bundled moments.

### M4: AI Presentation Cache

Files:

- new worker job or shared module for moment presentation
- `packages/shared/src/llm` usage through existing wrapper
- database migration only if persistence is chosen

Work:

- Define structured prompt and schema.
- Generate title/summary only for eligible groups:
  multi-message chats, dense integrations, long email threads, long meetings,
  generic webhook groups.
- Cache by source-event hash and prompt version.
- Show deterministic fallback while cache is missing.

Acceptance:

- Timeline works without model availability.
- AI text is cited and never required for grouping correctness.
- Prompt tests or eval fixtures cover representative sources.

### M5: Cross-Source Related Evidence

Files:

- artifact reconciliation modules in `packages/shared`
- timeline API hydration
- inspector related evidence UI

Work:

- Keep cross-source evidence as `Related` unless authoritative metadata or
  user confirmation says the sources describe the same artifact lifecycle.
- Add confidence labels in inspector.
- Add user feedback affordance later: "related / not related".

Acceptance:

- A Telegram thread, PR, and meeting can be related without collapsing into one
  misleading row.
- Inspector explains why sources are related.

### M6: Agent Retrieval Surface

Files:

- `packages/shared/src/team-scope.ts` or a timeline submodule
- `packages/shared/src/agent/tools.ts`
- eval fixtures under the existing eval test suite
- timeline API code after the projection moves server-side

Work:

- Move stable moment-building logic into `packages/shared`.
- Add team-scoped moment search/list/expand methods.
- Add agent tools for `search_timeline_moments` and moment expansion, or adapt
  existing tool names to the same shape.
- Keep raw event search available for audit/debug questions.
- Ensure MCP output fencing and visibility boundaries are preserved.

Acceptance:

- Chat answers can retrieve bundled moments and cite raw events.
- Daily digest/update/handoff flows can use moments before expanding evidence.
- Slack/Telegram/background agents can adopt the same retrieval layer without
  duplicating dashboard-only logic.
- `pnpm test:eval` covers moment retrieval quality and privacy boundaries.

### M7: QA, Polish, And Documentation Sync

Work:

- Visual QA desktop and mobile.
- Check long words, long provider IDs, multilingual text, empty states, huge
  evidence groups, and inspector overflow.
- Run completion gates:
  `pnpm validate`, `pnpm run doctor`, targeted tests, and broader tests if the
  API/server projection changes.
- Update `design.md` if the visual language changes beyond existing Timeline
  rules.

## Edge Cases

### Huge Groups

Examples: active Slack thread, CI flapping, incident storm, webhook replay.

Rules:

- cap visible evidence cards
- show overflow count
- summarize by lifecycle/status/count
- avoid rendering hundreds of DOM nodes
- keep raw source event view paginated

### Duplicate Events

Examples: webhook retry, backfill replay, provider cursor reset.

Rules:

- dedupe raw event writes where possible
- group by provider dedupe keys in presentation
- display count based on distinct visible raw events

### Missing Metadata

Examples: provider API changed, partial webhook payload, old seed events.

Rules:

- fallback to source + time window
- never throw the whole timeline because one event is malformed
- log missing grouping fields in tests/diagnostics

### Out-Of-Order Events

Examples: delayed webhook, backfilled history, imported email thread.

Rules:

- order moments by event occurrence time, not ingestion time
- display backfill context in inspector when useful
- avoid shifting "Today" rows unexpectedly on old backfills unless filters
  include imported history

### Edited, Deleted, Or Redacted Source Material

Rules:

- raw event immutability stays intact unless the product has an explicit
  tombstone/removal path
- deleted/tombstoned events are excluded from visible reads
- edited events should keep evidence status without constantly changing the
  moment title
- private/specific-user events never leak through grouped counts or impact

### Conflicting Evidence

Examples: one source says deal is approved, another says approval is blocked.

Rules:

- do not collapse conflict into a single definitive title
- show conflict in inspector
- use "related evidence" language instead of authoritative state
- require approval-backed state changes

### Time Zones

Rules:

- section dates and time windows use team/user calendar timezone
- all-day and multi-day events show date spans
- raw UTC timestamps remain available in technical details

### Multilingual Content

Rules:

- preserve source language in quotes
- AI summaries may use the user's locale later, but source evidence remains
  original
- line clamp must handle long Finnish/German/etc. compounds without overflow

### Attachments And Media

Rules:

- attachments appear as impact/evidence chips
- previews load lazily in inspector or quick-view
- audio transcription status is row-level when relevant
- failed extraction/transcription has a visible status and retry path where one
  exists

### Security And Trust Boundaries

Rules:

- MCP and external content remains fenced before agent use
- URL-derived outbound fetches continue through SSRF guards
- OAuth tokens and secrets remain encrypted through `crypto/secrets.ts`
- AI prompts must not include secrets or hidden private events

## Testing Strategy

### Unit Tests

Add or extend tests for:

- grouping keys per source
- title/subtitle/preview formatters
- integration provider object grouping
- visibility-safe grouping
- pagination collector behavior
- impact item dedupe
- artifact related evidence display
- malformed metadata fallbacks
- agent-facing moment search and expansion
- privacy-safe moment retrieval for private/specific-user events

Primary files:

- `apps/web/src/lib/timeline-moments.test.ts`
- `apps/web/src/lib/timeline-page.test.ts`
- `apps/web/src/components/timeline-list.test.tsx`
- provider-specific tests under `packages/shared/src/integrations`
- agent tool/eval tests when moment retrieval is exposed to chat

### Visual And Interaction Tests

Cover:

- default Moments view
- Source events mode
- inspector open/close
- huge evidence overflow
- mobile timeline layout
- long provider object labels
- multilingual chat thread
- transcript unavailable state

### Eval Tests

Run `pnpm test:eval` when AI summary, retrieval, artifact reconciliation, or
answer synthesis behavior changes.

Moment-specific evals should prove that chat agents prefer bundled moments for
normal questions, expand raw evidence for citations, and fall back to raw event
search for audit/debug prompts.

### Completion Gates

Every implementation PR must run:

- `pnpm validate`
- `pnpm run doctor`
- nearest targeted tests
- `pnpm test:eval` when agent/retrieval/summary behavior changes
- `pnpm test:dist-imports` when shared package exports or Node loader
  boundaries change

## Open Decisions

1. Whether AI-generated moment presentation should be persisted in Postgres
   immediately or introduced as an in-memory/server cache first.
2. Whether Moments vs Source events should be a route-level tab, query param, or
   user preference.
3. Whether cross-source artifact clusters should ever collapse into one visible
   moment by default, or remain separate with `Related` until a user confirms.
4. How much history a new integration should scan to regenerate AI presentation
   for old events.
5. Whether the Home "Recent moments" widget should use the same full moment DTO
   or a lighter dashboard-specific projection.
6. Whether future source adapters should live in `apps/web` until stable or move
   directly into `packages/shared`.
7. Whether agent tools should expose moments as a new tool family or fold them
   into existing timeline/event search tools with a `mode` parameter.

## Success Criteria

The transformation is successful when:

- A day with 100 raw integration/chat events reads as 10-25 meaningful moments.
- A non-technical user can explain the timeline row without opening the
  inspector.
- A technical user can still audit the exact source events behind every moment.
- GitHub/CI noise is bundled around PRs, commits, workflows, releases, or
  deployments.
- Chat bursts become conversation moments with message counts and participants.
- AI improves wording but the page still works correctly with AI disabled.
- Chat agents, digests, handoffs, and outbound MCP can retrieve bundled moments
  and cite the underlying raw events.
- Visibility, team isolation, immutable raw events, and evidence citations remain
  intact.
- The new source adapter contract makes the next integration cheaper and more
  consistent than adding one-off timeline UI branches.
