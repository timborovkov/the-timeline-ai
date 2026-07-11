# Automatic Task Categories Plan

## Outcome

Every workspace object whose type is `task` should receive one functional
category selected by an LLM. Teammates can change that category, filter task and
object views by one or more categories, and see the category anywhere a task is
shown as a card or row.

The recommended v1 is deliberately narrow:

- one category per task
- one fixed, product-owned taxonomy shared by every team
- asynchronous automatic assignment after a task becomes canonical
- a permanent human override until the teammate explicitly chooses
  **Use automatic category**
- `task` objects only; `follow_up` remains unchanged in v1

This gives the classifier a stable label set that can be evaluated and keeps
filtering predictable. Team-defined categories and multiple categories per task
are possible later, but they introduce taxonomy administration, ambiguous filter
semantics, and much harder model evaluation before the basic workflow is proven.

## Product Problem and Success Definition

Task lists currently answer who owns work, when it is due, how urgent it is,
and where it sits in a workflow. They do not answer **what kind of work this
is**. As a result, a mixed task list is harder to scan, teams cannot isolate a
functional workload without relying on title search, and agents cannot reliably
answer questions such as “what Engineering work is blocked?” through a
structured field.

Categories are successful only if they improve task retrieval and workload
orientation. Automatic assignment by itself is not the product outcome.

### Product goals

- Let a teammate narrow a mixed task set by functional workstream in one or two
  interactions.
- Make category useful immediately without requiring taxonomy setup.
- Keep correction cheaper than classification: one quick select, no approval
  workflow, and no fear that the model will undo the choice.
- Give Tasks, Objects, Boards, Work Queue, agents, and outbound MCP one category
  contract rather than surface-specific labels.
- Learn from corrections without sending task content to product analytics.

### Initial success measures

Evaluate these after a two-week dogfood period and again after the first pilot
teams:

- at least 95% of newly created tasks reach a ready category state within 60
  seconds, excluding provider outages
- less than 2% of active tasks remain failed or pending for more than 15 minutes
- human correction rate below 15% overall after prompt/taxonomy stabilization
- no category has a sustained correction rate above 30% without a taxonomy or
  prompt review
- `other` below 10% of automatically categorized active tasks, unless reviewed
  samples show that the product genuinely lacks a category
- category filters are used by at least 20% of weekly active task users during
  the pilot, with zero-result rate and immediate clear-filter rate monitored as
  signs of confusing semantics
- no measurable regression in task creation latency, task-page load time, or
  board query latency

These are launch hypotheses, not permanent vanity targets. Qualitative review
should ask whether people understand the labels, trust them, and can find work
faster—not only whether the model matches an internal gold set.

## Scope and Non-goals

### In scope for v1

- one shared category on each canonical task object
- automatic LLM selection, manual override, explicit return to automatic mode
- category filtering and display across existing task-bearing surfaces
- versioned taxonomy, classifier evals, operational recovery, and active-task
  backfill
- structured category access for agents and outbound MCP

### Not in scope for v1

- multiple tags, nested categories, free-form labels, or per-user categories
- team-created/renamed/reordered taxonomy values
- automatic assignment, routing, due dates, priority, notifications, or access
  control based on category
- using category as evidence, an authoritative source field, or a replacement
  for board lanes, object type, status, priority, owner, or assignee
- categorizing `follow_up` or non-task objects
- analytics that include task titles, descriptions, parent names, or other
  task content

The no-automation boundary is important: a wrong label is cheap when it only
organizes a view. It becomes materially riskier if it silently assigns a person,
changes urgency, or triggers an external workflow.

## Current Code Review

The feature fits the existing architecture without creating a second task
system.

- Tasks are rows in `entities` with `type = 'task'` in
  `packages/db/src/schema/entities.ts`.
- `packages/shared/src/objects/index.ts` owns canonical object writes, team
  isolation, list/count/search filters, audit changes, and the `withTeam`
  object scope. Its public read types are mirrored in
  `packages/shared/src/objects/types.ts` for client-safe imports.
- `ObjectListFilter` already drives Tasks, Objects, Work, and the nested object
  part of board filtering. Extending it once is the correct shared filtering
  boundary.
- `packages/shared/src/boards/index.ts` has its own `entities` to `ObjectRow`
  mapper and object-filter SQL. Both must be updated or board cards and board
  category filters will drift from the object/task pages.
- `apps/web/src/lib/work-filters.ts` parses the shared URL filter state used by
  `/app/tasks`, `/app/objects`, and `/app/boards/[id]`.
- Task rendering is concentrated in
  `apps/web/src/components/tasks/task-board.tsx`. Task-shaped rows also appear
  in the object index, object detail connected-work lists, board kanban/table/
  list views, board side panels, Work Queue, global search, chat tools, and the
  outbound MCP server.
- All LLM calls already go through `packages/shared/src/llm`; workers use
  BullMQ and are started centrally in `apps/worker/src/index.ts`.
- The object-summary queue demonstrates the nearest enqueue/dedupe/worker
  pattern. The janitor worker demonstrates how the repo repairs a database
  write whose post-commit Redis enqueue was lost.
- `pnpm test:eval` already separates deterministic eval coverage from opt-in
  live-model suites. Task categorization should follow that pattern.

Do not store the current category only in `entities.metadata`. Category is a
frequent equality filter and a first-class UI field. JSON storage would make
validation, indexing, filtering, optimistic updates, and API contracts less
clear.

## Product Discovery Before Taxonomy Freeze

The category list below is a **provisional product taxonomy**. Before treating
it as v1, sample at least 200 representative task titles and safe available
context from the dev seed, dogfood teams, and target pilot workflows. Two
reviewers should independently label the sample, then measure agreement and
review disagreements.

Proceed with the taxonomy when:

- reviewer agreement is at least 0.80 Cohen's kappa or an equivalent
  chance-corrected agreement measure
