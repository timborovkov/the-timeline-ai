# The Timeline Context

The Timeline is a team memory product: many capture surfaces feed one shared,
queryable workspace while preserving per-item visibility and trust boundaries.

## Language

**Team**:
A workspace shared by a group of people. A team owns shared capture surfaces,
documents, integrations, objects, and timeline history.
_Avoid_: Account, organization

**Team Member**:
A person who belongs to a team. Team membership grants access to team-visible
items, but does not grant access to another member's private items.
_Avoid_: User when the team relationship matters

**Legal Acceptance**:
A person-level acknowledgement of the current Terms of Use and Privacy Policy
versions required before entering the signed-in product. Legal acceptance
belongs to the person, not to each team membership.
_Avoid_: Team acceptance, membership acceptance

**Owner/Admin**:
A team member with elevated control over team settings and shared operational
workflows. This role does not override private or restricted item visibility.
_Avoid_: Superuser, workspace root

**Raw Event**:
An immutable source record captured into the timeline. Raw events are the
evidence layer behind facts, objects, agent answers, and later exports.
_Avoid_: Message, activity, log entry

**Timeline Moment**:
A user-facing cluster of related raw events shown together on the timeline so
team members can understand a meaningful slice of work before drilling into
individual source evidence. Archive rows are Linear-quiet: time, one source
icon, a title, and at most one muted context line, with sticky dates under the
filter toolbar. Impact stays in the inspector, not on the row. The archive
pages older activity through infinite scroll and virtualizes mounted rows;
Timeline has no inventory chip. Timeline lists should show compact signals for
extracted file representations; full transcripts, OCR text, and visual
descriptions belong in event detail, citations, and agent tools. User-facing
Moments chrome and digests count moments; All events, filters, and technical
disclosures count source events. Conversation inspectors use evidence items;
pulses use a compact activity log — do not pair moment and raw-event totals in
the same chrome. The inspector keeps original source (message, email HTML,
transcript, webhook/JSON payload) in a collapsed disclosure; attached documents
link to the document drive. Ask `[ev:]` citations name those raw source events;
the inspector evidence item shows the matching chip so a cited source can be
identified without putting IDs on the timeline list. Citation previews open the
matching workspace destination (transcript, document, calendar event, object,
or Timeline moment) and reuse the inspector original-source viewer for payloads.
_Avoid_: Raw Event when referring to the grouped browsing unit

**Timeline event class**:
A provider-agnostic family for captured events: communication, work record,
pulse, incident, artifact, or schedule. Native sources, integrations, and
ingest webhooks all resolve to one class. The class chooses visual weight
(story, record, pulse), whether `objectMap` may feed artifact identity, and
how the inspector is laid out. Generic ingest webhooks let an admin set the
class when creating the webhook; unknown deliveries default to pulse.
_Avoid_: GitHub event, Sentry event, webhook type when discussing presentation

**Impact Context**:
The workspace consequences or links attached to a timeline moment, such as
tasks, boards, objects, calendar events, documents, decisions, follow-ups, or
pending approvals that were created, changed, referenced, or suggested from the
underlying evidence. Work records (merged PRs, issue moves, deal stages) also
surface deterministic structured facts from source metadata. Pulses do not
invent impact from machine identifiers. Extracted emails, phone numbers, and labeled addresses can
ride on raw-event metadata as evidence, but emails/phones become useful product
state only when they are accepted as person identity facets; addresses remain
location/object metadata unless a later workflow promotes them. Impact Context
is truthful partial context: v1/v2 surfaces
hydrate it from existing metadata, suggestion evidence, object/task changes,
document versions, and calendar rows without inventing missing graph links.
_Avoid_: Related items when discussing what changed because of source evidence

**Artifact Provenance**:
The source-backed origin story for a derived workspace artifact, explaining why
the artifact exists, belongs on a work surface, or changed, and which raw-event
evidence window supported that creation, membership, or update. Artifact
provenance applies across workspace objects, tasks, calendar events, board
memberships, and board item updates; it distinguishes primary raw events from
surrounding conversation context, can accumulate later evidence, and is shown in
trust tiers such as why the artifact exists, what changed it, and related
observed evidence. Audit history records what Timeline did rather than why the
artifact was proposed or changed.
_Avoid_: Audit history, system event, single source event when discussing origin

**Evidence Association**:
A source-backed link between raw-event evidence and a workspace artifact,
including direct references, conversation replies, attachments, links, and
object-mediated context that make the evidence relevant to the artifact. An
evidence association can remain observed context until a teammate accepts a
proposal or an authoritative source turns it into durable artifact provenance;
semantic similarity alone is not enough to associate evidence with an artifact.
The same raw event can support multiple artifacts or board-local roles, but
each association needs its own artifact- or board-specific rationale.
_Avoid_: Mention when the connection is indirect

**Connected Work**:
The source-backed work context shown around one workspace object, such as
tasks, calendar events, documents, shared links, captured files, boards,
timeline moments, fact-backed people/object context, or pending approvals that
mention, target, or materially involve that object.
Connected Work can be useful before it becomes object memory; it should not be
presented as an accepted object relationship unless a teammate accepts that
relationship. Connected Work is computed from current evidence for immediate
orientation, while only durable memory candidates graduate into approval-backed
object memory proposals or accepted object memory.
_Avoid_: Related when discussing broad mixed context around an object

**Workspace Reconciliation**:
The process of keeping derived workspace artifacts aligned when newer raw-event
evidence confirms, revises, supersedes, or invalidates earlier derived state.
Workspace reconciliation never edits raw events; it updates, cancels, archives,
supersedes, or proposes corrections to approvals, workspace objects, tasks,
calendar events, and other impact context.
Provider and conversation evidence first join an Artifact Cluster through hard
or structured anchors such as external IDs, URLs, issue numbers, branch names,
contract IDs, deal IDs, event slugs, or explicitly supplied artifact keys.
Semantic similarity can suggest review candidates but is not enough to merge
evidence into the same artifact cluster by itself.
_Avoid_: Cleanup, removal, sync, extraction

**Lifecycle Update**:
A workspace reconciliation outcome that changes the state of a derived artifact
because timeline evidence shows progress, completion, cancellation, blocking,
rescheduling, or another workflow-state change. Lifecycle updates are not
task-board-specific; they apply to any canonical artifact with meaningful
lifecycle state. They may skip intermediate states when newer evidence clearly
shows the artifact's current state. Lifecycle updates require clear resolution
to one artifact cluster; ambiguous evidence should not guess between plausible
artifacts. Progress updates require explicit workflow movement, not mere
attention or discussion. Completion evidence can come from any credible source
when the statement is assertive and the artifact match is clear; hedged guesses
remain evidence only. Cancellation, blocking, and unblocking are lifecycle
updates when they map cleanly to the artifact's supported state vocabulary.
Each artifact type has one canonical lifecycle vocabulary; conversational and
display aliases such as "in progress" normalize to that vocabulary before
reconciliation. Lifecycle updates to canonical artifacts require approval unless
they come from an authoritative source.
_Avoid_: Contradiction when the evidence is progress rather than disagreement

**Authoritative Source**:
A capture surface or integration allowed to directly update the canonical
artifact it owns through a stable external identity, such as a provider event
id or external object id. Authoritative sources do not get broad permission to
rewrite unrelated workspace state; related Timeline-owned artifacts still need
approval unless they are explicitly part of the same owned artifact cluster.
_Avoid_: Trusted source when it implies general authority

