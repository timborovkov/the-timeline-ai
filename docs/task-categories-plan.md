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
card can briefly show `Categorizing…` or no badge. The categorization worker
then assigns and displays a category without requiring approval. This is a
low-risk derived organizational label, not a fact, lifecycle transition, or
source-authored business field.

If the model call fails, the task remains `Uncategorized`; the queue retries and
the janitor repairs lost enqueue attempts. Task creation itself must never fail
because categorization is unavailable.

### Manual change and authority

Task detail and object detail should expose a Category select containing the
taxonomy plus **Use automatic category**.

- Selecting a category writes a human override immediately.
- A human override is sticky across task title, status, assignee, due date, and
  context changes.
- **Use automatic category** clears the override, shows a pending state, and
  enqueues a new classification.
- The Tasks bulk toolbar should support setting a category for selected tasks.
  Bulk auto-reset can follow once the single-task path is proven.
- Automatic changes should not create inbox notifications or a noisy timeline
  event. They should remain inspectable in object change history.

### Filters

Add a multi-select `category` URL parameter to the shared Work filter state.

- Tasks: show Category next to Status/Assignee and support multiple categories
  plus `Uncategorized`.
- Objects: a category filter implicitly returns task objects only. Preserve the
  selected value in pagination and type navigation.
- Boards: filter on the category of the underlying object; non-task board
  items do not match a selected task category.
- Work Queue: v1 shows the badge but does not need a separate queue filter
  unless Work adopts the full shared filter bar.
- Agent and outbound MCP list/search tools should accept category filters so
  “show Engineering tasks” has the same semantics as the visual UI.

Use OR semantics within the category filter and AND semantics between category
and other filters. For example, `engineering,product` plus `status=blocked`
means blocked tasks whose category is Engineering **or** Product.

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
priority. It should be a compact text badge, not a large color system. If color
is later added, pair it with the label and keep the palette stable and
accessible.

## Data Model

Add nullable current-state columns to `entities` in the next migration (likely
`0058_task_categories.sql`):

```text
task_category              text nullable
task_category_source       text nullable  -- llm | user
task_category_input_hash   text nullable
task_categorized_at        timestamptz nullable
```

Add a partial index shaped for the actual queries:

```text
(team_id, task_category, updated_at, id)
WHERE type = 'task' AND archived_at IS NULL AND merged_into_id IS NULL
```

Keep the category vocabulary as a shared TypeScript constant and Zod enum,
not a Postgres enum. The repo already keeps per-object status vocabularies in
application code; category labels will evolve through model evaluation and
should not require an enum migration for every wording change. Add a database
check that `task_category` is null for non-task rows, but validate the exact
vocabulary in every application write path.

Add an append-only `task_category_assignments` table for operational and model
provenance:

```text
id, team_id, entity_id, category, source, actor_user_id,
confidence, model, prompt_version, input_hash, outcome, created_at
```

`outcome` distinguishes `applied` from `discarded_stale` and
`discarded_human_override`. Human rows have no model or confidence. This table
supports correction-rate metrics and debugging without putting model metadata
on every `ObjectRow` response.

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

