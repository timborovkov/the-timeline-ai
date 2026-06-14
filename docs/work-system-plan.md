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

The current Work area exposes too much system truth and too little user
workflow.

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
- "my work"
- "stale"
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
- due date or "No due"
- priority or "No priority"
- comment count
- checklist progress
- stale or recently updated indicator
- blocked/attention state

Missing values should be visible when they are operationally important. A board
full of "Unassigned" and "No due" should make the absence obvious.

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
- identify stale or blocked work
- create tasks from meetings
- connect related decisions, docs, and people

### One Work Graph, Many Operational Views

Tasks, deals, vendors, product work, HR loops, and decisions should not become
separate silos. They should be different operational views over Timeline
objects.

## Priority Phases

### Phase 0: Information Architecture Cleanup

Goal: make Work feel like a real home base.

Work hub should become the daily landing page for operational work.

Add sections:

- My work: assigned to me, due soon, waiting on me
- Team boards: recently active and pinned boards
- Attention: overdue, unassigned, stale, blocked
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

Goal: make the board item side panel the primary place where work happens.

Add or improve:

- editable owner
- collaborators/watchers
- due date
- priority
- description/next step
- comments
- checklist/subtasks
- custom fields
- linked docs/events/objects
- recent activity
- object preview modal
- link to full object page

Card scan layer:

- owner or unassigned state
- due date or missing due state
- priority or missing priority state
- comment count
- checklist progress
- stale/recently updated marker
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
- stale item assigned to me

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
- "Detect stale work"
- "Find items with no owner or due date"
- "Show blockers across this board"

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

- Should tasks remain a separate top-level page, or become a saved Work view
  over task objects?
- Should board item comments also appear on the canonical object activity feed?
- When does board-local state become object-level state?
- Should owner be board-local, object-level, or both?
- Should custom fields be board-only in v1, with object-level fields later?
- What is the first truly excellent template: sales pipeline, task board, or
  customer/project delivery?
- How much notification volume can the product support before it needs a proper
  inbox triage model?

## Recommended Build Order

1. Work hub IA and daily workflow layout.
2. Board item command center with comments, checklist, owner, collaborators, due
   date, priority, and activity.
3. Card and row scan layer improvements.
4. Comments, mentions, watchers, and notifications.
5. Owner/collaborator model plus My Work views.
6. Custom fields and saved views.
7. Timeline evidence and AI summary inside item detail.
8. Calendar/reminder integration.
9. Templates and imports.

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
- view "my work" from the Work hub
- ask the agent what changed and why

If this loop feels excellent, the broader platform can expand from it.