**Provider Connection**:
A person-owned login or credential grant to an external provider, such as a
team member's GitHub account. A provider connection can expose more external
resources than a Timeline team should use, and only the owning team member can
expand or revoke what any Timeline team may draw from it, even when that access
is actively syncing. One provider connection may serve multiple Timeline teams,
with a separate integration scope for each team. Native integrations share this
ownership model even when their resource vocabulary differs by provider. If the
owning team member leaves a Timeline team, that team's scopes using the
provider connection pause until a current team member supplies a replacement
connection. A team may use multiple provider connections for the same provider.
Any team member may create their own provider connection; team admins decide
which shared integration scopes use available provider connections.
_Avoid_: Team connection, shared account

**Integration Scope**:
The team-approved set of external resources Timeline may sync through a
provider connection, such as selected GitHub repositories, a GitHub
organization, Linear teams, the user's Drive root, or shared drives. Team
admins may manage the active scope within the resources the
provider-connection owner has made available to the team. A provider-native
group such as a GitHub organization is
a living scope that includes future resources in that group when the provider
connection can access them. When access to a scoped resource is revoked, new
sync stops while previously captured raw events remain part of the timeline.
Team integration views emphasize integration scopes; personal connection views
emphasize provider connections. A group-level scope can be replaced at the
group level when another provider connection can access the same group. Only a
provider-connection owner can browse resources that have not been shared with a
Timeline team. A provider connection can be available to a team before any
sources are actively syncing. Sharing a resource with a team records the
connection owner's consent; activating it in an integration scope records the
team's consent.
_Avoid_: OAuth scope, provider access, manage scope

**Active Source Path**:
The single provider connection and scoped external resource that currently feed
one external source into a Timeline team. A team should not sync the same
external source through multiple provider connections at the same time. Team
admins may replace an active source path with another provider connection that
can access the same external source, without transferring the original
connection owner's credentials.
_Avoid_: Duplicate integration, parallel sync

**Connection Attention**:
A user-actionable state where a provider connection or integration scope needs
someone to restore, replace, narrow, or retry external access before sync can
continue normally. Connection attention is surfaced to the people who can act,
such as the connection owner for reconnects or team admins for replacement.
Deterministic auth, permission, or owner-availability problems become
connection attention immediately; transient provider instability should become
attention only after it persists. Durable connection attention may trigger email
when it first appears or changes category, but routine transient sync failures
should avoid noisy mail. Product surfaces should show connection attention where
users can notice it quickly, then send them to the integration view for details
and action.
_Avoid_: Raw integration error, generic failure

**Artifact Cluster**:
A set of derived workspace artifacts that represent the same real-world
commitment, object, schedule, decision, or follow-up across product surfaces.
An artifact cluster can include pending approvals, workspace objects, tasks,
calendar events, integration-owned objects, conversation evidence, signatures,
payments, shared links, releases, and other impact context that should stay
mutually consistent.
An artifact cluster can exist before a canonical artifact exists; newer evidence
can be recorded alongside pending create approvals when it clearly refers to the
same real-world artifact; suggestion reconciliation decides whether a pending
approval is updated or superseded. Meaningful completed commitments may still
become canonical artifacts even when completion arrives before the create
approval is accepted; trivial completed work can remain raw evidence with no
active proposal.
Evidence association and lifecycle authority are separate: a Telegram report,
Sentry issue, GitHub PR, shared URL, signed contract PDF, deal approval, or
party venue note can all belong to the same cluster without each source being
allowed to change canonical state. Lifecycle updates require either the
authoritative source for that owned artifact or a human-approved proposal.
_Avoid_: Conversation, thread, timeline moment when discussing the consistency boundary

**Workspace Object**:
A durable team memory item that represents something the team wants to track,
such as a person, company, project, task, decision, deal, or follow-up.
Workspace objects can be referenced by raw events, edited by teammates, and
changed through approval-backed agent suggestions. A raw mention or link target
is not a workspace object unless it carries durable information for the team.
Across object types, updating or merging a plausible existing object is
preferred over creating a new one.
_Avoid_: Entity when discussing the user-facing team memory item

**Task Category**:
A single product-owned functional workstream on a canonical task, such as
Engineering, Design, Sales, or Legal & Compliance. It is reversible derived
organization metadata: an LLM assigns it asynchronously, a teammate can set a
sticky manual override, and only an explicit return to automatic mode lets a
later model result replace that human value. It is not evidence, status,
priority, ownership, assignment, access control, or a workflow trigger.
_Avoid_: Tag, board lane, project, object type

**Primary Project**:
The optional canonical project that owns a task, stored as one durable
task-to-project `child` relationship. It answers which tracked initiative the
task belongs to, while Task Category answers which functional workstream is
responsible. Board membership, co-mention, title similarity, and task category
do not establish primary-project ownership.
_Avoid_: Parent object when speaking to users, board, category

**Duplicate Object Candidate**:
A reviewable proposal that two workspace objects may represent the same
real-world thing. Short-name, acronym, or suffix-variant matches should become
duplicate object candidates only when shared evidence supports the identity;
when a teammate rejects a candidate pair, Timeline should not suggest the same
pair again. Duplicate object candidates may draw on object evidence, with
direct identity facets and aliases carrying the most weight, facts, notes, and
accepted relationships acting as supporting evidence, and bare one-off
co-mentions treated as weak evidence. When a duplicate object candidate is
accepted, the survivor becomes the single object page for both sets of connected
work, while former names remain visible as aliases or evidence labels where
they explain the source wording. Provider-owned objects require hard
provider-native identity before cleanup proposes a merge. Shared URLs or
matching titles inside explicit provider context can create relationships
between distinct provider records, but loose title-only similarity should not.
_Avoid_: Duplicate when referring to an unaccepted guess

**Object Memory**:
The team's durable understanding of a workspace object: its canonical name,
aliases, structured fields, relationships, facts, notes, and approved changes
over time. Object memory is visible and reviewable; it is not a hidden agent
notebook.
_Avoid_: Agent memory when it implies opaque private state

**Object Relationship**:
A durable object-memory edge between two workspace objects, such as a person
being linked to a company, a task blocking a project, or two objects being
otherwise connected. Object relationships use coarse relationship kinds; the
specific meaning of the connection belongs in the supporting facts, notes, and
source evidence. Accepted object relationships are shared team memory;
agent-discovered object relationships are proposed memory until a teammate
accepts them, and team-visible proposals should be supported by team-visible
evidence. The relationship edge says which objects are connected; supporting
facts, notes, or cited evidence explain why the connection matters. Raw co-occurrence
in evidence is not itself a relationship. A relationship candidate should be
proposed when evidence describes a stable or operationally useful connection,
such as a target, owner, employer, client, vendor, blocker, parent project, or
explicit artifact subject. Incidental mentions belong in Connected Work rather
than object memory proposals. Artifact titles can be strong signals for a
relationship candidate when they name an existing workspace object, but a title
should be backed by source evidence before the agent proposes durable object
memory.
_Avoid_: Co-occurrence, mention, related item

**Object Memory Proposal**:
An approval-backed agent suggestion to create or update object memory, such as
adding an alias, identity facet, relationship, note, field value, or missing
workspace object. Object memory proposals become canonical only when a teammate
accepts them; weak mentions should remain evidence rather than proposed memory.
When evidence supports new related objects together, their create proposals and
relationship proposal should be reviewed as one bundle.
Creation proposals should be the last resort after checking existing objects
and pending proposals.
_Avoid_: Memory write when it hides the approval step

