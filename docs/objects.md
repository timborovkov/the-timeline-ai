# Workspace objects

<span id="what-changed"></span>



## Data model

`entities` was widened in place. Existing rows default safely (`status='open'`, `agent_suggested=false`, `archived_at=NULL`), and the resolver keeps using the same canonical-name lookup it always has. `source_event_id` and `agent_suggested` are legacy compatibility fields during the reconciliation migration. New reconciliation-backed writes are moving durable provenance to source refs, reconciliation outputs, and evidence associations, and the public object-create path now forces `source_event_id=NULL` and `agent_suggested=false`. Older object rows and suggested create changes remain read-compatible until cutover finishes. Direct object creates, updates, archives, merges, relationship link/unlink writes, note create/update/delete writes, identity facet create/update writes, and manual board item add/update/remove writes also write applied reconciliation `direct_write` outputs with inline source-payload snapshot refs and source refs to their system audit events, so the audit tables remain useful without being the canonical provenance graph.

Extraction filters low-signal `topic` and `other` mentions before linking facts to objects, so generic noun phrases such as "financial data" or "customer relationships" remain ordinary fact text unless a teammate promotes them into durable object memory. The same quality gate keeps everyday SaaS/tool mentions such as GitHub, Google Drive, TikTok, Slack, or Zoom from becoming ordinary company objects; durable tool choices should be modeled as decisions or updates to a specific existing artifact. Cleanup archive suggestions can still retire existing generic objects that only have weak fact links; human-authored notes and object relationships protect objects from that archive path.

| Table                                 | Purpose                                                                                                                                                                                                                                                                                      | Key columns                                                                                                                                                       |
|---------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `entities` (extended)                 | Workspace objects of any kind.                                                                                                                                                                                                                                                               | `status`, `stage`, `priority`, `owner_user_id`, `assignee_user_id`, `due_at`, `task_category*`, legacy `source_event_id`, legacy `agent_suggested`, `archived_at` |
| `task_category_assignments`           | Append-only model, user, failure, and discarded-result history for task categories.                                                                                                                                                                                                          | `category`, `mode`, `source`, model/prompt/taxonomy versions, `input_hash`, `outcome`, and bounded telemetry                                                      |
| `task_category_project_invalidations` | Durable recovery cursors for bounded project lifecycle category fan-out.                                                                                                                                                                                                                     | `team_id`, `project_id`, `project_version`, `after_task_id`, timestamps                                                                                           |
| `entity_relationships`                | Explicit, human/agent-authored links between objects.                                                                                                                                                                                                                                        | `(from_entity_id, to_entity_id, kind)` unique; kinds: `parent`, `child`, `related`, `blocks`, `blocked_by`, `duplicate_of`                                        |
| `object_changes`                      | Immutable audit log — one row per modified field per save.                                                                                                                                                                                                                                   | `actor_kind` (user/agent/system), `status` (applied/suggested/rejected), `previous_value`, `new_value`, legacy `source_event_id`                                  |
| `object_notes`                        | Team discussion comments on an object (Linear-style activity + comments). Authors can edit or soft-delete their own comments. Accepted agent Q&A still lands here as comments. Existing rows stay comments — there is no parallel comments table.                                            | `author_user_id`, `body`, soft `deleted_at`                                                                                                                       |
| `object_note_mentions`                | Resolved `@mentions` on a comment. User mentions fan out to `kind = 'mention'` inbox rows (self-mentions are stored, not notified). One agent mention per comment (`@TheTimelineBot`, still accepting `@timeline` / `@bot` / `@agent`) can enqueue an in-thread reply from The Timeline Bot. | `kind` (user/agent), `mentioned_user_id`, `start_offset`, `end_offset`                                                                                            |
| `object_views`                        | Per-user, per-object last-visit timestamp. Drives "since your last visit".                                                                                                                                                                                                                   | PK `(team_id, user_id, entity_id)`                                                                                                                                |
| `notifications`                       | In-app inbox. v1 fan-out is in-process inside `updateObject`.                                                                                                                                                                                                                                | `kind`, `entity_id`, `object_change_id`, `summary`, `read_at`                                                                                                     |
| `chat_sessions`                       | Persisted conversations, optionally pinned to an object, with a dashboard view trail.                                                                                                                                                                                                        | `created_by`, `pinned_entity_id`, `context_trail`, `archived_at`                                                                                                  |
| `chat_messages`                       | One row per role transition. `content` is structured JSON.                                                                                                                                                                                                                                   | `session_id`, `role`, `content` (jsonb)                                                                                                                           |