- at least 90% of tasks fit a named category without stretching its definition
- no pair of categories accounts for a disproportionate share of disagreements
- pilot users can find the intended category quickly in the manual selector

If Administrative/Operations, Research/Strategy, or Engineering/IT & Security
remain persistently ambiguous, merge or rename them before implementation.
Model accuracy cannot repair a taxonomy that humans do not apply consistently.

## Category Taxonomy

Categories describe the **function or workstream responsible for the task**,
not its status, urgency, artifact type, or action verb. Status and priority
already model those other dimensions.

| Key | Label | Use for | Do not use for |
| --- | --- | --- | --- |
| `engineering` | Engineering | Code, APIs, infrastructure, bugs, deployments, technical maintenance | Product requirements or visual design without implementation work |
| `product` | Product | Product strategy, roadmaps, requirements, prioritization, discovery decisions | General company strategy or user research execution |
| `design` | Design | UX/UI, brand, prototypes, design systems, creative production | Frontend implementation when the task is primarily code |
| `research` | Research | User research, market research, analysis, experiments, due diligence | Routine reporting or product planning |
| `sales` | Sales | Prospecting, proposals, deals, demos, negotiation, closing | Existing-customer support or marketing campaigns |
| `marketing` | Marketing | Campaigns, content, events, SEO, communications, demand generation | One-to-one sales follow-up |
| `customer_success` | Customer Success | Onboarding, support, adoption, renewals, customer follow-up | New-logo sales work |
| `operations` | Operations | Internal processes, vendors, logistics, procurement, facilities, cross-team execution | Finance, legal, people, or IT work with a more precise category |
| `finance` | Finance | Billing, accounting, budgets, payroll execution, tax, financial reporting | Commercial deal negotiation owned by Sales |
| `legal_compliance` | Legal & Compliance | Contracts, privacy, policy, regulatory, risk, audits | Security implementation or finance bookkeeping |
| `people_recruiting` | People & Recruiting | Hiring, interviews, onboarding teammates, performance, culture, benefits | Customer onboarding or generic administration |
| `it_security` | IT & Security | Access, devices, identity, security reviews, incidents, internal systems | Product engineering security features when Engineering is the main owner |
| `strategy_planning` | Strategy & Planning | Company planning, OKRs, partnerships, executive initiatives, operating reviews | Product roadmap work with a clear Product owner |
| `administrative` | Administrative | Scheduling, forms, travel, routine coordination, records | Operational work with a substantive functional owner |
| `other` | Other | A real task that does not fit the taxonomy after considering its context | An ambiguous task that still clearly fits a listed category |

`Uncategorized` is a filterable system state, not an LLM category. It covers a
new task waiting for its job, a task whose classification repeatedly failed,
or legacy data before backfill. The LLM may choose `other`; it may not choose
`uncategorized`.

Category keys are stable API values. Labels are presentation strings and may be
localized or clarified without changing keys. Publish a
`TASK_CATEGORY_TAXONOMY_VERSION`; every automatic assignment records it.
Removing, splitting, or merging a key requires an explicit mapping and shadow
evaluation. Never silently remap a human override merely because the model or
prompt changed.

### Classification tie-breakers

The prompt and eval rubric should encode these rules:

1. Pick the category of the work being performed, not merely a noun in the
   title. “Review security copy for the launch page” is Marketing or Design,
   depending on the stated deliverable, not automatically IT & Security.
2. Prefer the most specific functional owner. Contract review is Legal &
   Compliance; invoice reconciliation is Finance; laptop access is IT &
   Security rather than Operations.
3. Classify implementation by the implementation owner. “Build the onboarding
   flow” is Engineering; “define onboarding requirements” is Product; “onboard
   Acme” is Customer Success.
4. Use parent-object context only to disambiguate the task. A task linked to a
   deal is not automatically Sales if the actual work is legal review.
5. Use `other` only when none of the named functions is defensible.

## User Experience

### Automatic assignment

After a task is created or an accepted proposal creates a canonical task, the
card briefly shows `Categorizing…`. The categorization worker then assigns and
displays a category without requiring approval. This is a low-risk derived
organizational label, not a fact, lifecycle transition, or source-authored
business field.

On later automatic reclassification, keep showing the last successful category
while the replacement is pending. This prevents a title edit, prompt migration,
or temporary provider outage from making the task disappear from its current
category filter. The UI may show a subtle `Updating…` state in detail views but
should not flicker or remove the badge.

If the first model call fails, the task shows `Needs category` rather than
pretending it is still actively categorizing. The user can retry or choose a
category manually. If reclassification fails after a previous successful
assignment, retain the previous category and show the failure only in the
editable detail control. The queue retries and the janitor repairs lost enqueue
attempts. Task creation itself must never fail because categorization is
unavailable.

### Manual change and authority

Task detail and object detail should expose a Category select containing the
taxonomy plus **Use automatic category**. Match the existing task-edit
permission model: any current team member who can edit the task may change its
category; category does not introduce a separate admin permission.

- Selecting a category writes a human override immediately.
- A human override is sticky across task title, status, assignee, due date, and
  context changes.
- **Use automatic category** changes authority mode to automatic, retains the
  current category until a replacement succeeds, and enqueues a new
  classification. This explicit action authorizes the next LLM result to
  replace the human value.
- A compact **Retry automatic category** action appears only for an automatic
  task in a failed state.
- Card-level quick edit is a worthwhile follow-up after the detail selector is
  stable; corrections should not require navigating away from a dense task or
  board view.
- The Tasks bulk toolbar should support setting a category for selected tasks.
  Bulk **Use automatic category** requires a confirmation that reports how many
  model jobs will be enqueued.
- Automatic changes should not create inbox notifications or a noisy timeline
  event. They should remain inspectable in object change history.

Offer an immediate undo toast after a manual category change. Undo restores the
previous category and authority mode as a new audited user action; it does not
delete history.

