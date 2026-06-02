# Approval-Backed Object Memory Implementation Plan

Temporary implementation plan for Slice 13.9 in `todo.md`.

Delete this file when the feature is implemented and the durable documentation
has been folded into `todo.md`, `CONTEXT.md`, the relevant setup/product docs,
and code-level tests.

## Decision Summary

The agent's durable memory is visible workspace state, not a hidden notebook.
Durable information about people, companies, tasks, calendar commitments,
deals, projects, and other first-class surfaces becomes canonical only through
approval-backed proposals. Raw events remain immutable; sender identity improves
through derived resolution against approved object memory.

See `docs/adr/0003-object-memory-is-approval-backed-workspace-state.md`.

## Slice 1: Retrieval And Prompt Foundation

- Expose raw sender context in agent tool outputs for timeline event results:
  source, display name, handle, external id, source-specific ids, and source
  confidence/unverified state where available.
- Expose resolved sender object identity when current approved object memory can
  match the raw sender context.
- Treat live resolution from immutable raw sender metadata plus approved
  identity facets as the source of truth. A materialized sender-resolution
  cache may be added later for performance, but correctness must not depend on
  mutating raw events or running a backfill after every identity update.
- Include sender resolution status: `resolved`, `unresolved`, or `ambiguous`.
- Add sender-aware retrieval filters so tools can query by resolved person
  object, sender identity facet, or raw sender handle/source fallback, rather
  than only by `author_user_id`. This is required for questions like "what did
  Miku say today?" when the sender is not a Timeline team member or older events
  predate an approved identity link.
- Cover `search_timeline`, `list_events`, `get_event`, entity/object event
  history, and any conversational event citation hydration.
- Teach the system prompt the object-memory loop:
  resolve named things, use workspace objects before guessing, propose durable
  changes through approvals, and cite evidence.
- Inject compact current-user identity context into every agent surface:
  Timeline user id, display name/email, team role, linked person object id when
  known, and approved identity facets when relevant. This lets "I", "me", and
  "my" drive retrieval across linked sender identities without guessing.
- Add examples for people, companies, projects, tasks, deals, calendar
  commitments, aliases, typos, and identity facets.
- Align web chat, Telegram `/ask`, Slack `/ask`, and Slack mentions on the same
  native agent prompt/tool behavior. Include MCP tools only on surfaces where
  the permission and response UX are safe.

## Slice 2: Approval-Backed Memory Writes

- Add first-class identity facets rather than burying handles/contact details in
  `entities.metadata`. The table should support team/entity ownership, facet
  kind, display value, normalized lookup value, provider/external ids where
  available, provenance/status, timestamps, and indexes for sender resolution.
- Extend bundled `agent_suggestions` for object-memory proposals.
- Support object creation, alias updates, identity facets, relationships,
  notes/facts, canonical-name cleanup, status/owner/date refinements, and
  calendar/task/deal updates.
- Keep proposal payloads structured enough to validate and apply safely.
- Pending proposals are visible context but not canonical truth. The agent may
  mention that a relevant proposal is waiting for approval, but it must not
  rely on pending memory as established fact until a teammate accepts it.
- Accepting a proposal applies canonical state through the relevant
  team-scoped module, writes timeline/audit evidence where appropriate, and
  re-embeds changed object memory.
- Rejecting a proposal leaves raw events and canonical object memory unchanged.
- Do not use a hidden memory table.
- Do not mutate raw event sender attribution when identity knowledge improves.

## Slice 3: Prominent Approval UX

- Web chat renders inline approval cards for proposal bundles created in that
  chat turn.
- Cards show proposed changes, evidence, Accept/Reject controls, and current
  status.
- `/app/approvals` remains the canonical queue.
- Sidebar badges and notifications make pending approvals prominent.
- Approval state refreshes in the background where users naturally keep the app
  open.
- Telegram and Slack answers only state that the proposal was queued in
  Timeline; they do not provide external interactive approval controls.
- Agent surfaces may create proposals from web chat, Telegram `/ask`, Slack
  `/ask`, and Slack mentions. External surfaces receive plain-text confirmation
  only; review still happens in Timeline.
- Self-identity proposals such as "`@timbo0` on Telegram is me" must carry the
  current Timeline user id from the authenticated/linked agent runner context,
  not infer "me" from message text alone.
- The agent must always receive current-user context for conversational
  understanding. "I", "me", and "my" resolve immediately to the Timeline user
  authenticated in web chat or linked to the Telegram/Slack command runner.
  Durable changes that link that user to a person object or external identity
  facet still go through approval.

## Regression Coverage

- Sender context hydration from Telegram and Slack source metadata.
- Current approved sender resolution improves old retrieval results without
  editing raw events.
- Agent prompt/tool parity across web, Telegram, and Slack.
- Suggestion dedupe and application for identity facets and object aliases.
- Approval card, badge, and notification refresh behavior.