See the base entity migration [`0005_phase4_entities_facts.sql`](../packages/db/drizzle/0005_phase4_entities_facts.sql), the object-field migration [`0007_phase8_objects.sql`](../packages/db/drizzle/0007_phase8_objects.sql), the object list/search index migrations [`0043_object_list_cursor_index.sql`](../packages/db/drizzle/0043_object_list_cursor_index.sql) and [`0048_object_search_indexes.sql`](../packages/db/drizzle/0048_object_search_indexes.sql), and the uniqueness no-op explanation in [`0009_phase8_entity_unq.sql`](../packages/db/drizzle/0009_phase8_entity_unq.sql) for the exact DDL history.

<span id="object-types"></span>

## Object types

The Postgres enum `entity_type` is the single source of truth. Use `objects.OBJECT_TYPES` at runtime and `objects.ObjectType` at the type level — derived from the drizzle enum so adding a new type requires only a schema + migration change.

| Origin             | Types                                                                              | Naming uniqueness                                                                                                                        |
|--------------------|------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| Extraction-derived | `person`, `company`, `project`, `topic`, `other`, `vendor`, `document`, `decision` | Case-insensitive unique per `(team, type, name)`. The resolver re-uses canonical names across captures.                                  |
| User-authored work | `task`, `follow_up`, `deal`, `incident`, `hiring_loop`                             | Unmerged rows still use case-insensitive uniqueness per `(team, type, name)`; duplicate-name attempts surface as friendly create errors. |

<span id="status-and-stage"></span>

## Status, stage, priority, due

Status vocabularies are *free-form text*, validated at the app layer because they differ by type. The UI ships per-type dropdowns:

| Type              | Status options (default)                            |
|-------------------|-----------------------------------------------------|
| `deal`            | open · qualified · proposal · won · lost            |
| `task`            | backlog · open · doing · blocked · done · cancelled |
| `follow_up`       | todo · doing · done · cancelled                     |
| `project`         | planning · active · on_hold · shipped · cancelled   |
| `incident`        | open · mitigated · resolved · postmortem            |
| `hiring_loop`     | sourcing · interviewing · offer · hired · closed    |
| `decision`        | draft · proposed · accepted · rejected              |
| *everything else* | open · active · archived                            |

`stage` is opt-in (used by kanban boards), `priority` is a smallint 1–4 with 1 = urgent, and `due_at` is a tz-aware timestamp. Conversation review should propose priority on goals and tracked work when urgency is in the evidence. Do not add a second importance score. Hub role (goal vs work vs finding vs mention) is behavioral and lives in [relational-memory.md](./relational-memory.md); findings and one-off mentions should not mint sibling Timeline objects.

<span id="task-categories"></span>

## Task categories and projects

Every active canonical `task` enters an asynchronous automatic-category state. The dedicated worker selects one product-owned functional category through the shared LLM boundary. The current value is indexed on `entities`; append-only assignment and object-change rows retain the model version, taxonomy version, outcome, and human corrections. Automatic refreshes preserve the last successful label and do not move `entities.updated_at`, create timeline events, or notify teammates.

<div class="callout">

**Human authority wins.** A teammate's category is sticky until they choose *Use automatic category*. Manual changes support immediate audited undo, and stale model results are discarded by requested-input hash under a row lock.

</div>

Approval-backed task creation previews category and project together. `suggest_task`, `suggest_object_memory`, and background conversation review all normalize the same existing/new-project contract before classification. Background proposals also mention-qualify existing company, vendor, deal, and project hubs from the evidence (including meeting titles, Slack channel names, Monday board names, and other container labels): a unique project becomes `parentObjectId`; a unique client becomes an `object_relationship` `related` edge. Recency dumps and embedding similarity are not that join. See [ADR 0015](./adr/0015-proposal-writes-qualify-hubs-from-mentions-and-container-labels.md). Background review classifies its maximum 25 proposed tasks in one bounded structured LLM call, preserving proposal-time previews without serial provider calls. Legacy pending task approvals that predate the primary-project contract may still reference another object type; acceptance preserves that reference as a generic `child` relationship, not as the task's primary project.