### Filters

Add a multi-select `category` URL parameter to the shared Work filter state.

- Tasks: show Category next to Status/Assignee and support multiple categories
  plus `Uncategorized`. `Uncategorized` matches tasks with no current category,
  whether pending or failed; detail UI distinguishes those states.
- Objects: a category filter implicitly returns task objects only. Preserve the
  selected value in pagination and type navigation. When category is active,
  short-circuit the unfiltered Objects section-preview fan-out to the task
  section instead of issuing empty category queries for every object type.
- Boards: filter on the category of the underlying object; non-task board
  items do not match a selected task category, including on mixed and non-strict
  boards.
- Work Queue: v1 shows the badge but does not need a separate queue filter
  unless Work adopts the full shared filter bar.
- Agent and outbound MCP list/search tools should accept category filters so
  “show Engineering tasks” has the same semantics as the visual UI.

Use OR semantics within the category filter and AND semantics between category
and other filters. For example, `engineering,product` plus `status=blocked`
means blocked tasks whose category is Engineering **or** Product.

When selected named categories and `Uncategorized` appear together, SQL must
use `(task_category IN (...) OR task_category IS NULL)`. Do not independently
AND `taskCategoryNull` with the named category condition. The shared filter
builder should own this branch so list, count, search, and board queries cannot
interpret the same URL differently.

### Display surfaces

Create shared `TaskCategoryBadge` and `TaskCategorySelect` components so labels,
capitalization, pending state, and accessibility do not drift.

Show the badge only when the row is a task:

- task kanban cards, task list rows, and the task side panel
- task rows in the Objects index and task object detail header/fields
- connected-task cards on other object pages
- board kanban cards, table rows, list rows, object preview, and board side
  panel when the underlying object is a task
- Work Queue rows
- global-search task results and any compact task citations where space allows

Keep category visually secondary to title, status, assignee, due date, and
priority. On existing three-cell task and board cards, place it in the compact
type/badge line rather than adding a fourth metadata cell that compresses
assignee, due date, and priority. It should be a compact text badge, not a large
color system. If color is later added, pair it with the label and keep the
palette stable and accessible.

The selector and filter must support keyboard navigation, screen-reader labels,
zoom, mobile wrapping, and the longest localized label. Never rely on color
alone. Pending and failed states need readable text and `aria-live` only where
the state changes while the control is open; card grids should not announce
dozens of background updates.

## Data Model

Add nullable current-state columns to `entities` in the next migration (likely
`0058_task_categories.sql`):

```text
task_category                         text nullable
task_category_mode                    text nullable  -- automatic | manual
task_category_source                  text nullable  -- llm | user; origin of displayed value
task_category_status                  text nullable  -- pending | ready | failed
task_category_applied_input_hash      text nullable
task_category_requested_input_hash    text nullable
task_category_taxonomy_version        text nullable
task_category_updated_at              timestamptz nullable
```

Mode and source are intentionally separate. `mode` controls whether a future
model result may write; `source` explains who produced the value currently on
screen. They differ while a previous human value is retained during an explicit
return to automatic mode.

Add a partial index shaped for the actual queries:

```text
(team_id, task_category, updated_at, id)
WHERE type = 'task' AND archived_at IS NULL AND merged_into_id IS NULL
```

Keep the category vocabulary as a shared TypeScript constant and Zod enum,
not a Postgres enum. The repo already keeps per-object status vocabularies in
application code; category labels will evolve through model evaluation and
should not require an enum migration for every wording change. Add database
checks that every task-category state column is null for non-task rows and that
mode/source/status contain only supported values. Validate the exact category
vocabulary in every application write path. When an object changes from a task
to another type, clear all task-category state transactionally; when it changes
into a task, initialize automatic pending state and enqueue after commit.

Add an append-only `task_category_assignments` table for operational and model
provenance:

```text
id, team_id, entity_id, category, source, actor_user_id,
mode, confidence, model, prompt_version, taxonomy_version, input_hash,
outcome, failure_code, latency_ms, created_at
```

`outcome` distinguishes `applied` from `discarded_stale` and
`discarded_human_override`, plus terminal `failed` attempts when useful for
operations. Human rows have no model or confidence. This table supports
correction-rate metrics and debugging without putting model metadata on every
`ObjectRow` response. Use a composite `(team_id, entity_id)` foreign key to the
existing team-scoped entity key, cascade on entity/team deletion, and add
indexes for entity history and prompt/model outcome reporting. Do not duplicate
the classification packet or task content into this table.

Also insert an applied `object_changes` row with `field = 'taskCategory'` for
each actual category change. Do not route automatic assignments through the
current general `updateObject` side effects: that path creates system timeline
events, reconciliation direct-write outputs, notifications, summary refreshes,
and embeddings that do not all make sense for a derived label. Instead, add
category-specific scope methods that preserve team isolation and audit while
avoiding unrelated fan-out. Document this derived-field authority boundary in
the object architecture docs when implemented.

### Shared read and write contracts

Extend the shared contracts with:

```ts
type TaskCategory = (typeof TASK_CATEGORIES)[number];
type TaskCategoryMode = 'automatic' | 'manual';
type TaskCategoryStatus = 'pending' | 'ready' | 'failed';

interface ObjectRow {
  taskCategory: TaskCategory | null;
  taskCategoryMode: TaskCategoryMode | null;
  taskCategorySource: 'llm' | 'user' | null;
  taskCategoryStatus: TaskCategoryStatus | null;
}

interface ObjectListFilter {
  taskCategory?: TaskCategory | TaskCategory[];
  taskCategoryNull?: boolean;
}
```

Update both object-row mappers in `packages/shared/src/objects/index.ts` and
`packages/shared/src/boards/index.ts`, plus the client-safe mirror in
`packages/shared/src/objects/types.ts`.

Expose category mutations as narrow methods on `scope.objects`, for example:

- `setTaskCategory(entityId, category, actor)` for a human override
- `resetTaskCategoryToAutomatic(entityId, actor)` for explicit opt-in to a new
  LLM assignment
- `retryTaskCategory(entityId, actor)` for a failed automatic task
- `applyTaskCategoryClassification(input)` for a guarded worker write

The worker method must never accept an arbitrary team id without the
`withTeam(db, teamId, ...)` scope and must verify `type = 'task'`.

### State transitions

| Event | Category value | Mode | Source | Status | Requested hash |
| --- | --- | --- | --- | --- | --- |
| New task | null | automatic | null | pending | current packet hash |
| First LLM success | predicted | automatic | llm | ready | applied hash |
| Eligible task context changes | retain previous | automatic | retain previous | pending | new packet hash |
| Later LLM success | predicted | automatic | llm | ready | applied hash |
| LLM terminal failure | retain previous, or null if none | automatic | retain previous | failed | failed hash |
| User selects category | selected | manual | user | ready | null |
| User chooses automatic | retain selected | automatic | user until success | pending | current packet hash |
| User retries failure | retain previous | automatic | retain previous | pending | current packet hash |
| Type changes away from task | null | null | null | null | null |

Enforce these invariants in the narrow write methods and encode the stable ones
as database checks where practical:

- non-task rows have all task-category fields null
- manual mode always has a non-null category, `source = user`, `status = ready`,
  the current taxonomy version, and no requested hash
- automatic ready state has a non-null category, `source = llm`, and matching
  applied/requested classifier hashes
- automatic pending/failed state may retain a prior category and source; a null
  category means no successful assignment has ever been applied
- only automatic mode can have a requested classifier hash
- every state-changing method checks the expected prior mode/requested hash so
  retries and stale clients cannot silently clobber newer state

The transition into `pending` and requested-hash write should occur in the same
database transaction as the triggering canonical change when possible. Redis
enqueue happens after commit. This lets the janitor identify lost enqueues
without guessing from category nullability.

Automatic category writes must not modify `entities.updated_at`. Otherwise a
historical backfill would reorder every task, invalidate cursor expectations,
and make old work look recently changed. Use `task_category_updated_at` for
category freshness. A direct human category edit may update canonical
`updated_at` if that matches the existing object-edit contract, but this choice
must be explicit and tested.

## Classification Architecture

### Model boundary

Add a separately named model config such as `TIMELINE_MODELS.taskCategorization`
so this workflow can change model pins independently from extraction, agent,
and object summaries. It may initially point at the same inexpensive structured
model as summarization.

All inference goes through `llm.chatStructured()` with a Zod schema containing:

```text
category: one of TASK_CATEGORIES
confidence: number from 0 to 1
```

Do not ask for or persist free-form chain-of-thought. A short optional reason
may be retained only in restricted eval artifacts; it is not needed for the
product response.

Task titles and metadata are untrusted content. Fence them as data and instruct
the classifier to ignore embedded directives, URLs, provider instructions, or
requests to change the taxonomy. Invalid structured output fails the job rather
than being coerced into an arbitrary category.

Treat model-reported confidence as diagnostic metadata, not calibrated truth.
Do not expose it to users or use a fixed threshold until the live eval measures
how confidence maps to correctness for the chosen model. If confidence proves
uncalibrated, remove it from product decisions while retaining exact-label and
correction metrics.

### Input packet

Use a small, deterministic packet so classifications are affordable and
repeatable:

- task title
- at most a few sanitized, human-readable aliases when they add a real title
  variant; exclude URLs, provider ids, issue keys, and opaque identifiers
- whitelisted human-readable object metadata such as a description, if present
- linked parent object's title and type via the existing `child` relationship
- integration provider and external object type, when present

Do not include board-local `nextStep`, notes, lane, or custom fields in v1. The
same task may appear on multiple boards with different board-local state, so
those fields do not define one canonical task category.

Do not include status, assignee, owner, priority, due date, created/updated
timestamps, or completion state. Those fields do not determine functional
category, and including them would make ordinary workflow edits invalidate the
classification packet even though they intentionally do not enqueue a job.

Do not include private raw-event evidence in a category that is displayed on a
team-visible task. Do not feed arbitrary serialized metadata or all connected
work to the classifier. Category should not become a side channel for private
source content.

Canonicalize this packet and hash it with one classifier version that covers the
prompt, taxonomy, model-input schema, and configured primary model pin. The
input hash is the idempotency and stale-result boundary. Record the actual model
used when a fallback serves the call. Log packet size and truncation flags
without logging its content.

### Queue and worker

Add a dedicated `task-category` queue rather than coupling category latency and
failure to the object-summary queue.

```text
canonical task create/eligible update commits
  -> enqueue { teamId, taskId, inputHash, trigger }
  -> worker re-reads the task through withTeam
  -> skip archived, merged, non-task, unchanged, or human-overridden rows
  -> llm.chatStructured(classification packet)
  -> transactionally re-read and compare requested hash/mode
  -> apply category + assignment/audit rows, or record discarded outcome
  -> revalidate/read freshness through normal page navigation or client refresh
```

Use a job id containing team id, task id, and input hash. This deduplicates
identical work while allowing a title change to enqueue a new job.

Queue on:

- every canonical task creation, including accepted agent suggestions and agent
  tool creates, because those paths converge on `objects.createObject`
- title/alias changes while category mode is automatic
- changes to the small classifier metadata allow-list while category mode is
  automatic
- parent relationship link/unlink changes while category mode is automatic,
  because parent title/type is part of the packet
- a supported object type change into `task`
- explicit **Use automatic category**
- explicit retry from a failed automatic state
- the bounded backfill command

Do not queue on status, assignee, priority, or due-date changes. Do not queue
while `task_category_mode = 'manual'`. The existing suggestions LLM may know
that a proposal is a task, but it should not supply the canonical category in
v1; using the dedicated classifier keeps one prompt, taxonomy, and eval path for
manual, agent-created, and integration-created tasks.

