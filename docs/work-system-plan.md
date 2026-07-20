# Work System Plan

The Timeline should become the place a team goes to run work, not only the
place where work history is stored. Today the product has many of the right
ingredients: boards, tasks, objects, documents, calendar, chat, memory, and
agent context. The gap is that Work does not yet present a crisp daily operating
system for users.

The core product question is:

> Where do I go every morning to know what matters, what I own, what changed,
> and what to do next?

This plan defines the direction for turning Work into that place.

## Current Implementation Status

The current branch completes the first two slices of this plan:

- **Phase 0: Work hub IA and Work Queue.** `/app/work` is now centered on a
  single Work Queue, with team boards, attention counts, and shared navigation
  into Objects, Tasks, Boards, Calendar, and Approvals. `/app` is the broader
  Home surface for Ask, actionable attention, focused capture, the latest
  digest, pinned work, recent moments, and one next setup step; Work owns the
  operational object/task/board entry points.
- **Phase 1: Board Item Command Center.** The board item side panel now supports
  responsible person, lane and blocked-state changes, due date, priority, next
  step, notes, and readable recent activity using the existing board item schema.
  The board scan layer shows responsible/unassigned state, due state, priority,
  next step, and blocked state. Board table and list views now also support
  multi-select bulk updates for responsible person, lane, due date, and priority.
- **Adjacent Tasks page convergence.** Object-backed tasks now support the same
  operational scan layer in kanban and list views, with inline status,
  assignee, due date, and priority edits plus bulk updates for selected tasks.
- **Adjacent object-page cleanup.** Object detail pages now expose editable name
  and aliases, hide internal pagination terminators, and render recent changes
  as readable summaries instead of raw JSON.

The next product gap is no longer "where do I see my work?" It is "how does a
team discuss, follow, and get notified about work where the work already lives?"

## Thesis

We are not building a Trello or Asana clone. Those products still teach useful
interaction defaults because many teams want to see work as boards, task lists,
calendars, and tables without asking an agent first.

The Timeline advantage is that every work item can be connected to real
evidence: meetings, docs, chats, decisions, companies, people, files, calendar
events, and AI-summarized context.

The Work system should combine both truths:

- familiar visual work management for quick scanning and team coordination
- Timeline memory for evidence, history, and agent-assisted next steps

The product should support the daily loop:

```text
capture work -> assign it -> discuss it -> move it -> remember why -> know what changed -> act next
```

## Problem

Historically, the Work area exposed too much system truth and too little user
workflow. Phase 0 and Phase 1 reduce that, but the remaining gaps are still
important.

Examples:

- Board template/type is visible, but users care about the actual board and its
  stages.
- Object pages, board panels, tasks, and timeline events can feel like separate
  surfaces instead of one workflow.
- Board item detail is still closer to an information panel than a place where
  work happens.
- Ownership, due dates, priority, comments, and next steps are not yet socially
  meaningful enough.
- The Work hub does not yet function as a daily starting point.
- AI/context is not woven into the work surfaces as "what changed", "why this is
  here", and "what needs attention".

This creates a confusing experience even when individual features exist.

## Product Model

The UI and data model should make four concepts obvious.

### Object

An object is the durable thing in the workspace:

- company
- deal
- task
- project
- service
- vendor
- person
- document
- decision
- incident
- hiring loop
- other tracked entity

Object memory is canonical. It carries the durable name, type, aliases, status,
source evidence, relationships, and timeline context.

### Board Item

A board item is an object's role on one board. It stores board-local work
context:

- stage/lane
- position
- owner
- collaborators/watchers
- due date
- priority
- next step
- board-local description or notes
- custom fields
- checklist/subtasks
- board-specific history

The same object can appear on multiple boards with different board-local state.

### Activity

Activity is what happened around the object or board item:

- comments
- mentions
- stage changes
- owner changes
- due date changes
- priority changes
- checklist updates
- linked meeting notes
- linked documents
- decisions
- agent suggestions
- timeline events

Activity should be visible where the user is working, not only on a separate
timeline page.

### View

A view is how the team sees the same work:

- kanban
- table
- list
- calendar
- work queue
- "due soon"
- "unassigned"
- saved filtered views

Views do not create separate work databases. They are lenses over the same
objects and board items.

## UX Principles

### Workflow Before System Truth

Show the user's operating loop first. System concepts can exist, but they should
not dominate the interface.