**Memory Repair**:
A user-triggered request for Timeline to re-evaluate an object, artifact, or
connected work area and propose missing object memory, duplicate object
candidates, or relationship candidates. Memory repair complements background
workspace reconciliation; it does not bypass approval for durable memory.
Object-centered memory repair can search team-wide evidence and artifacts, but
the returned proposals should stay focused on the object or connected work area
the teammate asked Timeline to repair. The first object-centered repair path
queues focused duplicate, low-signal archive, and relationship-shaped
fact-backed relationship proposals among existing active objects. It can also
bundle a missing full-name person object with its relationship to the repaired
object when relationship-shaped evidence names a durable person; bare first
names remain evidence only.
_Avoid_: Manual linking when the agent is proposing the repair

**Person Object Candidate**:
A reviewable proposal for a person workspace object. A named person tied to
durable company, project, or work context can become a person object candidate
and should be bundled with the supporting relationship candidate; a bare first
name with no durable context should remain evidence unless it matches an
existing person.
_Avoid_: Contact when the person has not been accepted into object memory

**Q&A Note**:
An object note that preserves a reusable question-and-answer exchange from a
message-like capture surface, such as Telegram, Slack, or email, on the most
relevant existing workspace object, usually a topic, decision, project, or
policy-like object. A Q&A note is not a separate object lifecycle; it is durable
object memory backed by raw-event evidence and accepted through the existing
object memory proposal flow. A Q&A note requires an explicit answer that is
likely to help future teammates, not a vague reply, handoff, or one-off lookup.
It should attach to an existing object when one clearly fits; creating a topic
object is a fallback for high-signal Q&A with no suitable existing object.
Later evidence should update the existing Q&A note only when it clearly answers
the same reusable question; ambiguous corrections should remain evidence or a
reviewable correction proposal.
A Q&A note should preserve the user-facing question when one exists; without an
explicit question, the exchange should remain ordinary facts or object memory
unless the reusable question is narrow and obvious.
When answering later questions, accepted Q&A notes are the maintained answer;
raw events and extracted facts remain the evidence trail and fallback when no
accepted Q&A note exists.
Pending Q&A note proposals may be mentioned as pending context, but they are
not the team's maintained answer until accepted.
Email threads are in scope for Q&A notes when the product can evaluate the
thread context; single-message extraction should not guess a Q&A note from an
isolated email.
_Avoid_: Durable answer, FAQ object, fact object

**Board**:
A curated work surface for a team-defined purpose, such as a pilot pipeline,
development task board, marketing plan, product catalog, or management review.
A board can use filters to find eligible workspace objects, but the board is
not merely the filter result.
_Avoid_: Saved search, object type view

**Board Purpose**:
The plain-language explanation of what a board is for, what kinds of objects
belong on it, and what evidence should justify membership or board item
updates. Board purpose guides both teammates and agent suggestions.
_Avoid_: Internal prompt when discussing the user-facing board description

**Board View**:
One way to display the same curated board items, such as Kanban, table, list,
or calendar. Board views do not create separate membership; they let the team
inspect and edit the same board through different layouts.
_Avoid_: Separate board when only the layout changed

**Board Membership**:
The intentional relationship that places a workspace object on a board for that
board's purpose. Board membership is distinct from the object's type: not every
company belongs on a pilot pipeline, and the same task can belong on one work
board without belonging on every task board. Evidence may be relevant to an
object generally without justifying board membership; membership provenance
must explain why the object belongs on that specific board.
_Avoid_: Type filter, implicit inclusion

**Board Item**:
The user-facing card or row created by a board membership. A board item combines
one workspace object with board-local workflow context so the team can run that
board without changing the object's meaning everywhere else. Board item
provenance explains why the object is on this board and why its board-local
state changed; broader object provenance belongs on the object page.
_Avoid_: Object when discussing the board-local work item

**Board Membership Proposal**:
An approval-backed suggestion to add, remove, or update a workspace object's
membership on a board. A board membership proposal needs clear evidence that
the object belongs on the board for that board's purpose; weak mentions remain
timeline evidence only.
_Avoid_: Automatic board add, inferred card

**Board Item Properties**:
The standard board-local fields that help a team manage a board item, such as
lane, position, responsible team member, due date, priority, next step, and
board-local notes. Board item properties are local to one board unless the team
explicitly promotes the change to canonical object memory or a task object.
_Avoid_: Object fields when the value only governs one board workflow

**Board Item Update Proposal**:
An approval-backed suggestion to change board item properties based on timeline
evidence. Conversation, email, and meeting evidence suggest board item changes
by default; direct user commands and authoritative sources can apply changes
without review when the target board item is unambiguous. Board item update
evidence must explain why the object's role or local state changed on that
specific board, not only why the underlying object is relevant somewhere in the
workspace.
_Avoid_: Silent board update

**Board Item History**:
The preserved record of board item membership and property changes, including
adds, removals, lane moves, assignments, due-date changes, and accepted
suggestions. Board item history is visible from the board card detail and may
also appear as impact context on timeline moments. The complete board item
history is always preserved, but the main timeline surfaces only meaningful
board activity or board changes tied to an existing timeline moment.
_Avoid_: Ephemeral board state

**Board State**:
The board-specific workflow information attached to a board membership, such as
the object's lane, position, or board-local stage. Board state does not redefine
the workspace object itself, so the same object can move differently across
different boards.
_Avoid_: Object status when the value only matters on one board

**Board Card Detail**:
The board-context view of a workspace object on a board. It shows the object's
canonical memory alongside board membership state, board-local notes, next
steps, and board-local provenance for why the object belongs on that board and
why its board item properties changed.
_Avoid_: Object page when the user is staying inside one board workflow

**Object Board Context**:
The compact summary of boards that currently include a workspace object,
including each board's purpose and the object's board-local state. Object board
context helps the object page show where durable memory is currently being used.
_Avoid_: Duplicated object status

**Personal Pin**:
A current team member's ordered shortcut to durable workspace content. Personal
pins can target objects (including tasks), boards, documents and captured files,
meetings, calendar series, or grouped timeline moments. Home previews the mixed
collection; Work → Pinned owns filtering and reordering. Visibility loss hides a
pin without deleting it.
_Avoid_: Pinned board, shared pin, embedded object

**Board Preset**:
A board creation starting point that explains a board's intended use through a
plain-language purpose, example use cases, eligible object kinds, and starting
stages. A board preset helps a new board become useful immediately, but it is
not a board type and does not define a fixed workflow.
_Avoid_: Board type, schema template

**Preset Defaults**:
The editable starting stages, board item properties, example labels, and
recommended object kinds supplied by a board preset. Preset defaults are
starting values; teammates can rename, reorder, add, or remove stages during
creation and from board settings.
_Avoid_: Mandatory workflow

**Pipeline Board**:
A board started from pipeline-style defaults for tracking objects through
relationship, sales, partnership, or delivery stages. A lightweight pipeline
can track companies directly; a separate deal or project object is used when
one company has multiple active commercial or delivery threads.
_Avoid_: CRM when the board is not specifically customer relationship work

**Correction Proposal**:
An approval-backed suggestion created when newer evidence disagrees with
already accepted or otherwise canonical workspace state. A correction proposal
does not rewrite the earlier decision by itself; it asks the team to approve
the replacement, cancellation, archive, or field update.
_Avoid_: Automatic fix, silent update

**Proposal Revision**:
A reviewer-authored rewrite of an unresolved approval item. The reviewer gives
plain-language feedback, the inference layer updates the proposal title,
description, and payload, and the item remains pending or retryable. The
operation, target, attached evidence, and immutable source records stay fixed;
the prior proposal and feedback remain in bounded audit metadata. Revising a
proposal never changes canonical workspace state by itself.
_Avoid_: Accepted correction, source edit, automatic fix