### Concurrency and failure rules

The most important race is a user edit while an LLM request is in flight.
Before applying a result, the worker must lock/re-read the row and require all
of the following:

- it still belongs to the same team and is an active unmerged task
- its `task_category_requested_input_hash` equals the job's input hash
- its category mode is still `automatic`

Otherwise record a discarded assignment and leave the row unchanged. A later
model response can never overwrite a human selection.

Retry transient model/provider failures with bounded exponential backoff. Treat
schema errors and invalid categories as visible worker failures. After terminal
failure, conditionally set status to `failed` only when the requested hash and
automatic mode still match; a stale failure must not replace a newer pending or
manual state.

Extend the janitor sweep to re-enqueue automatic tasks stuck in `pending` past
a short grace period, not merely tasks whose category is null. This covers
reclassification of tasks that retain an older category. Cap each sweep and
page by id, matching the existing janitor pattern. Job attempts must be
idempotent: duplicate successes may add at most one applied assignment/change
for the same entity and requested hash.

### Cost, rate, and capacity controls

The packet should normally stay below a few hundred tokens and the output below
50 tokens. Before rollout, measure real input/output usage and estimate the full
active-task backfill cost with the configured model.

- give the worker independent concurrency and per-team rate limits so one large
  backfill cannot starve interactive AI work or other teams
- backfill through bounded batches with pause/resume and a maximum enqueue count
- record model/prompt/taxonomy versions and token/cost telemetry through the
  existing LLM observability boundary
- stop or slow backfill automatically when provider error rate or queue age
  crosses an operational threshold
- make classification failure non-blocking for task create/update actions

Do not add a second provider SDK or bypass `llm.chatStructured()` for cheaper
calls.

## Filtering and API Propagation

Update every shared query path, not just the Tasks page:

1. Add category conditions to `objectListConditions()` and `searchObjects()` in
   `packages/shared/src/objects/index.ts`.
2. Add the same nested object conditions to
   `boardItemObjectFilterConditions()` in
   `packages/shared/src/boards/index.ts`.
3. Include the category in object text search so an explicit category label is
   searchable, while keeping equality filters as the reliable path.
4. Add `category` to `WORK_FILTER_PARAM_KEYS`, `WorkFilterState`, parsing,
   active-filter detection, URL preservation, and task/object/board mapping.
5. Update cursor pagination and count tests to prove filter and count use the
   same conditions.
6. Serialize `task_category` in chat-agent and outbound MCP object/task results;
   add validated category inputs to structured search/list tools.
7. Include category in Work Queue DTOs and global-search task presentation.

All database reads remain behind `withTeam`; the new index starts with
`team_id`. Add an explicit cross-team filter test because category must not
become a bypass around the existing team boundary.

Keep wire changes additive. Existing agent/MCP callers that omit category must
receive the same rows as before. Use the stable category key on the wire and the
localized label only in UI. Unknown or retired keys are rejected on writes and
filters; legacy stored keys remain readable until an explicit taxonomy
migration maps them.

Category is structured retrieval metadata. Do not automatically re-embed the
task, invalidate generated object summaries, or make semantic search depend on
category in v1. Add category to structured tool output and equality filtering;
revisit embedding text only if real queries show that semantic category language
is valuable.

### Async UI freshness

Worker database writes cannot directly refresh an already-open Next.js screen.
Without an explicit freshness path, `Categorizing…` could remain visible until
the user navigates or reloads even though the job finished.

Add a bounded, batch category-state read for visible task ids. Task and object
clients poll only while at least one visible task is `pending`, merge completed
states into their existing row overlay, back off after repeated errors, and
stop after a short ceiling such as 60 seconds. The selected task/object detail
may continue with a slower retry affordance after the ceiling. Do not start one
timer or request per card. Boards and Work Queue can adopt the same batch helper
or refresh on navigation in the later-consumer slice.

Manual mutations continue to call the existing cross-surface revalidation
helper and update optimistically. A worker result must not overwrite a newer
manual optimistic value; compare category mode/status timestamps or mutation
versions before merging.

## Security, Privacy, Audit, and Data Lifecycle

- Category reads and writes use `withTeam`; assignment history uses composite
  team/entity foreign keys so a guessed entity UUID cannot create cross-team
  history.
- Classification input is limited to team-visible canonical task/object data.
  Never enrich a shared category from private or `specific_users` raw events.
- Task text is fenced as untrusted input. Prompt-injection cases are a release
  gate, not only a unit test.
- Analytics contain keys, states, timings, counts, model/prompt/taxonomy
  versions, and correction transitions only—never task or parent text.
- Assignment history must be included in team export or explicitly documented
  as internal operational metadata. Team/entity deletion cascades remove it.
- Backups and restores include the new table and indexes through normal Postgres
  coverage; no new external data store is introduced.
- Automatic assignments and human overrides appear in object change history,
  but automatic runs create no inbox notification, calendar effect, timeline
  moment, reconciliation proposal, or external webhook by default.
- Add an ADR or update the object-memory ADR to document why this derived,
  reversible organizational field may be applied without approval while
  factual and lifecycle changes remain approval-backed.

## Testing Strategy

Tests should assert visible behavior and persisted authority rules rather than
private helper calls.