Prefer:

- "Owner", "Due", "Priority", "Comments", "Next step", "Activity"
- board name, stages, saved views, status

Avoid foregrounding:

- template kind
- implementation labels
- raw object taxonomy unless it helps the current decision
- counts that do not help the current task

### Work Surfaces Should Be Scannable

Users should understand a board or task list in a few seconds.

Cards and rows should show the core scan layer:

- owner or "Unassigned"
- due date or "No due date"
- priority or "No priority"
- comment count
- checklist progress
- blocked/attention state

Missing values should be visible when they are operationally important. A board
full of "Unassigned" and "No due date" should make the absence obvious.

### One Due-Date Contract Across Surfaces

Due dates are stored and exchanged as timestamps but presented and filtered as
workspace calendar dates. Canonical midnight-UTC values keep their encoded
date; other timestamps resolve in the workspace timezone. Work is overdue only
after its local due day has ended. The shared states are Overdue, Due today,
Due soon (the next 14 calendar days), Due, and No due date, always paired with
an exact localized date when one exists.

This contract applies to Work, task and board views, schedulable object rows and
details, search and command results, artifact previews, approval and Ask cards,
daily digests, and overdue notifications. Editable fields keep native date
inputs and add a readable status hint. Missing dates are explicit for tasks,
follow-ups, projects, deals, and board items, but not for identity records,
calendar events, or generic approval rows. Machine-facing REST, MCP, export,
retrieval, embedding, and evidence formats retain raw ISO timestamps.

The Work rail badge remains the aggregate of overdue open tasks and pending
approval items. The Work header exposes separate keyboard-focusable Overdue and
Approvals links, and the overdue task link uses the same workspace-date filter
and open-status rules as its count.

### Detail Panels Should Be Command Centers

Opening a card should not feel like leaving the workflow. The side panel should
be where work happens.

The item panel should include:

- title, type, and status/stage
- owner, collaborators, due date, priority
- description or next step
- comments with mentions
- checklist/subtasks
- custom fields
- linked docs, events, objects, and decisions
- recent Timeline activity
- AI summary: "What changed since you last looked"
- actions: ask, open full object, create follow-up, schedule, link doc

### The Agent Should Be Contextual, Not Required

Users should not need to ask the agent just to see their todo list. Visual views
should answer common questions immediately.

The agent should make those views smarter:

- explain why an item is in a stage
- summarize recent evidence
- suggest next steps
- identify blocked or abandoned-looking work from timeline evidence
- create tasks from meetings
- connect related decisions, docs, and people

Background suggestion workers should produce the same kinds of approval-backed
updates the UI can apply manually. For board items, worker context must include
the current lane, responsible person, due date, priority, next step, and recent
board item history so proposals can safely target `laneId`, `responsibleUserId`,
`dueAt`, `priority`, `nextStep`, notes, or board membership without guessing.
When the responsible person is clear but the member UUID is unavailable,
proposals may carry `responsibleName`; acceptance resolves only a unique active
team member.

### One Work Graph, Many Operational Views

Tasks, deals, vendors, product work, HR loops, and decisions should not become
separate silos. They should be different operational views over Timeline
objects.

## Priority Phases

### Phase 0: Information Architecture Cleanup

Status: implemented in the current branch.

Goal: make Work feel like a real home base.

Work hub should become the daily landing page for operational work.

Add sections:

- Work queue: one scannable list of work that matters now, including items
  responsible to me, team-level items with due dates but no owner, and visible
  overdue tasks even when another teammate owns them
- Team boards: recently active and pinned boards
- Attention signals: linked Overdue and Approvals counts in the Work header,
  plus readable due state and dates on queue rows
- Recent changes: comments, stage changes, mentions, AI-found updates
- Pinned: boards, projects, deals, vendors, decisions, or tasks I care about

Cleanup:

- Keep Back navigation from Objects, Tasks, Boards, and Calendar to Work.
- Reduce labels that expose implementation details.
- Make the relationship between Work, Objects, Tasks, Boards, and Calendar
  clearer.
- Treat Objects as durable memory and Boards/Tasks as operational surfaces.

Success criteria:

- A user can open Work and know what needs attention without asking the agent.
- A first-time user can explain what Objects, Boards, and Tasks are for.
- The Work hub feels like a daily starting point, not an index page.

### Phase 1: Board Item Command Center

