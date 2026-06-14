# Dashboard Agent Plan

Status: temporary implementation brief

This plan captures the agent work discussed for the dashboard chat, floating
assistant, in-chat approvals, navigation help, dashboard action tools, and
retrieval quality. It is intentionally ordered by implementation sequence so
each slice can ship independently.

## Current Baseline

- Dashboard chat sessions are private to the creating user. The underlying rows
  are team-scoped, but chat session list/read/write helpers filter by
  `createdBy = scope.userId`.
- The dashboard chat uses Vercel AI SDK, not LangChain. Keep that stack.
- Dashboard chat and Slack/Telegram ask flows share the core prompt and native
  Timeline tools. Dashboard chat additionally has streaming UI, persisted
  sessions, chat memory compression, and dynamic MCP tool discovery.
- Current mutation tools are proposal-backed. They write to the main approval
  queue and do not mutate canonical state directly.
- Current semantic search is mostly vector-first:
  - `search_timeline` embeds the query, searches Qdrant, dedupes by event, and
    hydrates accessible raw events/facts/captured-file chunks from Postgres.
  - `search_object_notes` embeds the query and searches accepted object-note
    vectors.
  - `search_documents` embeds the query and searches document chunk vectors.
  - `get_object`, `get_entity`, `list_objects`, `list_tasks`,
    `list_events`, `list_calendar_events`, and board helpers are deterministic
    Postgres reads, not vector search.
- The existing prompt already requires citations, but citation UX mostly sends
  users toward full pages. We want inline previews first, with navigation as a
  secondary action.

## 1. Typed Artifact References And Preview System

Status: implemented as the first foundation slice. The shared citation parser
now recognizes event, object, object-note, document-chunk, calendar, board,
board-item, task, and route refs; dashboard chat renders them through a shared
preview dialog backed by `/api/artifacts/preview`.

Build this before adding more agent links so every future agent answer can use
the same interaction model.

### Goal

When the agent cites evidence or references a workspace artifact, the user can
inspect it in place without losing chat/page context.

### Typed Reference Contract

Introduce a small shared reference type used by retrieval, tools, chat
rendering, and preview hydration.

```ts
type ArtifactRef = {
  kind:
    | "timeline_event"
    | "object"
    | "object_note"
    | "document"
    | "document_chunk"
    | "calendar_event"
    | "board"
    | "board_item"
    | "task"
    | "route";
  id: string;
  label?: string;
  snippet?: string;
  href?: string;
  previewEndpoint?: string;
  evidenceRole?: "subject" | "supporting" | "source" | "target";
  metadata?: Record<string, unknown>;
};
```

The visible citation syntax can stay compact, but internally the agent should
receive and return typed refs instead of opaque page links.

### Scope

- Add previewable references for:
  - timeline events: `[ev:<id>]`
  - objects/entities: `[ent:<id>]`
  - object notes: `[note:<id>]`
  - documents/chunks: `[doc:<documentId>#v<version>:chunk:<chunkId>]`
  - calendar events: `[cal:<id>]`
  - boards and board items: `[board:<id>]`, `[board-item:<id>]`
  - dashboard routes: `[route:<id>]`
- Clicking a reference opens a modal/sheet preview, not immediate navigation.
- Every preview includes a secondary "Open full page" action when a full page
  exists.
- Object previews should show canonical name, type, aliases, status/stage,
  owner/assignee, recent facts, recent events, notes, relationships, tasks,
  calendar links, and board memberships.
- Timeline event previews should show source, sender/author, timestamp,
  content/transcript, linked facts, linked objects, and source-specific
  metadata.
- Calendar previews should show title, time range, timezone, description,
  linked objects, source events, and edit/open actions when authorized.
- Board previews should show board purpose, lanes, selected item context, and
  relevant object links.

### Implementation Notes

- Prefer a central citation parser + registry rather than one-off rendering in
  chat.
- Reuse existing hydration endpoints where possible; add small read-only
  preview endpoints only where page loaders are too heavy.
- Keep preview access checks identical to full page access checks.

## 2. Floating Contextual Chat

Status: initial shell implemented. The app shell now has a global floating chat
launcher hidden on `/app/chat`, reuses the main chat rendering surface, persists
one private floating-session id per team in local storage, carries the session
into "Open full chat", and sends route/path/query plus known UUID context to
`/api/chat`. Richer page loaders for names, selected lanes, visible filters, and
object summaries still belong in the later context-provider/tooling work.

### Goal

Make the agent available across the dashboard while keeping the dedicated
`/app/chat` page as the full-screen power surface.

### Scope