**Superseded Approval**:
A pending approval that is no longer actionable because newer evidence or a
newer proposal has replaced it before the team accepted or rejected it.
Supersession is limited to the stale lifecycle dimension, approval item,
semantically duplicate proposed create or relationship/facet/note/board
approval, same-target overlapping update, or incoherent proposed outcome inside
an artifact cluster; unrelated pending proposals for the same artifact remain
actionable even when they appear in the same review bundle. A pending approval
is also superseded when canonical state already reflects the proposed outcome,
including after a direct edit or an accepted approval. When a reviewer tries to
accept a pending approval whose target has already disappeared, or when a
failed retryable approval points at a target object or calendar event that was
archived, merged away, or deleted, it may be superseded instead of staying in
the active retry queue. Narrower or private evidence does not supersede a
broader approval queue. Superseded approvals leave the active approval queue
but remain available as history with their evidence and replacement
relationship; when duplicate active/retryable reconciliation supersedes a
proposal, its evidence is merged into the surviving active proposal.
_Avoid_: Rejected approval, deleted approval, failed approval

**Rejected Approval**:
A proposal the team has explicitly declined. Rejected approvals are human
decisions, not stale machine output; workspace reconciliation may re-offer a
similar approval only when newer evidence materially changes the proposal,
target, confidence, or support.
_Avoid_: Superseded approval, hidden approval

**Durable Information**:
Information worth preserving because it changes future retrieval,
interpretation, workflow, identity resolution, ownership, status, scheduling,
or relationships for the team. Durable information is distinct from one-off
chat preferences, acknowledgements, unsupported guesses, or facts already
represented canonically without a meaningful correction. New object memory
requires a strong signal, such as a durable attribute, commitment, workflow
role, repeated consistent evidence, or an explicit request to remember or
correct it.
_Avoid_: Memory when it is too vague about what should persist

**Noise**:
Captured content that should remain raw evidence but should not become durable
facts or object memory, such as message mechanics, incidental tool mentions,
generic categories, reactions, forwarded links, or unsupported guesses.
_Avoid_: Fact when the statement only repeats how a message was sent

**Person Object**:
A workspace object for a real-world person, whether or not that person belongs
to the Timeline team. A person object can carry names, nicknames, external
identity facets such as handles and contact details, roles, company
relationships, open-ended facts or notes, and an optional link to a Timeline
team member when the person is also a product user. A new person object should
be created only after plausible existing person matches have been resolved or
ruled out.
_Avoid_: Team Member when discussing identity outside product access

**Identity Facet**:
A structured identifier on a person object, such as an email address, phone
number, Telegram handle, Slack user id, GitHub username, or linked Timeline
team member. Identity facets are distinct from nicknames and freeform facts
because they help resolve senders across capture surfaces; strong facet
matches should update the existing person rather than create another one.
Emails and phone numbers extracted from conversational text should be proposed
or approved through this path rather than modeled as standalone artifacts.
_Avoid_: Alias when referring to an external account or contact detail

**Capture Surface**:
A way information enters the timeline, such as web capture, Telegram, Slack,
email, documents, meetings, integrations, or calendar import.
_Avoid_: Connector when the surface is first-party

**Direct Agent Conversation**:
A private, provider-backed conversation between one verified Timeline user and
the agent. Plain text is an agent turn, history is private to that user and
team, and the insertion-ordered persisted transcript is available in web chat
history. Presentation follows the current delivery surface: external providers
receive compact plain text without internal Timeline references, while a new
turn continued in web chat receives the rich cited profile. Voice, files,
images, and other attachments remain source capture rather than agent prompts.
Switching the active team or losing membership archives the old provider
session and starts a new conversation without leaving the provider route
blocked on stale state. The provider route is revalidated while the
conversation is locked, and a cached answer remains the active turn until
provider delivery or cancellation so replies cannot arrive out of order.
_Avoid_: DM Capture when the user sent ordinary text to the agent

**Explicit Chat Note**:
Text that a person deliberately sends to the evidence pipeline from a direct
agent conversation without asking the agent to answer. Telegram uses
`/note`; Slack uses `/timeline note`. Attachments do not need a note command
because media is always captured.
_Avoid_: Agent prompt, passive DM capture

**Eligible External Teams**:
The teams a verified external identity may select for a provider conversation.
Eligibility is recomputed from current product membership and provider
boundaries rather than inferred from old routing rows. Telegram includes every
active Timeline membership. Slack includes only active memberships also
enabled for the current Slack workspace.
_Avoid_: Linked teams when describing routing rows, all memberships for Slack

**Progress Capability**:
A provider adapter's best available signal that an accepted agent turn is
still queued or running. Telegram keeps the request-side typing heartbeat until
the worker claims the turn and then refreshes it from the worker; classic Slack
keeps the thinking reaction, and Slack Assistant status may be added when that
context and scope are available. Progress ends on answer, timeout, failure, or
cancellation.
_Avoid_: Delivery guarantee, runtime-specific typing implementation

**Ingest Webhook**:
A team-managed capture surface that accepts arbitrary external payloads as raw
source evidence. Ingest webhooks capture textual request bodies first; direct
file and binary capture are separate source-file flows. An ingest webhook is
not an integration scope and is not an authoritative source by default. Sender
identity in an ingest webhook payload is interpreted from the evidence rather
than mapped by a required provider schema.
_Avoid_: Generic integration, provider connection

**Ingest Webhook Owner**:
The team member who creates or configures an ingest webhook. The ingest webhook
owner controls the source's future defaults and visibility for captured events,
even when the payload describes an external sender.
_Avoid_: Webhook author, external sender

**Ingest Webhook Credential**:
A team-managed secret that authorizes writes into one ingest webhook. The
credential may appear in a webhook URL or as a bearer credential, and possession
of it is treated as permission to create source evidence for that webhook.
_Avoid_: Password, API account

**Ingest Webhook Rotation**:
Replacing an ingest webhook credential without changing the named ingest
webhook source. Rotation preserves the source identity shown on the timeline
while retiring a leaked or obsolete credential.
_Avoid_: New webhook when only the secret changed

**Ingest Webhook Duplicate Delivery**:
A repeated webhook delivery whose payload is identical to a recent delivery for
the same ingest webhook. Duplicate delivery should not create additional source
evidence; changed payloads remain new evidence even when they describe the same
external object.
_Avoid_: Semantic duplicate, provider event merge

**Ingest Webhook Burst**:
Multiple distinct webhook deliveries from the same ingest webhook that arrive
close together. A burst should preserve each delivery as separate source
evidence while allowing timeline display and evidence review to group the
deliveries as one source moment.
_Avoid_: Batch import when the provider sent individual deliveries

**Evidence-Only Source**:
A capture surface whose incoming information can support search, answers, and
approval-backed suggestions but cannot directly update canonical workspace
state. Generic ingest webhooks are evidence-only sources; only native
integrations may become authoritative sources.
_Avoid_: Untrusted source, read-only integration

**Proposal Generation Default**:
The source-level setting that decides whether future source evidence should
immediately ask the agent to propose approval-backed workspace changes. Turning
it off keeps the evidence searchable without inviting new proposals from that
source.
_Avoid_: Automation permission, write access

**Event-Local Proposal**:
An approval-backed suggestion generated primarily from one raw event plus its
available extracted facts, recent context, and existing workspace state. Event-
local proposals remain the default. Generic ingest webhooks are the first
adapter to honor cross-source evidence mode; in enforced mode, the anchor and
directly related pack evidence replace time-only raw chronology while typed
workspace state remains adjacent context. Other event-local adapters keep their
legacy behavior until their own rollout milestones.
_Avoid_: Full-context proposal, automatic synthesis

**Event Visibility**:
The audience attached to a raw event or equivalent timeline item: private,
team, or specific users. Visibility is per item, not inherited from the team.
_Avoid_: Permission, sharing setting