Status: implemented in the current branch for the core fields only. Comments,
checklists, collaborators/watchers, custom fields, and new schema are still
future phases.

Goal: make the board item side panel the primary place where work happens.

Add or improve:

- editable responsible person
- lane and blocked-state editing
- due date
- priority
- next step
- notes
- readable recent activity
- link to full object page

Card scan layer:

- responsible or unassigned state
- due date or missing due state
- priority or missing priority state
- blocked/attention marker

UX cleanup:

- Make selected card state obvious.
- Keep card actions snappy and optimistic.
- Avoid full route refreshes for ordinary edits.
- Keep board settings, stage editing, rename, description, and deletion in a
  subtle menu.

Success criteria:

- A user can manage a real board item without leaving the board.
- The panel feels dense but calm, like Linear-style operational UI.
- Cards communicate enough state to scan a board quickly.

### Phase 2: Comments, Mentions, And Collaboration

Goal: make work social and accountable.

Add:

- comments on board items and objects
- mentions with autocomplete
- mention notifications
- comment permalinks
- edit/delete comments
- reactions or lightweight acknowledgement later
- watchers/collaborators
- "following" state for board items and objects

Notification triggers:

- assigned to me
- mentioned
- due date changed
- stage changed on watched item
- comment added on watched item
- abandoned-looking item suggested for review by an agent

Success criteria:

- Teams can discuss work where the work lives.
- A teammate can be pulled into an item with `@name`.
- Notifications feel useful, not noisy.

### Phase 3: Ownership, Roles, And Workload

Goal: support real team accountability without overcomplicating assignment.

Model:

- one owner for the person ultimately responsible
- collaborators for people actively helping
- watchers for people who want updates

Avoid defaulting to "many assignees" as the only concept. Multiple assignees are
often ambiguous. Owner plus collaborators is clearer.

Views:

- My owned work
- My collaborating work
- Waiting on me
- Waiting on others
- Unassigned
- Team workload by owner

Success criteria:

- Everyone can answer "what am I responsible for?"
- Managers can find unowned or overloaded work.
- Collaboration is visible without blurring accountability.

### Phase 4: Custom Fields And Saved Views

Goal: make boards flexible enough for pipelines, vendors, HR, marketing,
product, decisions, and operations without creating a generic database builder
too early.

Custom field types:

- text
- long text
- number
- currency
- date
- select
- multi-select
- person
- checkbox
- URL
- linked object

Field behavior:

- board-local fields by default
- optional promotion to object memory later
- visible on card/table/list depending on view settings
- required-field indicators per board later

Saved view controls:

- filter
- sort
- group
- visible fields
- layout: kanban, table, list, calendar
- personal vs shared saved views later

Success criteria:

- A sales pipeline, vendor list, hiring loop, and product roadmap can each use
  the same board system without awkward terminology.
- Users can make the board fit their workflow without understanding the data
  model.

### Phase 5: Timeline Activity And AI Context

Goal: make Timeline memory visible inside work management.

Add to item detail:

- linked meetings
- linked docs
- related decisions
- recent object activity
- recent comments
- stage and field history
- source evidence

Agent capabilities:

- "Why is this item here?"
- "What changed since last week?"
- "Summarize all activity for this deal"
- "Suggest next step"
- "Create follow-up from this meeting"
- "Find work that appears abandoned based on recent timeline evidence"
- "Find items with no owner or due date"
- "Show blockers across this board"

Suggestion worker improvements:

- Include `responsibleUserId`, `responsibleName`, and a readable
  responsible-person label in the existing board item context sent to the
  suggestion worker.
- Include enough lane metadata for the worker to propose board item stage moves
  without relying on lane names alone.
- Include recent board item changes alongside recent timeline evidence when
  asking whether an item needs a due date, responsible person, next step, lane
  change, or priority update.
- Keep abandoned-looking work as a proposal pattern backed by concrete timeline
  evidence, not as a special Work hub heuristic.
- Require citations/source event IDs for due-date, stage, owner/responsible,
  and abandoned-work proposals.

AI UI patterns:

- show citations for claims
- distinguish agent suggestions from user-authored comments
- allow accept/reject for generated next steps or tasks
- keep suggestions lightweight and dismissible

Success criteria:

- Users trust board state because they can see the evidence behind it.
- The agent feels embedded in the workflow, not bolted onto the side.
- The product can answer operational questions competitors cannot.

### Phase 6: Calendar, Reminders, And Due Work