- Add a global floating assistant launcher inside the app shell.
- Hide the floating assistant on `/app/chat`.
- Use one private persisted conversation for the floating assistant by default.
- Include an "Open full chat" link that carries the current session id.
- Support compact and expanded modal states.
- Reuse the existing chat rendering primitives where possible, including tool
  steps and citation previews.

### Context Provider

Every floating-chat request should include dashboard context:

- route and pathname
- page title/surface kind
- selected object id/name/type when on object pages
- selected board id/item id/lane/filter when on board pages
- selected calendar event/range when on calendar pages
- current task/object filters where relevant
- visible search query/filter state where relevant

This context is not a replacement for tools. It tells the agent what the user
is looking at, then tools verify before answering or acting.

## 3. Navigation And Product Guide Tools

Status: initial read-only foundation implemented. Shared route/help metadata now
lives in `@timeline/shared/app-guide`, dashboard route previews consume the same
registry, and the agent has `search_app_guide` plus `get_app_route` tools that
return `[route:<id>]` citations, hrefs, required role, intents, and compact
guide text. Remaining work is richer/how-to guide coverage and future UI cards
for tool results beyond the route preview dialog.

### Goal

Let the agent answer "how do I use The Timeline?" and "where do I do X?" without
stuffing all help text into the system prompt.

### Scope

- Add a read-only `search_app_guide` tool.
- Add a read-only `get_app_route` or `find_dashboard_route` tool.
- Back these tools with structured route/help metadata:
  - page path
  - label
  - minimum required role or permission
  - common user intents
  - short usage guide
  - related setup/help docs
- Include existing help content and onboarding guide content in the searchable
  guide corpus.
- Keep guide text accessible to all agents, but let dashboard chat render richer
  route cards and preview links.

### Example

User: "Where can I invite new team members?"

Agent should answer with the Team page route, mention required admin/owner
permissions, and provide an inline route card or preview. It should not need to
search timeline data for this.

## 4. Deterministic Structured Search Tools

Status: initial agent-facing structured tools implemented. The agent now has
`search_objects`, `search_boards`, and `search_documents_structured` for
deterministic metadata/filter queries alongside existing event, calendar, task,
object, and semantic document/timeline tools. Remaining work is deeper
event/calendar substring filters and folding these tools into the shared
retrieval planner/fusion recipes.

### Goal

Give agents reliable search/filter tools for workspace records, not only
semantic vector search. These tools become part of the shared RAG foundation for
dashboard chat, Slack/Telegram, and background agents.

### Current Search Behavior

- Semantic timeline/document/object-note search goes through embeddings and
  Qdrant first.
- Exact object lookup uses `get_object`/`get_entity`.
- Listing tools support some filters, but the agent lacks a unified, expressive
  structured search surface across objects, events, calendar, and boards.

### New Tools

- `search_objects`
  - filters: type, status, stage, owner, assignee, due range, updated range,
    archived, board membership, exact/contains name or alias, limit/sort
  - modes: exact, prefix/contains, semantic, hybrid
- `search_timeline_events`
  - filters: time range, source, sender, author, linked object ids, fact ids,
    content substring, semantic query, visibility-aware limit/sort
  - should support deterministic string matching in addition to vector search
- `search_calendar_events`
  - filters: time range, title/description/location substring, linked object,
    creator, visibility, deleted state
  - should combine date predicates with optional semantic query
- `search_boards`
  - filters: board name/purpose/template, pinned state, object membership,
    lane, responsible user, due range, priority, item text
- `search_documents`
  - keep existing semantic chunk search, but add stronger structured filters
    for folder, file kind, document name, uploaded by, date range, and current
    version.

### Design Rules

- Every tool must be team-scoped and visibility-aware by construction.
- Prefer deterministic filters when the user gives exact names, ids, sources,
  dates, or route context.
- Prefer semantic/hybrid search when the user asks fuzzy knowledge questions.
- Return typed references that citation previews can hydrate.
- Return enough reason/score metadata for the agent to explain uncertainty.

## 5. Unified Retrieval Planner And Fusion Layer

Status: initial shared read-only planner implemented. `retrieveWorkspaceContext`
now lives in `@timeline/shared/agent` and is exposed to agents as
`retrieve_workspace_context`, returning a compact packet of object/profile,
note, event/fact, task, board, calendar, document, and route-guide refs for
broad context questions. Remaining work is deeper reranking/observability and
expanding the recipes with deterministic event/calendar substring filters.

### Goal

Make all agents retrieve context consistently and measurably better.

### Problem