| Layer | Required coverage |
| --- | --- |
| Pure/unit | Taxonomy/key/label/version uniqueness; Zod validation; deterministic packet/hash and truncation; state transition reducer; URL parsing; OR-within/AND-between filter semantics; `Uncategorized` sentinel; category badge/select rendering |
| Migration/schema | Existing non-task and task rows migrate safely; checks reject impossible states; composite team/entity FK; cascading delete; type-away/type-into-task transitions; down/rollback procedure is documented even if migrations remain forward-only |
| DB integration (PGlite) | Create/read/filter/count/search; null/pending/failed filtering; non-task rejection; team isolation; assignment/change audit; manual override; reset/retry; previous-value retention; stale success/failure and in-flight human-edit races; archive skips; duplicate idempotency |
| PostgreSQL query QA | `EXPLAIN (ANALYZE, BUFFERS)` on representative task/object/board category filters and counts; partial index usage; no regression for unfiltered queries; category backfill does not reorder `updated_at` cursors |
| Queue/worker | Enqueue after all canonical create paths and eligible context/type/relationship changes; job-id dedupe by requested hash; model failure retry; invalid output; lost-enqueue janitor recovery for retained prior values; no reclassification for ordinary status/due edits; no notifications/timeline/reconciliation spam; per-team fairness |
| Web actions/components | Valid manual update/reset/retry/undo; permission and invalid-category rejection; optimistic card update; bounded batch polling; stale poll response protection; task/object/board filter propagation; category on every task card/row; non-task cards without a badge; bulk category change and bulk-auto confirmation; accessibility states |
| Agent/MCP | Category serialized in results; “list Engineering tasks” applies the structured filter; unknown category rejected; pending/failed fields are not misrepresented; existing clients remain compatible with the additive field |
| Export/operations | Team export disposition; assignment-history cascade; dry-run cost report; resumable/pauseable backfill; kill switch; metrics contain no task text |
| E2E | Create a task, observe live automatic category without reload, filter to it, change it manually, undo or reload, edit the title, prove override persists, reset to automatic without badge disappearance, observe reclassification, and exercise terminal failure/retry |

New test files and major suites should begin with a short business-intent
comment, following the repository test strategy.

### Completion commands for implementation

At minimum, the implementation must pass:

```text
pnpm validate
pnpm run doctor                    # score 100 + No issues found!
pnpm test:eval
pnpm test:dist-imports
```

Run the nearest shared/worker/web suites during development. Because this
touches shared object exports, worker behavior, agent tools, and user-facing
cross-surface filtering, the final implementation should also run `pnpm test`
and the focused Playwright task-category flow. If category is added to
reconciliation schemas or output planning, also run
`pnpm test:reconciliation-eval`; it is not required for the recommended
post-canonical derived classifier alone.

## LLM Evaluation Plan

Unit tests prove safety and plumbing; live evals prove the model can classify.
Keep these separate.

### Dataset

Create a versioned manifest with at least 120 hand-labeled cases before
backfilling production data:

- at least 6 clear positive cases per category
- hard boundary pairs: Product/Engineering, Design/Engineering,
  Sales/Customer Success, Operations/Administrative,
  Operations/Finance, Legal/IT Security, Research/Strategy
- short ambiguous titles such as “Review proposal” with and without parent
  context
- multilingual cases representative of actual capture languages
- integration-shaped titles from GitHub, Linear, meetings, Slack, and manual
  task creation
- completed/blocked wording that must not be mistaken for a category
- prompt-injection-shaped titles and metadata
- intentionally unmatched work expected to be `other`

Maintain two views of the cases:

- a balanced diagnostic set with enough cases per category and boundary pair
  to expose weak labels
- a distribution-weighted holdout approximating dogfood/pilot task traffic so
  aggregate accuracy and `other` rate reflect actual use

Keep a meaningful holdout unseen during prompt iteration. Use synthetic, dev
seed, or explicitly approved/redacted examples in the checked-in manifest;
never copy private production task text into the repository.

Each case should contain the exact classification packet, expected category,
acceptable alternatives only where product semantics truly allow them, a
scenario family, and a brief annotator rationale. Avoid weakening the rubric by
adding alternatives after seeing model failures; disputed cases should be
resolved by two human reviewers and the taxonomy wording updated if necessary.

### Metrics and gates

Use a deterministic scorer with these initial release gates:

- exact accuracy at least 0.85 overall
- macro F1 at least 0.75 so large categories cannot hide weak small ones
- at least 0.70 recall for every named category
- report reliability/calibration curves for model confidence; use a
  high-confidence accuracy gate only if evaluation shows confidence is
  calibrated enough to support one
- zero invalid labels and zero instruction-following failures
- `other` selected for no more than 15% of the curated set unless the dataset
  itself contains that proportion of true `other` cases

Report the release gates on both balanced and distribution-weighted views. The
balanced set protects minority categories; the weighted holdout estimates user
experience. A model does not pass by succeeding on only one.

Add a confusion matrix to the eval artifact. The primary improvement loop is to
fix category definitions, tie-breakers, packet context, or prompt wording—not
to special-case titles in production code.

Also report:

- accuracy by input surface, language, title length, and whether parent context
  is present
- context-ablation results comparing title-only with the full safe packet
- repeatability across at least three calls for a small hard-case subset
- regressions against the previous prompt/model/taxonomy version
- reviewer agreement and the number of disputed gold labels

Exact category labels make an LLM-as-judge unnecessary for the primary score.
Use human review for disputed taxonomy semantics rather than substituting a
second model's opinion.

### Test commands

Add:

```text
pnpm test:task-category-eval       # deterministic manifest, scorer, safety, persistence
pnpm test:task-category-eval:live  # real configured classifier, opt-in env flag
```

The deterministic suite belongs in `pnpm test:eval` and CI. The live suite
requires credentials, pins prompt/model versions in its artifact, has a bounded
case count and token budget, and should run manually before taxonomy/prompt/
model changes and on a schedule if CI secrets are available.

### Production quality loop

Emit no task title or other PII in analytics. Track counts and ratios by
category, model, prompt version, and taxonomy version:

- queue lag, success, retry, permanent failure, and uncategorized backlog
- automatic category distribution and `other` rate
- human correction rate overall and by predicted category
- time from task creation to category assignment
- auto-reset rate and repeated corrections
- discarded stale/human-override result count