Goal: make due dates and time commitments first-class.

Add:

- calendar view for board items
- reminders
- due-soon and overdue sections
- recurring tasks later
- schedule/follow-up action from item detail
- meeting-to-task capture
- timeline event to board item conversion

Success criteria:

- A user can plan the week from Work.
- Work and Calendar reinforce each other instead of living separately.
- Follow-ups from meetings become visible operational commitments.

### Phase 7: Templates, Imports, And Migration

Goal: make it easy for teams to bring existing workflows into Timeline.

Templates:

- sales pipeline
- customer onboarding
- product roadmap
- marketing calendar
- vendor management
- hiring loop
- decision log
- incident review
- executive staff meeting follow-ups

Template rules:

- templates are editable starting points
- templates should never lock board stages or fields
- template copy should not masquerade as board description

Imports:

- CSV first
- Trello later
- Asana later
- Linear later
- HubSpot or Pipedrive later if CRM demand appears

Success criteria:

- A team can recreate an existing workflow in minutes.
- Imported work becomes Timeline objects, not a disconnected list.
- Template choice accelerates setup without constraining the user.

## Cross-Cutting Requirements

### Optimistic Updates

Work interactions should feel immediate.

Use optimistic UI for:

- stage moves
- owner changes
- due date changes
- priority changes
- comments
- checklist changes
- custom field edits
- board item create/remove

Server refresh should reconcile data without remounting local UI or wiping
draft state.

### Activity History

Every meaningful work change should be recorded:

- who changed it
- what changed
- previous value
- new value
- when it changed
- whether it came from a user, agent, import, or integration

History should be useful in context, not just stored for audit.

### Permissions

Initial posture:

- boards are team-shared
- object memory is team-scoped
- private/personal views can come later

Future permissions:

- private board
- board-level sharing
- field visibility
- comment visibility
- external guest access, if customer demand appears

### Mobile And Density

Work surfaces should be usable on desktop first, but not break on mobile.

Desktop:

- dense board/table/list surfaces
- side panel command center
- keyboard-friendly interactions

Mobile:

- list-first views
- bottom sheet item detail
- quick owner/due/priority edits
- comments and activity readable without horizontal scrolling

## Open Product Questions

- How far should the separate object-backed Tasks page later converge with
  saved Work views?
- Should board item comments also appear on the canonical object activity feed?
- When does board-local state become object-level state?
- Should owner be board-local, object-level, or both?
- Should custom fields be board-only in v1, with object-level fields later?
- What is the first truly excellent template: sales pipeline, task board, or
  customer/project delivery?
- How much notification volume can the product support before it needs a proper
  inbox triage model?

## Recommended Build Order

Done in the current branch:

1. Work hub IA and daily workflow layout.
2. Work Queue model, board-scope queue helper, and due/responsible queue
   normalization.
3. Board item command center with responsible person, lane/blocked state, due
   date, priority, next step, notes, activity, and table/list bulk updates.
4. Card and row scan layer improvements.
5. Object-backed Tasks page convergence with board-style cards, side-panel
   first task detail, list view, bulk updates, and editable
   assignee/due/priority fields.

Next:

1. Comments, mentions, watchers, and notifications.
2. Owner/collaborator model plus Work Queue views.
3. Custom fields and saved views.
4. Timeline evidence and AI summary inside item detail.
5. Suggestion worker context improvements for responsible person, due date,
   lane, priority, next step, and abandoned-looking work proposals.
6. Calendar/reminder integration.
7. Templates and imports.

## First Milestone Definition

The first milestone should prove that The Timeline can run a real team's work
for one workflow.

Recommended wedge: a team pipeline or task board where users can:

- create a board with editable stages
- add objects or quick-create objects
- assign owner and collaborators
- set due date and priority
- comment with mentions
- add a checklist
- see recent activity and evidence
- scan missing fields on cards
- view the Work queue from the Work hub
- receive approval-backed suggestions for board item stage, responsible person,
  due date, priority, next step, and abandoned-looking work updates
- ask the agent what changed and why

The current branch covers the Work Queue, board scan layer, core board item
editing, and product-wide calendar-date-aware due presentation and overdue
delivery. The main missing pieces are comments/mentions, checklists,
collaborators/watchers, stronger Timeline evidence inside item detail, and
suggestion-worker improvements.

If this loop feels excellent, the broader platform can expand from it.