**Visibility Owner**:
The person allowed to change an item's visibility. For human-captured items,
this is usually the capturer; for source-owned items, it is the person who owns
or configured that source.
_Avoid_: Author when the person controls visibility but did not create the
source content

**Sender**:
The person or external identity that produced a captured message. Sender is
preserved as timeline context even when it cannot be linked to a Timeline team
member.
_Avoid_: Author when the sender is not a verified Timeline user

**Sender Context**:
Sender, conversation, and thread information that helps interpret a captured
message. Sender context belongs in source metadata and must be available to
retrieval and extraction, not only to timeline display. Evidence consumers
match a raw event's author user ID against the current team member list before
adding verified Timeline member identity; provider sender metadata remains the
source attribution when no current member matches.
_Avoid_: Display-only metadata

**Conversation Evidence Window**:
A small set of raw events around a conversational anchor event that the agent
uses to decide whether a task, calendar change, or object memory proposal is
actually supported by the surrounding exchange. The window starts with the
same source conversation and may include cross-source linked context only when
there is a strong relationship signal; every cited event must be visible to
the audience that receives the answer or proposal.
_Avoid_: Single-message evidence, chat history dump

**Evidence Pack**:
A deterministic, bounded set of visibility-safe raw events related to one or
more anchor events. The pack records core and supporting evidence, normalized
source surfaces, relationship provenance, ordering, budget decisions, and
policy version. It is a build result used by answers or proposals, not a new
canonical workspace object or source of write authority.
_Avoid_: Context dump, prompt context, evidence bundle

**Core Evidence**:
The anchor events and protected same-conversation events that define an evidence
review. Core evidence receives budget priority over supporting evidence.
_Avoid_: Primary truth, authoritative evidence

**Supporting Evidence**:
A directly related, visibility-safe raw event admitted through a stable
one-hop relationship to the anchor or core. Supporting evidence may reinforce,
refine, supersede, or contradict the anchor.
_Avoid_: Similar event, nearby context

**Evidence Pack Policy**:
The consumer-specific admission, ranking, visibility, and budget rules applied
by the shared evidence-pack builder. Proposal policy requires direct
non-semantic relationships; answer policy may admit viewer-visible semantic
matches because answers do not change durable state.
_Avoid_: Retrieval mode, confidence setting

**Proposal Audience**:
The common audience allowed to see every selected citation and the resulting
approval-backed proposal. Evidence visibility is intersected before model input,
persistence, display, and acceptance; source evidence never broadens to fit a
proposal.
_Avoid_: Team, approvers

**Source Surface**:
The source family a person recognizes, such as Slack, email, meetings, GitHub,
Monday, or one immutable generic-webhook identity. Several event types from one
provider are one surface. Webhook names are display labels only; legacy webhook
rows without IDs collapse conservatively into one surface. A pack is
cross-source only when selected citations span at least two surfaces.
_Avoid_: Event type, ingestion path, integration category

**Conversation Review**:
An ongoing review of a source conversation that re-evaluates durable
information as new raw events arrive, including follow-up events that clarify
or contradict an earlier anchor. A conversation review can create, merge, or
supersede pending proposals, but accepted object memory changes require a new
proposal; durable decisions inside the review cluster by work item rather than
treating the whole source conversation as one topic.
_Avoid_: One-shot message processing, chat summarization

**Sender Resolution**:
The derived association between a captured sender and a person object. Sender
resolution may be recorded when a message is ingested and re-evaluated when the
team later approves new identity facets, but the original raw sender context
remains unchanged.
_Avoid_: Re-attribution when it implies editing the raw event

**Source Owner**:
The team member responsible for a shared capture surface when the source does
not map cleanly to a single human author. Source ownership gives a product
answer to who controls future defaults and visibility for source-owned items.
_Avoid_: Admin, author

**Slack Workspace**:
An external Slack tenant where the Timeline Slack app is installed. One Slack
workspace can feed multiple Timeline teams, but each bound Slack conversation
routes to one Timeline team at a time.
_Avoid_: Team when referring to Slack's external workspace

**Slack Conversation Binding**:
A routing relationship from a Slack conversation to a Timeline team. The
binding determines which team receives messages from that conversation and
which visibility default applies to channel-sourced captures.
_Avoid_: Slack integration, channel ownership

**Slack User Link**:
An OAuth-proven relationship between a Slack user in a Slack workspace and a
Timeline team member. Slack user links provide attribution; they do not decide
which team a bound Slack conversation routes to.
_Avoid_: Link token, username proof

**Slack Direct Agent Conversation**:
A direct message conversation from a verified Slack user to Timeline. Ordinary
text invokes the shared agent runtime; `/ask` is a compatible alias,
`/timeline note` captures text, and messages with files remain ingestion.
Eligible teams are restricted to memberships enabled for that Slack workspace.
_Avoid_: Slack DM Capture, support inbox

**Capture Acknowledgement**:
A lightweight reaction or reply that confirms a direct-message capture landed.
Capture acknowledgements belong in DMs, not in group chats or channels where
they would add shared-channel noise.
_Avoid_: Channel receipt, delivery guarantee

**Conversational Attachment**:
A file attached to a message from a conversational capture surface such as
Telegram or Slack. Audio attachments become transcribed timeline events; other
supported attachments become captured files linked back to the source message.
_Avoid_: Generic blob, message metadata only

**Captured File**:
A source-backed file captured from a conversational surface or integration and
made available for search, citation, and agent use. Captured-file text is
retrievable by default, while workspace interpretation from that text should be
source-aware. Captured files inherit the visibility of their source evidence
and should never become more visible automatically; a captured file may become
a document when the team wants to browse, version, and manage it as durable
knowledge. Citations may reuse document-version identifiers while labeling
unpromoted evidence as captured files.
_Avoid_: Document when the file is only source evidence, blob

**Document**:
A durable team knowledge file that members intentionally browse, version, and
manage in the document drive. Documents are curated workspace artifacts, not
every file that was captured as source evidence.
_Avoid_: Captured file when the item has not been promoted or curated

**Document Drive**:
The curated browsing surface for folders and documents. The default document
drive view excludes unpromoted captured files, though a dedicated captured-files
view can expose them for triage, promotion, cleanup, and source inspection.
Folders belong to promoted documents; unpromoted captured files are organized
by source evidence and triage filters instead of folder placement.
_Avoid_: Attachment inbox, all files

**File Promotion**:
The act of making an existing captured file visible and manageable as a
document without copying its source blob or severing its source evidence link.
Promotion gives the file document-drive placement, naming, and curation
semantics. After promotion, the original capture can be the first document
version while later uploads extend the promoted document's version history.
Promotion may preserve or narrow visibility by default; widening visibility is
an explicit audited action. Promotion is recorded as a lifecycle transition,
not inferred from whether a file happens to have extractable text. Promoted
documents can remain active when their original source event is later
tombstoned, while preserving tombstoned provenance. Source capture time remains
provenance; document-drive activity uses promotion, version, and document
update times.
_Avoid_: Import, copy to documents

**Targeted File Inspection**:
An agent-initiated read of a specific captured file or document version to
answer a narrow question about the original file. Targeted file inspection is a
follow-up to known evidence, not a broad crawl over team files. Inspection
returns an answer for the immediate question and may persist a reusable
extracted representation when the result improves future search or agent use.
Persisted inspection output must be representation-like, such as OCR text,
transcript text, or visual description, not arbitrary conclusions or workspace
interpretation.
_Avoid_: Re-indexing, background OCR

