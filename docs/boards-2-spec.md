# Boards 2.0 Spec

Boards 2.0 makes boards curated work surfaces for running team workflows:
sales pipelines, partnership boards, task boards, product catalogs, marketing plans, management
reviews, and similar operating views. The same workspace object can appear on
many boards, but each board keeps its own membership, lanes, item properties,
and history.

## Goals

- Make a CRM-style pipeline useful without showing every company the
  team has ever mentioned.
- Keep boards general enough for tasks, products, services, vendors, projects,
  hiring loops, and custom team workflows.
- Preserve Timeline's memory model: board items wrap workspace objects; they do
  not create a second task or CRM database.
- Keep agent behavior approval-backed unless the user gives a direct command or
  an authoritative source owns the target artifact.
- Make boards primary work surfaces through personal pinned board snapshots on
  Home and global command/search access.

## Non-Goals

- Do not build a full database-builder UI in v1.
- Do not add private boards in v1; boards are team-shared, while pins are
  personal.
- Do not silently infer broad board membership from object type or weak
  mentions.
- Do not embed full editable boards on Home in v1.
- Do not replace object pages; boards remain operational context over canonical
  object memory.

## Product Model

### Board

A board is a team-shared work surface with:

- name
- purpose/instructions
- template kind
- allowed or recommended object kinds
- one or more views
- lanes
- explicit board items
- shared settings

Filters may help users find candidates, but filters do not define membership.

### Board Item

A board item is one workspace object on one board. It stores board-local
workflow context:

- lane
- position
- responsible team member
- due date
- priority
- next step
- board-local notes
- optional simple custom fields, deferred until after v1

Board item properties are local to the board unless a user explicitly promotes
the change to object memory or a task object.

When a board item has both a responsible team member and a due date, Timeline
notifies that responsible person in the in-app inbox and mirrors the due date to
the team calendar. The calendar event stays board-scoped, links back to the
underlying workspace object, and names the responsible person when the user
record has a display name or email.

### Board View

A board view is a layout over the same board items:

- Kanban
- Table
- List
- Calendar later

The board owns membership once. Views do not create separate boards or separate
membership.

### Board History

Every board membership and item-property change is preserved:

- item added or removed
- lane move
- position change
- responsible person change
- due date change
- priority change
- next step or note change
- accepted agent suggestion

The complete history appears in board card detail. The main timeline only shows
meaningful board activity or board changes tied to an existing timeline moment
as impact context.

## V1 Scope

Ship one coherent Boards 2.0 slice:

- explicit board membership
- board-owned lanes
- board-local item properties
- Pipeline and Task Board templates
- manual add/search existing objects with quick object creation fallback
- board card detail panel
- object page board-membership summaries
- personal pinned board snapshots on Home
- preserved board item history
- responsible-person due-date notifications and team-calendar due-date rows
- approval-backed board membership and board item update suggestions
- route-level affordances for opening boards and adding objects; global
  command/search actions remain deferred until the command system has a clear
  extension point

Defer:

- custom fields beyond the standard set
- calendar view
- team-pinned boards
- private boards
- strict template enforcement
- advanced automation rules
- bulk import

## Templates

Board creation starts with template choice, using icons, concrete examples, and
plain-language descriptions before advanced settings.

### Pipeline

Use for sales, partnerships, account tracking, delivery stages, and other
relationship-style workflows.

Defaults:

- recommended object kinds: company, deal, project
- lanes: New, Qualified, Scoping, Proposal, Committed, Active, Won, Lost
- properties: responsible, due date, priority, next step, notes

Creation asks what the team is tracking:

- Companies themselves: best for simple account or relationship lists.
- Deals or opportunities: best when one company can have multiple active
  commercial threads.
- Projects: best for delivery or implementation work.

### Task Board

Use for development, marketing, management, and follow-up work.

Defaults:

- recommended object kinds: task, follow_up
- lanes: Backlog, Ready, Doing, Review, Done, Blocked
- properties: responsible, due date, priority, next step, notes

### Catalog

Use for products, services, vendors, documents, reference objects, or internal
inventories.

Defaults:

- recommended object kinds: project, document, vendor, other
- lanes: Idea, Evaluating, Active, Deprecated
- properties: responsible, priority, notes

Catalog can ship after Pipeline and Task Board if needed.

### Custom

Use when none of the guided templates fit. Custom boards still use explicit
membership, lanes, and board item properties.

## User Flows

### Create Board

1. User opens Boards.
2. User chooses a template from visual options with examples.
3. User enters name and optionally edits purpose/instructions.
4. User reviews suggested lanes and item properties.
5. User creates the board.
6. App opens the empty board with a focused add flow.

Success criteria:

- The user can create a pipeline without seeing raw fields like
  `filter.type` or `group_by`.