Today the model chooses tools from prompt instructions. That works, but it is
not a reliable retrieval strategy for high-value questions. A question like
"What do we know about Otto Silventola?" should gather object profile, facts,
events, notes, tasks, calendar, documents, relationships, and boards in a
controlled way.

### Shared Retrieval Boundary

Add a shared `retrieveWorkspaceContext` service used by:

- dashboard chat
- floating chat
- Slack/Telegram ask agent
- background proposal agents
- eval harnesses

Keep this layer read-only and surface-neutral. It can understand route context,
but it should not know how to render dashboard approval cards or execute
dashboard mutations.

Dashboard-only actions live in dashboard action tools. Slack/Telegram and
background agents should be able to benefit from the same retrieval recipes
without inheriting dashboard mutation affordances.

### Query Classes

The planner should classify requests into retrieval recipes:

- person/company/object profile
- timeline/event evidence
- task/follow-up status
- calendar/scheduling
- board/workflow state
- document/reference knowledge
- product guide/navigation
- dashboard action preflight

### Fusion Strategy

- Run deterministic lookup first for explicit ids, route context, exact names,
  and date/source filters.
- Run semantic search for fuzzy evidence.
- Run lexical/substring search for exact phrases, names, handles, emails, and
  identifiers.
- Merge and dedupe results by canonical artifact id.
- Rerank by source reliability, recency, exact-match strength, semantic score,
  visibility, and current route context.
- Return a compact context packet with typed references, snippets, confidence,
  and hydration ids.

### Otto Example

For "What do we know about Otto Silventola?", the planner should retrieve:

- the best matching person object(s), aliases, facets, and merge state
- accepted object notes
- recent and high-signal facts
- timeline events mentioning or linked to the person
- related tasks/follow-ups
- calendar events and meetings linked to the person
- board memberships and board-local next steps
- relevant documents or integration events

The final answer should cite evidence inline and include an object preview
reference, not force navigation.

## 6. Tool Selection Middleware And Observability

### Goal

Avoid flooding the model with irrelevant tools while keeping the agent capable,
and make tool/retrieval behavior visible enough that we can debug it.

### Approach

Stay on Vercel AI SDK. Add our own tool-selection layer around `streamText`
instead of migrating stacks.

### Tool Groups

- core read tools: retrieval planner, search, get object/entity/event/document
- current-context tools: page/object/board/calendar context
- guide tools: route/help/onboarding docs
- dashboard action tools: object/calendar/board mutations
- external MCP tools
- admin/team tools

### Selection Inputs

- user message
- current route context
- session state
- user role/permissions
- active artifact ids
- previous tool calls in the turn
- risk class of possible actions

### Observability

Use LangSmith for model/tool traces where it is already wired, and add compact
structured app logs for the decisions LangSmith will not automatically explain.

Capture per turn:

- selected tool groups and omitted high-level groups
- retrieval recipe chosen
- structured searches run, filters used, and result counts
- vector search collections queried and result counts
- top returned artifact refs and scores
- approval-required tools prepared/executed/denied
- stale-state rejections for action execution
- tool latency and tool errors

This should answer questions like: "Why did the agent not look at boards?",
"Did it use deterministic search or vector search?", and "Which tool group
caused this giant context window?"

### Implementation Notes

- For each turn, select a small relevant tool subset.
- Always include a minimal fallback: retrieval planner, guide route search, and
  current context reader.
- Keep hard server-side permission checks inside every tool; tool selection is
  prompt hygiene, not security.

## 7. In-Chat HITL And Two-Phase Action Contract

### Goal

When the user explicitly asks the chat agent to change dashboard state, the
agent should prepare the action, show a clear confirmation preview, and execute
only after approval.

### Distinction From Main Approval Queue

- Background proposal queue: inferred suggestions from captured events,
  meetings, Slack/Telegram, integrations, and other passive evidence.
- In-chat HITL: explicit user-commanded action in the current conversation.

Do not route explicit chat commands through the background proposal queue unless
the user asks to create a proposal instead of doing the action.

### Two-Phase Contract

Each risky dashboard action should have a prepare step and an execute step.

Prepare tools:

- resolve user intent and target artifacts
- read current state through the same team-scoped domain modules as the UI
- validate that the user can perform the action
- compute a diff/preview and side effects
- return typed refs for all targets and evidence
- create a `preparedActionId` with target ids, expected versions/hashes, action
  input, user id, team id, expiry, and idempotency key

Execute tools:

- require explicit chat approval
- consume `preparedActionId`, not arbitrary fresh model arguments
- re-read current state and verify expected versions/hashes
- reject stale previews and ask the user to refresh/review again
- execute through the canonical domain method or server action path
- write normal audit/history rows for the changed team data
- return final typed refs, changed fields, and side effects