A task's optional primary project uses the existing `entity_relationships` graph: task → project with `kind='child'`. The shared object scope locks and validates the active project before the task, enforces zero-or-one primary project, and rejects noncanonical inverse or ambiguous project edges during type promotion. Database compatibility triggers also canonicalize legacy inverse writes and prevent rolling-version writers from introducing a second primary project. Project quick add, manual set/change/remove, agent suggestions, filters, Connected Work, exports, and MCP reads all use that same edge. Archived projects remain visible on existing tasks; project rename, valid related-object promotion, and merge invalidate automatic category context in resumable 500-task pages. Archived tasks defer that work; unarchiving recomputes the current task/project input and enqueues classification when it changed, or re-enqueues an unchanged pending request whose earlier job may have been discarded while archived. Project and category controls remain unavailable on archived task detail pages until the task is unarchived. A database outbox cursor survives Redis handoff failures, and each page rechecks automatic mode and task/project state so a concurrent human correction always wins. Category-filtered pages use transactional per-category revision rows plus bounded pending checks, avoiding cross-host clock comparisons and repeated full-result scans.

See [ADR 0011](./adr/0011-task-category-is-reversible-derived-state.md) for the authority model, proposal behavior, and task-to-project relationship contract.

<span id="audit-trail"></span>

## Audit trail

Every manual object change — to an object's fields, identity facets, notes, or relationships — writes rows in one transaction: a system-source `raw_events` row (so the change appears on the team timeline), one structured history row per modified field where applicable, and an applied reconciliation output with source refs to the raw event and payload snapshot. Normalized evidence stays in evidence lineage rather than output source refs. Manual board item add/update/remove writes follow the same provenance rule while keeping `board_item_changes.source_event_id=NULL` for new history rows. During the migration, legacy rows may still thread the `raw_events.id` through `source_event_id`; new reconciliation-backed provenance should instead cite source refs, output ids, and evidence associations.

Object provenance and board item history read accepted suggestion evidence from the referenced reconciliation output's source refs. Legacy board-history `source_event_id` hints are not promoted into provenance evidence, and multi-source outputs are hidden from the provenance view unless the current viewer can see every cited raw event.

<div class="callout">

**Why two writes per change.** The timeline view treats events as the unit; the object page treats fields as the unit. One save updates both, atomically. `raw_events` stays append-only — even note edits write a *new* event with the new body.

</div>

Field-scoped `propose_object_change` proposals still land as `object_changes.status = 'suggested'`. Broader agent proposals such as `suggest_task` and `suggest_object_memory` use approval bundles and reconciliation projection rows instead. A human accepts or rejects either shape, and the rejected rows stay visible so agent quality is measurable over time.

<span id="notifications"></span>

## Notifications

Inside `updateObject`, after the entity + audit writes commit, the helper inserts `object_changed` notifications for the owner and assignee (deduped, and skipping the actor themselves). Comment `@mentions` insert `mention` rows with `payload.note_id` so Inbox and Work unread pings deep-link to `?comment=` + `#comment-` on the object page. Fan-out is in-process for v1; if volume grows, the same helper can switch to a `notify` BullMQ queue without changing callers.

The inbox view (`/app/inbox`) and header preview sort newest first by `(created_at DESC, id DESC)`. The `notifications_team_user_inbox_idx` index matches that order so paginated inbox queries do not need a separate sort. A partial `notifications_team_user_unread_idx` keeps unread counts and filtered pages fast without scanning a user's read-notification history.

<span id="since-last-visit"></span>

## Since last visit

Each object page write a row to `object_views` when the current user opens it. The render computes `newSinceLastVisit` by counting `object_changes` and `object_notes` created after the user's previous `last_visited_at`, *before* stamping the new visit. Order matters — moving the visit-stamp ahead of the page read would zero the banner forever after the first load.

<span id="chat-sessions"></span>

## Persisted chat sessions