Sample only appropriately redacted packets into restricted eval artifacts.
Treat sustained human correction above 15%, any category recall regression, or
a sharp rise in `other` as a prompt/taxonomy/model rollback signal. Correction
rate must exclude changes made solely because the task itself changed function;
otherwise product evolution is mislabeled as classifier error.

## Rollout and Backfill

0. **Discovery and taxonomy freeze.** Run the representative-task labeling
   exercise, resolve high-confusion category pairs, publish taxonomy v1, and
   establish baseline page/query performance.
1. **Schema and read compatibility.** Deploy nullable state, assignment
   history, checks, indexes, read types, and additive serialization while all
   categorization flags are off. Existing tasks remain valid. Backfill task rows
   to `automatic/pending` in bounded SQL batches or let the enqueue command set
   state as each row is claimed; do not make a single long migration call the
   model.
2. **Manual path and UI.** Ship filters, badges, single-task editing, override
   persistence, undo, reset/retry, and async freshness before enabling broad
   automatic writes. Manual categorization remains useful even if the model is
   disabled.
3. **Classifier shadow run.** Run the live eval and a dry-run backfill that
   reports distribution, confusion review samples, token usage, and estimated
   cost without updating tasks. Review `other`, hard boundaries, and any
   apparently low-confidence cases.
4. **New-task automation canary.** Enable enqueue for internal/dogfood teams,
   then a small allow-list of pilot teams. Monitor latency, provider errors,
   distribution, corrections, stale discards, and query/UI health.
5. **Open-task backfill.** Run a resumable command that pages the highest-value
   tasks first: open/doing/blocked tasks, then recently completed tasks. It
   defaults to dry-run and requires explicit `--enqueue`, team scope, batch
   limit, and maximum projected cost. Skip archived tasks and every manual-mode
   task.
6. **Broader backfill.** Categorize older completed tasks only if search/filter
   use cases justify the cost. Archived tasks do not need backfill in v1.
7. **Full surface exposure.** Add bulk editing, board refinements, Work Queue,
   global search, agent, and outbound MCP presentation after the core
   task/object paths are stable.

No migration should invent categories with SQL heuristics. The requirement is
LLM-selected categories; existing tasks should use the same versioned classifier
as new tasks.

### Feature controls and rollback

Provide independent server-side controls for:

- automatic enqueue on create/update
- worker consumption
- backfill enqueue
- live category UI/filter exposure if an emergency schema/data issue occurs

The normal rollback is to stop new automatic enqueue and worker consumption
while leaving existing categories and manual editing readable. Because schema
changes are additive, application rollback must tolerate the columns/table
remaining in place. Reverting a bad model/prompt/taxonomy version means pinning
the last known-good classifier, running shadow comparison, and then
reclassifying automatic-mode tasks in bounded batches. Never overwrite
manual-mode tasks during rollback.

Do not delete category values merely because automation is disabled. Preserve
the last successful value and make failed/pending state understandable.

## Product Improvements Beyond the Base Request

These improvements make categories useful rather than merely visible. Keep
them ordered so v1 quality can be measured before categories start driving
more consequential behavior.

### P0: Include with the first useful release

1. **Category count chips on Tasks.** Show compact counts for the current query
   or status scope so users can see workload shape and enter a category in one
   click. Counts must come from the same filtered query semantics as the list.
2. **Fast correction.** After detail editing is trustworthy, allow changing a
   category from the task-card overflow menu without opening the full object.
   A visible undo makes model mistakes feel cheap.
3. **Explain automatic vs manual state.** The selector should say “Automatic”
   or “Set by you” and show retry/update state in detail views. Do not display
   model names, confidence decimals, or internal prompt versions.
4. **Combine categories with existing work dimensions.** Preserve category
   while changing status, assignee, due date, or board lane; category is most
   useful in queries such as “my blocked Engineering work,” not as an isolated
   taxonomy page.

### P1: Add after usage validates the taxonomy

1. **Saved category views.** Let teams save combinations such as “Customer
   Success renewals” or “Unassigned Engineering” using the broader saved-view
   work planned for Work. Do not create a category-specific saved-view system.
2. **Group by category.** Add optional grouping to the Tasks list/table view.
   Avoid category-swimlane kanban by default because status columns already own
   the primary kanban dimension.
3. **Category-aware Work summaries.** Use category as one structured grouping
   in daily digests, handoffs, and Work Queue summaries when it improves
   scanning. Preserve underlying task citations and never infer new work from
   category alone.
4. **Agent correction action.** Let a teammate say “move this to Finance” and
   prepare the same category mutation as the visual selector, with normal
   action confirmation rules. Agent answers should prefer structured category
   filters over title keyword guesses.
5. **Quality review surface for operators.** Show aggregate correction,
   `other`, pending, and failure rates by taxonomy/prompt/model version without
   exposing task content. This is an operational view, not a user-facing AI
   scorecard.

### P2: Consider only with evidence

1. **Team-managed categories.** Consider aliases, hidden built-ins, or a small
   custom-category extension only if multiple pilot teams cannot map work to
   the shared taxonomy. This requires per-team prompt context, stable IDs,
   migration semantics, and team-specific eval samples.
2. **Multiple categories.** Add only if real tasks regularly span two
   independently useful workstreams and users understand AND/OR filtering.
   Multi-label output would require a new eval and UI model, not a column type
   tweak.
3. **Category suggestions from correction patterns.** Aggregate privacy-safe
   correction transitions and reviewed `other` samples to propose taxonomy
   changes to product operators. Never let the model create production
   categories automatically.
4. **Category-based automation.** Routing, notifications, or assignment should
   remain off until correction rates are low, teams explicitly configure the
   rule, and every automation has preview, audit, and undo. A category alone is
   insufficient authority for consequential changes.

## Implementation Surface Map

This is the expected change map; implementation should confirm it again against
the current branch before editing.