**Visual Description**:
A model-generated description of what a visual captured file or document page
shows, distinct from faithful source-text extraction. Visual descriptions make
images, screenshots, scans, and visually meaningful PDFs queryable as context
without pretending the description is source-authored text. Current processing
extracts office/PDF bytes in Daytona sandboxes (Firecrawl anydoc; sparse PDFs
render via pypdfium2), sends sparse PDF page images and images through vision OCR in the
document-extract orchestrator, and defers only oversized captured files; future processing can
tune depth by intent so unpromoted conversational captures receive a cheaper
preview pass until promotion, targeted inspection, or explicit user intent
warrants deeper analysis. Persisted visual descriptions should be
neutral observations about what is visible; business interpretation belongs in
agent answers or workspace suggestions, not in the extracted representation
itself.
_Avoid_: OCR when describing non-text visual context, summary when provenance matters

**Extracted Representation**:
A queryable text representation derived from a captured file or document
version, such as source text, transcript text, visual description, or metadata
preview. Each representation keeps its provenance so generated descriptions are
not treated as literal source-authored text. Timeline-oriented questions should
include source-evidence representations by default; curated documents are
reference knowledge and should be searched when the question calls for that
context. Creating or updating extracted representations enriches the source
evidence; it should not create separate timeline activity unless a person takes
an explicit workspace action such as promotion, deletion, or visibility change.
_Avoid_: Chunk text when provenance matters

**Representation Correction**:
A user-authored correction layered over an extracted representation, such as a
fixed transcript name or OCR phrase. Corrections do not mutate the source file
or erase the original model output; they become the preferred representation
for search and agent answers while preserving auditability. Corrections follow
normal edit permissions for the visible evidence or document and do not require
the workspace approval queue.
_Avoid_: Editing the raw transcript when it hides provenance

**Voice Memo**:
A spoken capture sent because speaking was faster than typing, such as a
Telegram or Slack voice note. Voice memos are timeline evidence: they keep the
audio file as source-backed evidence and add a transcript representation that
is searchable, vectorized, and eligible for source-aware workspace
interpretation. Voice-memo classification follows capture semantics first and
MIME type second: native Telegram/Slack voice-message surfaces are transcribed
by default, while manual document uploads do not currently transcribe audio
through document extraction and ambiguous shared audio can defer deeper
processing.
_Avoid_: Generic audio file, song

**Attachment Guardrails**:
The shared limits that decide whether a conversational attachment is processed,
skipped with metadata, or rejected before download. Guardrails cover file size,
file type, attachment count, and expensive OCR/transcription routes.
_Avoid_: Best-effort download

**Budget Deferral**:
A normal processing state where a captured file is indexed with lightweight
metadata or preview context while deeper OCR, vision, transcription, or
chunking waits for promotion, targeted inspection, or explicit user intent.
Budget deferral is not a processing failure.
_Avoid_: Failed processing, unsupported file

**Active External Team**:
The Timeline team selected for a linked external user when a direct-message
conversation can route to more than one team. Telegram and Slack DMs share this
mental model, but their eligible-team sets differ.
_Avoid_: Default workspace, primary team

**Slack App Installation**:
An admin-created connection between a Timeline team and an installed Slack app
inside a Slack workspace. Installation creates a shared capture surface; it is
separate from a member's Slack user link.
_Avoid_: Personal Slack link

**Digest Destination**:
A workspace-configured place the daily digest is sent. Email every member is
the default. Admins can add Slack channels, Telegram groups, and bot DMs to
linked members, and can remove email so the digest is chat-only. Shared chats
receive one team-visible digest; email and DMs stay personalized and honor the
personal opt-out.
_Avoid_: Notification channel when referring to digest routing

**Visibility Default**:
The initial visibility applied to future items from a capture surface. Changing
a default does not retroactively change existing items.
_Avoid_: Policy when it sounds retroactive

**Source Deletion**:
A deletion signal reported by the original capture surface. When the product
learns about a source deletion, the active timeline hides the affected item by
tombstoning raw event rows rather than physically deleting source evidence.
Source deletion is authoritative even when the deleting external actor is not
linked to a Timeline member.
Unpromoted captured files follow their source deletion; promoted documents can
remain as curated artifacts with tombstoned provenance.
_Avoid_: Hard delete, erase

**Trust Audit Log**:
An append-only record of sensitive reads and security-relevant actions inside
the product. It exists to answer who accessed or changed sensitive team data,
not to track every ordinary page view.
_Avoid_: Timeline, activity feed

**Job Recovery Dashboard**:
A team-scoped owner/admin surface for retrying or dismissing failed and stuck
product jobs tied to visible team artifacts, such as transcription,
extraction, embedding, document processing, meeting finalization, and
integration sync.
_Avoid_: Operator dashboard, BullMQ dashboard, queue admin

**Environment Reset**:
A development-only operational action that destroys all data and derived state
in a non-production Timeline environment so it can be rebuilt from migrations
and seed data.
_Avoid_: Team reset, clear everything, backup restore

**Integration Audit Log**:
The operational history of an integration, such as connection, sync, replay,
and provider errors. It is not the general trust audit log.
_Avoid_: Audit log when discussing security-sensitive product actions

**Team Export**:
A portable archive of data the requesting owner/admin is allowed to access.
Team export preserves visibility boundaries and records omissions rather than
bypassing private or restricted items.
_Avoid_: Backup, database dump

**Onboarding Checklist**:
A dismissible team setup checklist that teaches the product loop: capture,
invite teammates, connect chat and email, upload a document, ask the agent,
invite the bot to a call, review a proposal, configure daily digests, and
connect a source, webhook, or Timeline MCP. Home keeps it open under Ask
until a member hides it; Hide persists even with zero completions. The open
panel uses the same quiet label as the folded toggle. Later incomplete steps
are links so the list stays usable. After Hide, a quiet Team setup checklist
toggle with a chevron remains in that slot, and a matching header chip on
other app pages returns to the panel until setup is done or hidden. Full
connection management belongs in Connections. It is not a requirement that
external data has successfully arrived.
_Avoid_: Setup wizard, activation gate

**Home**:
The signed-in landing surface for a team member. It leads with Ask, the team
setup checklist, and actionable attention, keeps capture in a focused dialog,
and follows with a folded latest digest, pinned work, and a dense scan of
recent moments. The digest header is the day; the covering time range stays
footer metadata. Opened digests show narrative summaries of what changed and
linked task, object, and calendar rows; Work → Digests lists generated days.
It does not duplicate the canonical Timeline, Work navigation, or Connections
management.
_Avoid_: Timeline when referring to the landing page

**Workspace Time Context**:
The team's default frame for interpreting relative dates, day boundaries, week
numbers, and calendar display when no user-specific timezone is explicitly
needed. Weeks use ISO week numbering.
_Avoid_: UTC default, browser timezone

**Workspace Timezone**:
The team's canonical timezone for workspace time context. It belongs to team
calendar settings and is the default timezone for shared date interpretation.
_Avoid_: Server timezone, user browser timezone

**Time Resolution**:
The deterministic translation of human time phrases into exact workspace-local
date spans and UTC query ranges. Agents use time resolution instead of doing
date math from prompt text alone.
_Avoid_: LLM date math

**ISO Week**:
A Monday-start calendar week identified by ISO week-year and week number. The
Timeline uses ISO weeks for week numbers, week views, and agent time resolution.
_Avoid_: Locale week, Sunday week

**All-Day Calendar Event**:
A calendar event that occupies one or more whole local dates in its event or
workspace time context. Its end date is exclusive, so a one-day event starts on
one local date and ends at the start of the next local date.
_Avoid_: Midnight UTC event

**Date-Only Calendar Event**:
A calendar event mentioned with a date but no time. Date-only calendar events
enter the calendar as all-day events; a single-day date-only proposal can later
be refined into a timed event when a specific time is agreed.
_Avoid_: Unschedulable meeting