`/api/chat` accepts an optional `sessionId`. Requests with `startNewSession` create a session and return its ID in `x-tl-session-id`; bare requests remain unpersisted. Sessions may be pinned to an object and retain a capped dashboard `contextTrail`.

Stream completion stores a versioned, ordered assistant UI message, including tool inputs, outputs, safe errors and approval decisions. Stable UI message IDs deduplicate user turns and update the same assistant turn during approval continuations under the owner-scoped session lock. Usage, prompt version and tool observability remain separate metadata. Deterministic responses use the same persistence operation with unique per-turn IDs.

Approval continuations claim the saved pending action before execution. The server verifies tool identity, inputs and approval IDs; already-claimed or mismatched actions cannot be replayed. Only the latest assistant turn can be approved; sending a new question makes older approval cards inactive. A claim interrupted before its outcome is saved is shown as interrupted and must be checked against current workspace state before any new action is proposed. Missing legacy tool results display **Result unavailable**, never fabricated success or an indefinitely running spinner. Historical incomplete calls are display-only data, excluded from model tool-call conversion. Old transcript JSON remains readable; no production backfill reconstructs discarded results.

### Direct chat workspace actions

The web agent can create boards, rename/configure them (including lanes and membership settings), archive boards, restore archived objects, create/edit/delete notes, and add/remove relationships, alongside existing object, board-card and calendar mutations. Each direct canonical mutation requires in-chat approval and uses the same team-scoped domain services as the UI. Read-only and proposal-only agent surfaces do not receive these mutation tools. Incidental memory continues through proposals.

Board creation uses shared template defaults (pipeline for CRM), with membership suggestions off unless explicitly requested. `get_board` provides lane IDs and the current settings revision. Board settings/archive, note edits/deletion and restoration reject stale approved state under the mutation lock. Lane edits preserve retained IDs; removing a lane unassigns its cards without deleting objects. Board archiving preserves objects. Private boards remain limited to their creator. Note edits/deletes remain authors-only even when executed by the agent on the user's behalf; audit records retain the agent actor and the real user ID.

Object reads expose note revisions and relationship IDs/endpoints; `get_object_note` supports targeted lookup beyond bounded summaries. Approval previews show effective defaults, before/after values and relationship direction. Successful mutations refresh the workspace views. Tool selection includes common plural/action phrases, bounded short-follow-up context and pending approval tools without enabling every external integration.

Sessions without a title get a short title from the first user turn on stream finalize, including retry attempts on later turns if the first title write failed. The title generator uses the shared LLM wrapper, falls back to a sanitized first-message snippet if the model call fails, and appends a numeric suffix under the chat-session write lock when another visible session already has the same title. Automatic title writes do not bump the session's activity timestamp; only persisted turns should affect sidebar recency.

Persistence failures are warn-logged, not surfaced to the user — the assistant reply has already streamed by the time the write attempts.

<span id="helpers"></span>










Current access and mutation boundaries are owned by `scope.objects`, `scope.boards` and the approval services. Use [domain ownership](architecture/ownership.md); do not infer current tools/routes from old migration inventories.


## Automatic membership suggestions

Boards remain curated work surfaces. **Suggest board changes** is opt-in in board
creation and settings; existing boards default to off. Board purpose explains why
the board exists, membership criteria explain what belongs and when it should
leave, and stages describe progress after joining. Guided examples help users write
inclusion and exclusion criteria. Every suggested addition or removal requires its
own approval, separate from the object change that triggered evaluation. Direct
manual membership edits are themselves the human decision.

**Restrict allowed object types** is independent of qualification. When enabled it
requires at least one type and applies to manual add, quick create, agent proposals
and approval acceptance. Recommended types without strict mode only rank discovery.
Changing restrictions does not evict existing items; an existing member that fails
the restriction can receive a removal proposal. Removal archives the specific board
membership, preserving the object and board history. Removal proposal identities
include the membership version and source dependency, so an explicit source-free
rescan can replace a proposal whose source became unavailable or one made
stale by a board-item edit. Approval locks the membership before its entity and board,
matching manual item edits. Membership approval target locks fail fast when busy,
so board-first lane removal and item-first manual edits cannot form a blocking
cycle with approval; the user can retry once the other edit completes. Transactional qualification checks also hold shared
locks on supplied note/identity/relationship rows and all referenced objects through
application, including currently inactive neighbors. Busy dependencies fail fast
for retry rather than introducing a reversed lock-order wait. Addition identities also include the latest manual
membership decision, allowing a later explicit scan to replace a superseded
proposal after a manual add/remove cycle.