- The board purpose is understandable to both teammates and the agent.

### Add Board Item

1. User clicks Add item, Add company, Add task, or a template-specific label.
2. Search focuses existing workspace objects first.
3. Results show type, aliases, recent evidence count, and existing board
   memberships when useful.
4. If no result fits, user can quick-create a workspace object.
5. The selected or created object becomes a board item in the chosen lane.

Success criteria:

- Users do not need to pre-clean every object before building a useful board.
- A broad type such as company never floods the board by itself.

### Use Board

Kanban:

- drag items between lanes with optimistic updates
- show saving/saved board-level state
- rollback only failed moves
- preserve each move in board history

Table:

- scan and edit responsible person, due date, priority, next step, lane, and
  object summary
- keep edits optimistic and field-scoped

List:

- lightweight queue view for smaller boards and mobile

### Open Board Card Detail

Card click opens board-context detail before navigating away.

The panel shows:

- object summary
- board item properties
- board-local notes
- next step
- evidence and related timeline moments
- board item history
- links to full object page, chat about object, and all timeline events

### Pin Board

Users can pin or unpin shared boards for their own Home Dashboard.

Home shows compact pinned board snapshots:

- board name
- template/purpose label
- item count
- lane counts
- overdue/due-soon count when available
- last updated

Clicking opens the full board. Home does not embed a full editable Kanban in
v1.

### Object Page Board Context

Object pages show active board memberships compactly:

- board name
- board purpose/template
- lane
- responsible person
- due date
- priority

This lets users move from canonical memory to active workflows.

## Agent Behavior

### Board Purpose

Each board has user-visible purpose/instructions. The agent uses them to decide:

- whether an object belongs on the board
- what lane to suggest
- whether mentioned owners or dates are board-relevant
- how to answer board-scoped questions

### Suggestions

Timeline can create approval-backed suggestions for:

- adding an object to a board
- removing an object from a board
- moving a board item to another lane
- assigning responsible person
- setting due date
- setting priority
- updating next step or notes

Evidence from conversations, email, and meetings suggests changes by default.
Direct user commands can apply changes directly when the target is unambiguous
and the user has permission. Authoritative integrations can apply changes to
the artifacts they own.

Weak mentions remain evidence only.

### Board Questions

The agent should answer:

- What changed on the sales pipeline this week?
- Which opportunities are stuck?
- Who owns the next step for Revigo?
- What companies have contract discussions but are not on the pipeline?

Answers must cite timeline evidence and distinguish accepted board state from
pending suggestions.

## Data Model

Boards 2.0 is the only board model. Boards are explicit records with explicit
membership; broad object filters can help find candidates, but they are not
boards and are not preserved as a runtime surface.

### Proposed Tables

#### boards

- id
- team_id
- created_by
- name
- purpose
- template_kind: pipeline, task_board, catalog, custom
- recommended_object_types jsonb
- strict_object_types boolean default false
- is_shared boolean default true
- archived_at
- created_at
- updated_at

Indexes:

- team_id, archived_at
- team_id, updated_at

#### board_lanes

- id
- team_id
- board_id
- name
- position
- kind optional: active, done, terminal, lost, blocked
- archived_at
- created_at
- updated_at

Indexes:

- team_id, board_id, position

#### board_items

- id
- team_id
- board_id
- entity_id
- lane_id
- position
- responsible_user_id nullable
- due_at nullable
- priority nullable
- next_step nullable
- notes nullable
- custom_fields jsonb default {}
- archived_at
- created_at
- updated_at

Constraints:

- unique active item per team_id, board_id, entity_id
- entity must belong to same team

Indexes:

- team_id, board_id, lane_id, position
- team_id, entity_id
- team_id, responsible_user_id
- team_id, due_at

#### board_item_changes

- id
- team_id
- board_id
- board_item_id nullable for membership proposals before item creation
- entity_id
- actor_kind: user, agent, system
- actor_user_id nullable
- status: applied, suggested, rejected
- field
- previous_value jsonb
- new_value jsonb
- source_event_id nullable
- suggestion_item_id nullable
- note nullable
- changed_at

Indexes:

- team_id, board_item_id, changed_at
- team_id, board_id, changed_at
- team_id, status

#### board_pins

- team_id
- user_id
- board_id
- position
- created_at

Primary key:

- team_id, user_id, board_id

Indexes:

- team_id, user_id, position

### Shared Scope API

Add board helpers under `scope.boards`. Object APIs remain canonical for object
memory and do not own board-local workflow state.

Required methods:

- listBoards()
- getBoard(id)
- createBoard(input)
- updateBoardSettings(id, patch)
- archiveBoard(id)
- listBoardItems(boardId, view/filter)
- addBoardItem(boardId, entityId, input)
- createObjectAndAddBoardItem(boardId, objectInput, itemInput)
- updateBoardItem(itemId, patch)
- moveBoardItem(itemId, laneId, position)
- removeBoardItem(itemId)
- listBoardItemHistory(itemId)
- listObjectBoardContext(entityId)
- listPinnedBoards(userId)
- pinBoard(boardId)
- unpinBoard(boardId)
- proposeBoardMembership(input)
- proposeBoardItemUpdate(input)
- acceptBoardItemChange(changeId)
- rejectBoardItemChange(changeId)

All methods must use `withTeam(db, teamId, userId)` and never accept raw `db`
from app code. Team isolation is non-negotiable.

### Suggestion Model

Extend `agent_suggestion_items.target_kind` to include board membership and
board item update targets. Store proposed board item field changes in
`board_item_changes` with `status='suggested'` and link them to suggestion
items.

Preferred direction:

- keep suggestion review queue as the user-facing approval surface
- store board item proposed field changes in `board_item_changes`
- link suggestion item result bookkeeping to board change acceptance

This mirrors object changes while keeping board-local state separate from
object memory.

## Web Surface

### Routes

- `/app/boards`: board index, template creation entry, pinned indicator
- `/app/boards/new`: guided template creation flow if the form outgrows the
  index
- `/app/boards/[id]`: full board with tabs/views
- `/app/boards/[id]?item=<boardItemId>`: opens card detail
- `/app/objects/[id]`: includes object board context
- `/app`: includes pinned board snapshots
- Global command/search board shortcuts are a follow-up, not part of this
  shipped slice.

### Components

New or rewritten:

- `BoardTemplatePicker`
- `BoardCreateFlow`
- `PinnedBoards`
- `BoardHeader`
- `CuratedBoardViews`
- `BoardKanban`
- `BoardTable`
- `BoardList`
- `BoardAddItemDialog`
- `BoardCardDetail`
- `BoardItemHistory`
- `ObjectBoardContext`

Board components should not imply that a board is just an object filter.

### Visual Direction

- Quiet, dense, Linear-like surfaces.
- Icons for templates and board actions.
- Clear examples in the template picker.
- No hero or marketing treatment inside the app.
- Cards stay compact and stable in size.
- Optimistic updates for moves and field edits.
- Errors attach to the affected card, row, or field.
- Pinned board snapshots are compact modules, not full boards.

## Migration

The migration creates the curated board tables directly. Users create curated
boards from templates and add explicit board items; this avoids carrying forward
noisy boards that showed every object matching a broad type.

## Testing

### Database and Shared Scope

- board membership is team-scoped
- board item cannot reference an object from another team
- active board item uniqueness per board/object
- board item changes preserve history
- suggested changes do not mutate canonical board state until accepted
- direct user update writes applied history
- object board context only returns visible team board memberships
- board pins are per-user

### Server Actions and Routes

- create board validates template and lanes
- add existing object to board
- quick-create object and add to board
- move board item with optimistic-safe server response
- update responsible/due/priority/next step
- pin/unpin board
- accept/reject board suggestion
- object page renders board context
- Home renders pinned board snapshots

### UI

- template picker examples are visible and understandable
- Pipeline creation does not expose raw filter/group fields first
- company-type board does not show all companies by default
- board card opens detail panel
- failed move rolls back only affected card
- table edits preserve layout and show field-level saving/error states

### Agent and Suggestions

- strong evidence creates a board membership proposal
- weak mention creates no board proposal
- evidence-suggested lane/owner/due changes require approval
- direct user command can apply an unambiguous board update
- board-scoped answer cites evidence and distinguishes pending suggestions

## Rollout Plan

### Phase 1: Domain and Storage

- Add board, lane, item, item history, and pin tables.
- Add shared scope helpers and tests.
- Keep existing board routes functional.

### Phase 2: Manual Boards

- Add template-based creation for Pipeline and Task Board.
- Add manual add/search and quick create.
- Add Kanban and card detail using board-local state.
- Add board history.

### Phase 3: Home and Object Context

- Add personal pinned boards on Home.
- Add object page board membership summaries.
- Keep command/search jump-to-board actions as an explicit follow-up unless the
  command system gets a clear extension point.

### Phase 4: Suggestions

- Add board membership proposals.
- Add board item update proposals.
- Wire suggestions into the review queue and evidence citations.

### Phase 5: Table/List Polish

- Add table and list views over the same board items.
- Add field-level optimistic edits.
- Revisit simple custom fields after the standard fields feel good.

## Open Questions

- Should board item notes be a single mutable field in v1, or append-only notes
  with their own history rows?
- Should moving to terminal lanes such as Won/Lost require a reason?
- Should "responsible" be singular in v1, or should boards support multiple
  responsible people later?
- Should board item due dates generate notifications or reuse existing task
  overdue scanning?