**Calendar Refinement**:
An update that turns an existing calendar event into a more precise version of
the same commitment, such as converting a single-day date-only all-day call into
a timed call once the time is known.
_Avoid_: Duplicate calendar event

**Recurring Calendar Series**:
A canonical calendar event with an RRULE schedule that materializes concrete
occurrence rows for near-term display and search. The parent stores the rule;
children store the occurrence time.
_Avoid_: Copy-pasted repeated events

**Calendar Occurrence Exception**:
A materialized occurrence that has been moved, edited, or cancelled separately
from its recurring series. Re-expansion must preserve exceptions instead of
overwriting or recreating them.
_Avoid_: Detached duplicate meeting

**Tentative Slot Group**:
A set of proposed meeting times that are visible as tentative calendar holds
after approval. Once one slot is confirmed, the chosen slot becomes the meeting
and sibling tentative holds are cancelled.
_Avoid_: Five confirmed meetings

**Saved Meeting**:
A reusable meeting capture target, usually with a stable meeting link and
aliases, where teammates expect Timeline to join without re-entering the link.
Creating a saved meeting includes confirming that the team has permission to
capture that meeting, so later joins do not ask again. A saved meeting can be
linked to calendar events that represent the same scheduled conversation
instead of duplicating them.
_Avoid_: Calendar sync, imported event, internal call

**Quick Meeting Capture**:
An ad hoc request for Timeline to join a live meeting from a chat command or
minimal form, where the title may be filled in after the transcript is
finalized.
_Avoid_: Scheduled meeting when the call is already happening

**Meeting Capture Confirmation**:
A short-lived acknowledgement that participants have been informed before
Timeline joins a meeting. Confirmation should be attached to the specific
capture prompt, such as a button press or direct reply. Saved meetings do not
use per-join confirmation because permission is confirmed when the saved
meeting is created.
_Avoid_: General consent, implicit yes

**Meeting No-Show Window**:
The bounded time Timeline will wait after joining a meeting link when nobody
admits or joins the call. It applies to every meeting capture path so forgotten
or moved calls do not leave a transcriber running indefinitely. For Google Meet
captures, Timeline uses a provider-safe 550-second no-show window.
A scheduled Saved Meeting that times out while its configured call window is
still open is requeued once; a second no-show is terminal and counts toward
auto-join pause. Bot lifecycle updates are scoped to the current provider bot,
so late events from the first attempt cannot overwrite its retry. If the retry
cannot start before the call window closes, Timeline terminalizes it as a
no-show and advances the same pause counter.
_Avoid_: Infinite lobby, standby bot

**Support Request**:
A public or signed-in request for help or sales contact. It belongs to platform
operations, not to a team's timeline.
_Avoid_: Ticket unless a ticketing workflow exists

## Flagged ambiguities

**Author vs. Visibility Owner**:
An author is attribution for content. A visibility owner controls the audience.
These are often the same person, but shared sources such as group chats,
forwarded email, meetings, and integrations can separate the concepts.

**Source Truth vs. Timeline Control**:
Timeline display should preserve who actually said or did something in the
source system separately from who captured it, owns the source, or controls
visibility inside the Timeline.

**Sender vs. Source Owner**:
Sender answers who produced a captured message. Source owner answers which
Timeline team member controls source-owned routing and visibility when the
sender is not a verified Timeline member.

**Slack Workspace vs. Team**:
A Slack workspace is external infrastructure. A Timeline team is the product
workspace that owns timeline history and visibility boundaries.

**Audit Log vs. Timeline**:
The timeline records team work and source evidence. The trust audit log records
sensitive access and administrative actions inside the product.

**Team Export vs. Backup**:
Team export is a portability feature constrained by the requester's visibility.
Backup is an operations feature for restoring infrastructure state.

**Workspace Time vs. User Time**:
Workspace time answers shared questions such as "last week" and "week 24".
User time is only for personal display or input when the user's local context is
explicitly relevant.

**Calendar Week vs. Calendar Month**:
A calendar week is an ISO week and may span month or year boundaries. A calendar
month view can display ISO week rows that include dates outside the month.

**Workspace Timezone vs. Event Timezone**:
The workspace timezone is the default for shared interpretation. An event
timezone can override it for a specific calendar event.

**Prompt Time vs. Time Resolution**:
Prompt time gives agents cheap current context on every turn. Time resolution is
the authoritative way to turn relative or ambiguous time phrases into ranges.

**Conversation Time vs. Evidence Time**:
Conversation time resolves relative dates in live user questions against the
current workspace time. Evidence time resolves relative dates inside a raw event
against that raw event's occurrence time.

**Vague Time Phrase**:
A time reference that signals intent without resolving to a concrete date or
bounded range, such as "soon" or "after the launch". Vague time can justify an
undated task suggestion, but not an invented due date.
_Avoid_: Approximate due date

**Commitment**:
A natural-language promise, decision, deadline, scheduled obligation, or
follow-up that implies future work or time-bound state. Commitments can appear
in ordinary conversation without explicit commands to create tasks or events.
_Avoid_: Command, reminder request

**Calendar Suggestion vs. Task Suggestion**:
A calendar suggestion requires a concrete timed range or all-day date span. A
task suggestion can be undated when the source implies work but not a specific
schedule.
_Avoid_: Calendar placeholder

**Suggestion Review Queue**:
A workspace view where team members review agent-suggested creates and edits
before they become canonical workspace state. It is the primary review surface
across objects, tasks, calendar events, and later suggestion types.
_Avoid_: Chat approval, scattered approvals, silent automation

**Agent Suggestion**:
A proposed workspace create or edit produced by an agent from chat or background
processing. Agent suggestions are reviewed in one queue before becoming
canonical workspace state.
_Avoid_: Pending object, draft event

**Suggestion Bundle**:
One reviewed agent suggestion that can contain multiple proposed outputs from a
single commitment, such as a task plus a calendar event. The bundle keeps shared
evidence and review context together.
_Avoid_: Duplicate approval rows

**Commitment Assignee**:
The team member a commitment is assigned to when the source clearly identifies
who promised or owns the work. If the speaker or person cannot be mapped
confidently to a team member, the commitment remains unassigned.
_Avoid_: Guessed assignee

**Canonical Workspace State**:
The accepted objects, tasks, calendar events, documents, and related records
that ordinary product surfaces treat as real. Agent suggestions are not
canonical workspace state until accepted.
_Avoid_: Suggested task as task, suggested event as event

**Suggestion Operation**:
The action an agent suggestion would perform if accepted: create, update, or
archive/cancel canonical workspace state. Deletion-like suggestions preserve
audit history rather than erasing source evidence. Cleanup of existing noisy or
duplicate objects should happen through archive or merge suggestions rather
than silent deletion.
_Avoid_: Hard delete suggestion

**Suggestion Dedupe Key**:
A stable identity for an agent suggestion derived from its team, source
evidence, operation, target, and normalized proposed payload. It prevents
background retries from producing duplicate pending approvals. The exact key is
not the only duplicate guard: active or retryable approval items are also
reconciled by kind-aware identity, including semantic create matching for
objects/tasks/calendar events, endpoint matching for
relationships, normalized value matching for identity facets, semantic object
note matching, board target/field matching, plus same-target overlapping
updates. Calendar create dedupe treats exact external events, same timed range
with matching title subject, older single-day date-only proposals refined by
newer timed proposals, and same date-only range matches as deterministic;
similar same-day timed proposals with different times require high-confidence
AI adjudication before one supersedes the other. Calendar adjudication goes
through the shared `llm.chatStructured` inference layer; tests can inject
`TeamScopeDeps.chatStructured` or `SuggestionScopeDeps.chatStructured` for
deterministic outcomes without provider calls.
_Avoid_: Best-effort duplicate detection