Committed object creates/updates, notes, identity facets and relationship changes
persist qualification requests in the canonical write transaction. Relationship
changes request both endpoints. Company/project replacement stores old and new
endpoint IDs on the already-locked child request; workers enqueue those endpoints
after commit, without making the edit acquire old-parent locks. Object updates persist a neighbor-expansion flag in the same transaction. The
worker expands relationships in durable batches of 50, acquiring entity key locks
before inbox locks. Busy entity keys abort the expansion for durable retry instead
of waiting against canonical relationship lock order, so related names/statuses are reevaluated without locking
neighboring entities during the originating object edit. Pending or rejected object proposals do not trigger
qualification. The durable inbox coalesces per member/object, uses leases and
version-checked completion, and retries failures with bounded backoff. Queue outages
cannot lose committed requests. Derived endpoint work retains the originating request
time; coalescing preserves newer requests and their source/operator attribution, so
a delayed expansion cannot override a newer manual membership decision. An explicit
scan replaces an older pending source dependency and uses the scanning actor's
operator attribution, so unavailable sources or expired earlier sessions cannot
swallow the requested recheck. Scan enqueueing and cache invalidation share one
transaction. Proposal publication, semantic supersession, no-action records and
evaluation cache writes share a transaction that locks parent entity/board keys
before rechecking the inbox version. An older worker cannot supersede a newer
scan's proposal or repopulate its cleared cache. Busy parent keys fail fast to
avoid blocking canonical writes in reverse lock order. Generic
relationship endpoints enqueue in entity-ID order, matching worker inbox locks. The worker excludes suspended users before selecting each workspace's next request. It discovers routing metadata globally and
uses the originating member's `withTeam` scope for workspace reads and proposals;
service-principal writes do not borrow a member's authority. Impersonated requests
retain their operator session through coalescing and discovery; the worker restores
real-actor attribution and rejects expired or revoked sessions before qualification.

Qualification applies deterministic type eligibility before shared-model inference.
It reads bounded committed object facts, notes, identities and relationships. Explicit
exclusion can support removal; missing information cannot. Model evidence keys must
refer to supplied facts. Proposals retain the criteria revision and fact snapshot,
use the existing reconciliation-backed suggestion lifecycle, and remain private to
the originating member. Source visibility is checked again by the approval engine.
No-action outcomes also appear in reconciliation diagnostics.

Accepting a proposal rechecks current criteria, object facts, membership and type
restrictions within the same transaction as the membership mutation. Source-backed
items retain explicit evidence dependencies and lock available sources during acceptance.
Revising proposal wording preserves the original qualification and membership-version guards. Newer manual membership decisions take precedence. A removal for a
previous membership cannot remove a later re-added membership. Evaluated fact/policy
fingerprints suppress repeated decisions, including declined proposals. Evaluation
caches and private proposal identities include the originating member, preserving
private edits and review history when another member scans the same board. Relevant
fact or criteria changes allow reevaluation. Disabling suggestions invalidates pending
automatic proposals during review, stops new qualification and retains current members.

The board's **Membership suggestions** disclosure offers a read-only preview of up
to three recent objects and an explicit **Check existing objects** action. Existing
objects are queued in batches of 50, with continuation shown to the user. This also
provides an explicit recheck of previously evaluated objects. Matching proposals are
reviewed through the board-filtered Approvals page; there is no second approval store.
Saving criteria alone does not scan historical objects.

Discovery excludes inactive workspaces and selects at most one due request per workspace before applying its global
batch limit, so a bulk scan cannot occupy every discovery slot.

Operational bounds: at most five boards per request pass, one pass per team per 30
seconds, 30-second model timeout, 1,000 output tokens and a 48,000-character facts
budget. Oversized or incomplete facts require manual review. Failed requests retain
a safe failure code and retry time in `board_qualification_requests`; no model or
customer content is logged. New object writes reset failed work for their current
version. Apply the board qualification migration before running the updated app or
worker. Deployment is a separate operation.