This prevents the model from changing the action between preview and approval,
and it gives us a clean place to handle double-clicks, stale data, and failed
execution.

### AI SDK Shape

- Use Vercel AI SDK tool approval states for high-risk tools.
- Render approval cards in chat.
- Use `addToolApprovalResponse` from the client to approve/deny.
- Automatically continue the turn after approval where appropriate.

### Approval Card Requirements

Every approval-required tool must show:

- action summary
- target artifact previews with links/previews
- before/after diff where applicable
- side effects, such as archival, merge redirects, re-embedding, board history,
  calendar audit rows, notifications, or page revalidation
- cancel/approve controls
- clear outcome after execution

### Minimal Permission Matrix

Keep permissions boring and close to existing dashboard behavior:

- read tools follow existing team membership and visibility rules
- normal object/calendar/board actions require the same membership/role the UI
  already requires
- admin/owner checks only apply where the dashboard already treats the action as
  administrative, such as team settings or invites
- no elaborate internal ACL matrix unless product usage proves we need one

Teams are expected to be open internally. For tighter access, the product answer
is usually a smaller team/workspace, not complex per-action policy.

## 8. Dashboard Action Tools

### Goal

Make the dashboard agent genuinely useful for doing work, with explicit HITL
and the same domain rules as the UI.

### Object Tools

- create object
- update object fields
- add/update object note
- add/remove relationship
- archive object
- merge objects
- add/remove identity facet
- link object to current user where appropriate

Merge flow requirements:

- resolve winner and loser objects
- show both object previews
- show fields/facts/notes/tasks/relationships/board memberships that will be
  retained or redirected
- require approval
- execute the same merge path used by object cleanup
- run cleanup/reconciliation/re-embedding side effects
- answer with the surviving object reference and preview

### Calendar Tools

- create calendar event
- update calendar event
- cancel/delete calendar event
- link/unlink entities
- resolve relative dates through workspace timezone before preview

### Board Tools

- create board
- archive board
- add existing object to board
- quick-create object and add to board
- update board item lane/position/responsible/due/priority/next step/notes
- remove board item
- pin/unpin board for the current user

### Guardrails

- Use existing server actions/domain methods where possible.
- Do not duplicate business logic inside agent tools.
- Every mutation must be team-scoped, permission-checked, audited, and
  revalidate affected dashboard surfaces.
- The agent should read current state before preparing updates.

## 9. Better Agent Answers With Artifact References

### Goal

Agent answers should feel like they are working inside the dashboard, not just
printing citations.

### Requirements

- When naming an object, include a reference that opens the object preview.
- When citing evidence, cite timeline/document/note references inline.
- When discussing work state, include board/calendar/task references where
  available.
- Avoid heavy navigation unless the user explicitly asks to open a page.
- Use preview modals as the first layer; full pages are the second layer.
- Add route-aware suggestions such as "I can update this object" or "I can add
  this to the current board" only when context makes them relevant.

## 10. Retrieval Freshness And Index Health

### Goal

Keep RAG useful for initial users without building a giant indexing operations
platform too early.

### Simple First Version

- Track embedding/index coverage by source kind: timeline events, object notes,
  documents, calendar events, and later board items.
- Track stale embeddings after object, calendar, document, or board updates.
- Surface failed embedding/indexing jobs through existing job recovery or a
  small admin-only health panel.
- Add a simple "last indexed at" and "pending index jobs" view per source kind.
- Later, add eval coverage for recently created/updated artifacts so freshness
  bugs are caught quickly.
- Ensure merge/archive/delete paths remove or redirect stale refs where needed.

This can start as counters and health checks. It does not need a complex ops UI
before the retrieval path itself is reliable.

## 11. Agent Eval Harness

This is important quality infrastructure, but it should not block the first
useful dashboard agent improvements. Build it after the core user-facing agent
surfaces and action contracts exist, then use it to harden retrieval, parity,
and background agents.

### Goal

Create a reusable scoreboard that tells us whether each agent can find the
right workspace context, cite it correctly, choose sane tools, produce the right
artifact refs, and avoid unsafe actions.

### Harness Shape

Build one shared eval harness with surface-specific adapters:

- retrieval adapter: calls structured search and retrieval planner functions
  directly
- dashboard chat adapter: runs dashboard chat with current page context, typed
  refs, tool approvals, and streaming/tool-step assertions
- Slack/Telegram adapter: runs the ask-agent flow against synthetic
  Slack/Telegram-shaped events and sender context