**Suggestion Evidence**:
The raw events and extracted context that justify an agent suggestion. A single
suggestion can have multiple evidence links when later events confirm or refine
the same proposed workspace change, including when a semantically duplicate
pending proposal is merged into one surviving active approval.
_Avoid_: Single-source assumption

**Suggestion Approver**:
A team member allowed to accept or reject a suggestion. Approval authority
follows the suggestion's source visibility boundary; owner/admin does not
override private or restricted visibility.
_Avoid_: Global approver

**All-Day vs. Timed Calendar Events**:
An all-day event is a local date span. A timed event is an instant range with a
timezone used for interpretation and display.

**Date-Only vs. Vague Time**:
Date-only means the date is concrete and belongs on the calendar as all-day.
Vague time means the date is not concrete and should not create a calendar
event. Date-only calendar suggestion payloads may arrive as canonical
`startDate` / `endDate` fields or legacy `start_date` / `end_date` aliases; both
normalize to an all-day local date span in the workspace calendar timezone when
no explicit timezone is supplied.

## Example Dialogue

Developer: "Can a team owner change a private event to team-visible?"

Domain expert: "No. Owner/admin controls team settings, but the visibility owner
controls that event's audience."

Developer: "What about an email forwarded into a shared team address?"

Domain expert: "If the sender is a verified team member, they can be the
visibility owner. If the sender is external or unknown, the email source owner
controls visibility for that source-owned event."

Developer: "Should changing the email default update old emails?"

Domain expert: "No. A visibility default only affects future captures. Existing
items need one-off visibility edits by their visibility owner."

Developer: "If Alice binds a Slack channel and Bob posts there without linking
his Slack account, who is Bob in the timeline?"

Domain expert: "Bob is still the sender, and that sender context matters for
retrieval. Alice is the source owner for routing and visibility control until
Bob has a verified Timeline user link."

Developer: "Should every captured Slack or Telegram group message get a
reaction so people know it landed?"

Domain expert: "No. Explicit notes and media may get capture acknowledgements
in DMs. Agent DMs use a progress acknowledgement. Group chats and channels
should stay quiet."

Developer: "When the agent hears 'what happened last week', should it use UTC?"

Domain expert: "No. It should use the team's workspace time context, with ISO
week boundaries, unless the question is explicitly about a user's local time."

Developer: "Is an all-day offsite stored as midnight UTC to midnight UTC?"

Domain expert: "No. It is a local date span in the event or workspace time
context; UTC instants are only a query/indexing representation."

Developer: "If we agree there is a call next Tuesday but not the time, should
the agent wait?"

Domain expert: "No. Next Tuesday is concrete, so the call can start as an
all-day calendar event and later be edited into a timed event."

Developer: "If the time is agreed later, should the agent create a second
calendar event?"

Domain expert: "No. That is a calendar refinement: update the existing event
instead of duplicating the commitment."

Developer: "If the team agrees on a daily call every weekday except Saturday,
should each call be suggested separately?"

Domain expert: "No. That is a recurring calendar series. The approval creates
one series with materialized occurrences, and later movement of one call edits
that occurrence as an exception."

Developer: "If we propose five customer meeting times, should those become five
busy meetings?"

Domain expert: "No. After approval they are a tentative slot group: visible
holds, not confirmed meetings. When one slot is confirmed, the chosen slot
becomes confirmed and the alternatives are cancelled."

Developer: "Can the chat agent calculate 'week 24' itself from the prompt?"

Domain expert: "It can see cheap current context in the prompt, but exact ranges
come from time resolution so every agent and extraction path agrees."

Developer: "If an old raw event says 'next Friday', do we resolve from today?"

Domain expert: "No. Extraction uses evidence time: the raw event's occurrence
time in the workspace time context."

Developer: "Should 'follow up soon' become a dated task?"

Domain expert: "It can become an undated task suggestion with the original
phrase as source evidence, but the system should not guess a due date."

Developer: "Should the worker wait for someone to say 'create a task'?"

Domain expert: "No. It extracts commitments from ordinary conversation, such as
someone saying they will update pricing tomorrow."

Developer: "Can vague timing create a calendar event?"

Domain expert: "No. Calendar suggestions need a concrete timed range or all-day
date span; vague timing belongs on an undated task suggestion."

Developer: "Where should a user approve agent-created tasks or calendar edits?"

Domain expert: "In the suggestion review queue. Chat can create suggestions,
but approval is a workspace workflow, not a chat-only interaction."

Developer: "Is the queue just object changes plus calendar changes stitched
together?"

Domain expert: "No. Agent suggestions are a unified review model across
workspace domains."

Developer: "Should a suggested task already exist as a task?"

Domain expert: "No. It remains an agent suggestion until accepted; acceptance
creates or edits canonical workspace state."

Developer: "Can one commitment create both a task and a calendar event?"

Domain expert: "Yes. That is a suggestion bundle so the reviewer sees one
commitment and its proposed outputs together."

Developer: "If a transcript speaker says 'I'll update pricing', who owns the
task?"

Domain expert: "Only assign it when the speaker maps confidently to a team
member. Otherwise keep the suggestion unassigned and cite the source."

Developer: "Can agents suggest deleting things?"

Domain expert: "They can suggest archive or cancel operations. Source evidence
remains immutable and accepted changes preserve audit history."

Developer: "If a worker reprocesses the same raw event, should it create a new
pending approval?"

Domain expert: "No. The suggestion dedupe key should point it back to the same
agent suggestion."

Developer: "If a later message moves the meeting from Monday to Wednesday,
should both pending approvals stay active?"

Domain expert: "No. Workspace reconciliation should supersede the stale Monday
approval and keep only the Wednesday proposal actionable, while preserving the
old approval as history."

Developer: "If a teammate says they sent the deck, should the open deck task be
marked done automatically?"

Domain expert: "Conversation evidence should create a lifecycle update proposal
for the canonical task. It should not silently mark the task done unless the
change comes from an authoritative source for that artifact."

Developer: "If Google Calendar moves an imported meeting, does that need a
team approval?"

Domain expert: "No. Google Calendar is authoritative for the external calendar
event it owns, but it cannot directly rewrite unrelated workspace tasks or
objects."

Developer: "Can more than one raw event support the same suggestion?"

Domain expert: "Yes. Suggestions can accumulate evidence links so reviewers can
see why the agent proposed the change. If two active proposals describe the
same real-world change with different wording, the survivor should keep the
combined evidence instead of showing duplicate approvals."

Developer: "What if an early calendar proposal only names the day, and later
evidence gives the time?"

Domain expert: "That is a refinement. The timed proposal should replace the
single-day date-only approval and keep the old evidence. Multi-day date-only
proposals should not collapse into one timed slot on the start day. Two timed
slots on the same day should stay separate unless adjudication is highly
confident that the newer one replaces or corrects the older one."

Developer: "Should calendar and task suggestions have separate queues?"

Domain expert: "No. Pending approvals are a single cross-domain queue, with
contextual review also allowed on detail pages."

Developer: "Can an owner approve a private suggestion from another teammate's
source?"

Domain expert: "No. Suggestion approval follows source visibility; owner/admin
does not bypass private or restricted items."

Developer: "Where does the workspace time context get its timezone?"

Domain expert: "From team calendar settings. Browser time can help initialize or
display, but it is not the shared source of truth."

Developer: "Does 'week 1' start on January 1?"

Domain expert: "Not necessarily. Week numbers are ISO weeks, so week 1 is the
week containing the first Thursday of the ISO week-year."