interface ObjectRow {
  taskCategory: TaskCategory | null;
  taskCategorySource: 'llm' | 'user' | null;
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
- `applyTaskCategoryClassification(input)` for a guarded worker write

The worker method must never accept an arbitrary team id without the
`withTeam(db, teamId, ...)` scope and must verify `type = 'task'`.

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

### Input packet

Use a small, deterministic packet so classifications are affordable and
repeatable:

- task title and aliases
- task status only when it disambiguates completed/cancelled wording; status
  must not determine function
- whitelisted human-readable metadata such as a description or next step, if
  present
- linked parent object's title and type via the existing `child` relationship
- integration provider and external object type, when present

Do not include private raw-event evidence in a category that is displayed on a
team-visible task. Do not feed arbitrary serialized metadata or all connected
work to the classifier. Category should not become a side channel for private
source content.

Canonicalize this packet and hash it with the prompt version. The input hash is
the idempotency and stale-result boundary.

### Queue and worker

Add a dedicated `task-category` queue rather than coupling category latency and
failure to the object-summary queue.

```text
canonical task create/eligible update commits
  -> enqueue { teamId, taskId, inputHash, trigger }
  -> worker re-reads the task through withTeam
  -> skip archived, merged, non-task, unchanged, or human-overridden rows
  -> llm.chatStructured(classification packet)
  -> transactionally re-read and compare input hash/source
  -> apply category + assignment/audit rows, or record discarded outcome
  -> revalidate/read freshness through normal page navigation or client refresh
```

Use a job id containing team id, task id, and input hash. This deduplicates
identical work while allowing a title change to enqueue a new job.

Queue on:

- every canonical task creation, including accepted agent suggestions and agent
  tool creates, because those paths converge on `objects.createObject`
- title/alias changes when the current source is automatic or null
- explicit **Use automatic category**
- the bounded backfill command

Do not queue on status, assignee, priority, or due-date changes. Do not queue
while `task_category_source = 'user'`.

### Concurrency and failure rules

The most important race is a user edit while an LLM request is in flight.
Before applying a result, the worker must lock/re-read the row and require all
of the following:

- it still belongs to the same team and is an active unmerged task
- its current input hash equals the job's input hash
- its category source is not `user`

Otherwise record a discarded assignment and leave the row unchanged. A later
model response can never overwrite a human selection.

Retry transient model/provider failures with bounded exponential backoff. Treat
schema errors and invalid categories as visible worker failures. Extend the
janitor sweep to re-enqueue uncategorized automatic tasks older than a short
grace period so a Redis outage after commit cannot leave tasks permanently
uncategorized. Cap each sweep and page by id, matching the existing janitor
pattern.

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

## Testing Strategy

Tests should assert visible behavior and persisted authority rules rather than
private helper calls.

| Layer | Required coverage |
| --- | --- |
| Pure/unit | Taxonomy uniqueness and labels; Zod validation; deterministic packet/hash; URL parsing; OR-within/AND-between filter semantics; `Uncategorized` sentinel; category badge/select rendering |
| DB integration (PGlite) | Create/read/filter/count/search; partial index-compatible query shape where practical; non-task rejection; team isolation; human override audit; reset-to-auto; stale-result and in-flight human-edit races; merge/archive skips |
| Queue/worker | Enqueue after all canonical create paths; job-id dedupe by input hash; model failure retry; invalid output; lost-enqueue janitor recovery; no reclassification for ordinary status/due edits; no notifications/timeline spam |
| Web actions/components | Valid manual update, invalid category rejection, optimistic card update, task/object/board filter propagation, category on every task card/row, non-task cards without a badge, bulk category change |
| Agent/MCP | Category serialized in results; “list Engineering tasks” applies the structured filter; unknown category rejected; existing clients remain compatible with the additive field |
| E2E | Create a task, observe automatic category, filter to it, change it manually, reload, edit the title, prove override persists, reset to automatic, and observe reclassification |

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
- at least 0.90 accuracy on cases where the model reports confidence >= 0.80
- zero invalid labels and zero instruction-following failures
- `other` selected for no more than 15% of the curated set unless the dataset
  itself contains that proportion of true `other` cases

Add a confusion matrix to the eval artifact. The primary improvement loop is to
fix category definitions, tie-breakers, packet context, or prompt wording—not
to special-case titles in production code.

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

Emit no task title or other PII in analytics. Track counts and ratios by category,
model, and prompt version:

- queue lag, success, retry, permanent failure, and uncategorized backlog
- automatic category distribution and `other` rate
- human correction rate overall and by predicted category
- time from task creation to category assignment
- auto-reset rate and repeated corrections
- discarded stale/human-override result count

Sample only appropriately redacted packets into restricted eval artifacts.
Treat sustained human correction above 20%, any category recall regression, or
a sharp rise in `other` as a prompt/taxonomy/model rollback signal.

## Rollout and Backfill

1. **Schema and read compatibility.** Deploy nullable fields, assignment
   history, indexes, read types, and serialization. Existing tasks remain valid
   and appear as `Uncategorized`.
2. **Manual path and UI.** Ship filters, badges, single-task editing, override
   persistence, and reset-to-auto before enabling broad automatic writes.
3. **Classifier shadow run.** Run the live eval and a dry-run backfill that
   reports distribution/confidence without updating tasks. Review a human
   sample, especially `other` and low-confidence cases.
4. **New-task automation.** Enable enqueue for new canonical tasks and monitor
   latency/failures/corrections.
5. **Bounded backfill.** Add a resumable worker script that pages active
   uncategorized tasks by team/id, defaults to dry-run, and requires an explicit
   `--enqueue` flag. Respect queue/provider budgets and never touch user
   overrides.
6. **Full surface exposure.** Add bulk editing, Work Queue, global search,
   agent, and outbound MCP presentation after the core task/object paths are
   stable.

No migration should invent categories with SQL heuristics. The requirement is
LLM-selected categories; existing tasks should use the same versioned classifier
as new tasks.

## Implementation Slices

### Slice 1: Domain and persistence

- Add taxonomy/constants/schema in a small shared task-category module.
- Add migration, Drizzle schema, assignment table, partial index, and exports.
- Extend `ObjectRow`, filters, both row mappers, and team-scoped methods.
- Add PGlite tests for isolation, validation, audit, and human authority.

### Slice 2: Classifier and reliability

- Add the model pin, packet builder, prompt version, schema, scorer, and
  classifier service through `llm.chatStructured()`.
- Add queue APIs, worker startup/shutdown, retries, dedupe, failure tags, and
  janitor recovery.
- Enqueue from canonical task create and eligible title/alias changes.
- Add guarded stale-result/human-override integration tests.

### Slice 3: Core UI and filters

- Add category to shared Work filters and database/board query conditions.
- Add badge/select components.
- Ship Tasks and Objects filtering, task cards/list rows, task side panel,
  object-task rows, and task object detail editing.
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

- Every newly canonical task is categorized asynchronously without blocking
  task creation.
- Existing active tasks can be backfilled with the same classifier.
- A teammate can change a task category and the choice survives reloads,
  unrelated edits, delayed model responses, retries, and worker restarts.
- A teammate can explicitly return a task to automatic categorization.
- Category filters work consistently on Tasks, Objects, and Boards, including
  counts, pagination, multiple values, and `Uncategorized`.
- Task category appears consistently across the agreed task/object/board/Work
  surfaces and never appears on non-task objects.
- Agent and outbound MCP structured task queries can filter and return category.
- Category writes are team-isolated, validated, audited, and do not leak private
  evidence into team-visible state.
- Automatic categorization does not create notification or timeline noise.
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