- background suggestion adapter: runs proposal-generation agents against seeded
  passive evidence and asserts proposed tasks/objects/calendar changes
- graph/summary adapter: runs object/timeline/board/calendar summarizers and
  asserts grounded summaries, merged refs, and no stale/cross-team evidence
- action adapter: runs prepare/execute tools with approval, stale-state, and
  permission cases

Each adapter should read the same seeded workspace and output normalized eval
results:

```ts
type AgentEvalResult = {
  caseName: string;
  surface:
    | "retrieval"
    | "dashboard_chat"
    | "slack"
    | "telegram"
    | "background"
    | "summary";
  passed: boolean;
  scores: Record<string, number>;
  refs: ArtifactRef[];
  toolCalls: Array<{
    name: string;
    status: "called" | "approved" | "denied" | "failed";
  }>;
  failures: string[];
  traceId?: string;
};
```

### Fixture Strategy

Start with deterministic seeded fixtures, not production data. We do not need a
huge sample set at first. We need a compact fake workspace that behaves like a
real one:

- a few people/company/project objects, including ambiguous names and aliases
- timeline events from Slack, Telegram, meetings, documents, and integrations
- accepted object notes and facts
- board lanes and board items
- calendar events across past/future date ranges
- documents and document chunks
- private/user-specific records and cross-team records for visibility checks
- a few background proposal candidates

No real integrations are required. The seed writes Slack/Telegram/calendar/doc
records directly into the same internal tables the agents normally read from.

### Eval Suites

- RAG/retrieval suite: returned refs, ranking, visibility, snippets, freshness
- dashboard chat suite: page context, citations, preview refs, route-guide
  tools, tool selection, and approval cards
- Slack/Telegram suite: ask-agent parity without dashboard-only mutation tools
- background suggestion suite: proposal precision and passive evidence quality
- graph/summary suite: grounded summaries with current artifact refs
- action/HITL suite: prepare/execute approval, stale previews, denied approvals,
  and permission failures

### Run Modes

- Fast local mode: in-process database/test adapters, mocked embeddings/model
  behavior, deterministic CI checks
- Full-stack Docker mode: isolated Postgres, Qdrant, and Redis; migrate, seed,
  index, run selected suites, print scoreboard, destroy volumes
- Provider smoke mode: optional real model calls against synthetic data only

### Initial Golden Set

- "What do we know about Otto Silventola?"
- "What did the team work on yesterday?"
- "What is outstanding right now?"
- "Which board items are blocked?"
- "What calendar events do we have with Otto next week?"
- "Find the document where the pricing concern was mentioned."
- "Where can I invite new team members?"
- "Merge duplicate Otto into Otto Silventola." as a prepare-only action eval.
- Slack/Telegram parity versions of the same knowledge questions.
- Background proposal retrieval cases for task/object/calendar suggestions.
- Object, board, and calendar summary generation cases.

### Metrics

- source recall and citation correctness
- artifact coverage across objects, calendar, boards, documents, and tasks
- visibility and cross-team isolation
- temporal correctness through workspace timezone
- action safety and approval behavior
- tool economy and selected/omitted tool groups
- proposal precision for background agents
- summary groundedness
- Slack/Telegram/dashboard parity where the surface allows it

## 12. Rollout Order

1. Typed artifact reference model plus citation preview registry/modals.
2. Floating chat shell with current route context and full-chat handoff.
3. Navigation/product guide tools.
4. Deterministic structured search tools.
5. Shared retrieval planner and fusion layer.
6. Tool-selection middleware plus LangSmith/structured observability.
7. In-chat HITL with the two-phase action contract and one simple approved
   action.
8. Expand dashboard action tools: object update, object merge, calendar update,
   board item update.
9. Simple retrieval freshness and index health checks.
10. Bring Slack/Telegram/background agents onto the shared retrieval planner
    where appropriate.
11. Agent eval harness foundation with a compact seeded workspace, golden
    scenarios, and first RAG/action suites.
12. Keep growing eval suites from real failures, support questions, and
    background-agent mistakes.

## Open Decisions

- Whether floating chat uses a single global private session forever, one
  session per page/context, or a default global session with optional "start
  contextual chat" sessions.
- Whether route/help guides live as static TypeScript metadata, markdown docs,
  database-backed content, or a small generated search index.
- Which first mutation should prove in-chat HITL: object field update, calendar
  event update, or object merge.
- Whether prepared actions are stored as short-lived DB rows, signed payloads,
  or a hybrid of both.
- Whether direct chat actions should ever create a main approval-queue item on
  request, for example "draft this change for later approval."