| Area | Likely files/modules |
| --- | --- |
| Database | `packages/db/src/schema/entities.ts`, new assignment schema/export, migration + Drizzle metadata |
| Shared taxonomy | new `packages/shared/src/task-categories/` module and public export/subpath |
| Object scope | `packages/shared/src/objects/index.ts`, `packages/shared/src/objects/types.ts`, object tests |
| Board scope | `packages/shared/src/boards/index.ts` and board filter/read tests |
| LLM | `packages/shared/src/llm/models.ts`, classifier prompt/schema/service, deterministic/live eval manifests |
| Queues | `packages/shared/src/queue/queues.ts`, queue exports/tests |
| Worker | new task-category worker/tests, `apps/worker/src/index.ts`, janitor extension, dry-run/backfill script |
| Web filtering | `apps/web/src/lib/work-filters.ts`, tests, `work-filter-bar.tsx`, Tasks/Objects/Boards page parameter propagation |
| Web mutations | `apps/web/src/app/actions/objects.ts`, revalidation helper, batch category-state read |
| Task/object UI | task board/card/list/detail, object index/detail and connected-task cards, shared badge/select components |
| Board/Work/search UI | curated board kanban/table/list, board card detail, Work Queue DTO/row, global-search task result |
| Agent and MCP | shared agent tool schemas/serializers/evals, outbound MCP schemas/serializers/tests |
| Operations | dev seed, team export disposition, analytics event definitions, Sentry/worker tags, package scripts and CI commands |
| Docs | `docs/objects.html`, `design.md`, README/eval commands, `todo.md`, ADR, setup docs only if configuration changes |

## Implementation Slices

### Slice 0: Product validation

- Label the representative task sample with two reviewers.
- Resolve category disagreement hotspots and freeze taxonomy v1.
- Establish query, model-cost, correction, and UI baseline metrics.

### Slice 1: Domain and persistence

- Add taxonomy/constants/version/schema in a small shared task-category module.
- Add migration, Drizzle schema, assignment table, partial index, and exports.
- Extend category mode/source/status state, `ObjectRow`, filters, both row
  mappers, and team-scoped methods.
- Add PGlite tests for isolation, validation, state transitions, type changes,
  audit, idempotency, and human authority.

### Slice 2: Classifier and reliability

- Add the model pin, packet builder, prompt version, schema, scorer, and
  classifier service through `llm.chatStructured()`.
- Add queue APIs, worker startup/shutdown, retries, dedupe, failure tags, and
  janitor recovery.
- Enqueue from canonical task create and eligible title/alias/parent/type
  changes.
- Add guarded stale-result/human-override integration tests.

### Slice 3: Core UI and filters

- Add category to shared Work filters and database/board query conditions.
- Add badge/select components.
- Ship Tasks and Objects filtering, task cards/list rows, task side panel,
  object-task rows, task object detail editing, and bounded pending-state
  refresh.
- Add bulk category editing after the single-row mutation is stable.

### Slice 4: Remaining consumers

- Add badges/columns to board views and side panels, connected-task lists, Work
  Queue, and global search.
- Extend agent tools and outbound MCP filters/serialization.
- Update dev seed with representative categorized tasks.

### Slice 5: Evals, backfill, and docs

- Land the deterministic and live eval manifests, scorer, scripts, commands,
  artifacts, and thresholds.
- Run shadow evaluation, review the confusion matrix, then run the bounded
  backfill.
- Update `docs/objects.html`, `design.md`, setup/operations docs if new env
  controls are introduced, README commands, `todo.md`, and `AGENTS.md` if the
  validation contract changes.

## Acceptance Criteria

- Every newly canonical task enters an observable automatic pending state and
  is categorized asynchronously without blocking task creation.
- Existing active tasks can be backfilled with the same classifier.
- A teammate can change a task category and the choice survives reloads,
  unrelated edits, delayed model responses, retries, and worker restarts.
- A teammate can undo a correction, retry a failure, and explicitly return a
  task to automatic categorization without losing the last category while the
  replacement is pending.
- Category filters work consistently on Tasks, Objects, and Boards, including
  counts, pagination, multiple values, and `Uncategorized`.
- Automatic backfill and reclassification do not change canonical task
  `updated_at`, reorder task lists, or invalidate cursor behavior.
- Task category appears consistently across the agreed task/object/board/Work
  surfaces, updates on open screens within the bounded freshness window, meets
  accessibility requirements, and never appears on non-task objects.
- Agent and outbound MCP structured task queries can filter and return category.
- Category writes are team-isolated, validated, audited, and do not leak private
  evidence into team-visible state.
- Automatic categorization does not create notification or timeline noise.
- New-task categorization, correction, failure-backlog, `other`, performance,
  and product-usage measures meet the launch thresholds or have an explicitly
  accepted exception based on reviewed evidence.
- Automation and backfill can be stopped without removing existing categories
  or breaking manual editing/filtering.
- Deterministic tests, live eval gates, repository validation, React Doctor,
  relevant suites, dist imports, and the focused E2E flow are green.

## Decisions to Confirm Before Implementation

The plan recommends these defaults; changing any of them materially changes the
schema, UI, or eval design:

1. one category per task, not multiple tags
2. fixed product taxonomy in v1, not team-managed category definitions
3. functional categories, not action types such as “bug”, “meeting”, or
   “follow-up”
4. direct automatic assignment as derived organization metadata, with human
   override authority, rather than an approval card for every task
5. `task` only in v1; `follow_up` can be added after usage validates the model
6. retain the last successful category during automatic reclassification and
   failure instead of temporarily clearing it
7. separate authority mode from displayed-value source so explicit auto-reset
   is safe during in-flight work
8. automatic assignments do not modify canonical `entities.updated_at`; decide
   whether direct human category edits should
9. assignment history is included in team export or formally documented as
   internal operational metadata
10. taxonomy v1 is frozen only after the representative-task labeling exercise,
    not solely from the provisional list in this document
