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
individual source evidence. The timeline is date-first, with source clusters
inside each date and impact shown as attached context.
_Avoid_: Raw Event when referring to the grouped browsing unit

**Impact Context**:
The workspace consequences or links attached to a timeline moment, such as
tasks, boards, objects, calendar events, documents, decisions, follow-ups, or
pending approvals that were created, changed, referenced, or suggested from the
underlying evidence. Impact Context is truthful partial context: v1/v2 surfaces
hydrate it from existing metadata, suggestion evidence, object/task changes,
document versions, and calendar rows without inventing missing graph links.
_Avoid_: Related items when discussing what changed because of source evidence

**Workspace Reconciliation**:
The process of keeping derived workspace artifacts aligned when newer raw-event
evidence confirms, revises, supersedes, or invalidates earlier derived state.
Workspace reconciliation never edits raw events; it updates, cancels, archives,
supersedes, or proposes corrections to approvals, workspace objects, tasks,
calendar events, and other impact context.
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

**Artifact Cluster**:
A set of derived workspace artifacts that represent the same real-world
commitment, object, schedule, decision, or follow-up across product surfaces.
An artifact cluster can include pending approvals, workspace objects, tasks,
calendar events, and other impact context that should stay mutually consistent.
An artifact cluster can exist before a canonical artifact exists; newer evidence
may update or supersede a pending create approval when it clearly refers to the
same real-world artifact. Meaningful completed commitments may still become
canonical artifacts even when completion arrives before the create approval is
accepted; trivial completed work can remain raw evidence with no active proposal.
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

**Object Memory**:
The team's durable understanding of a workspace object: its canonical name,
aliases, structured fields, relationships, facts, notes, and approved changes
over time. Object memory is visible and reviewable; it is not a hidden agent
notebook.
_Avoid_: Agent memory when it implies opaque private state

**Object Memory Proposal**:
An approval-backed agent suggestion to create or update object memory, such as
adding an alias, identity facet, relationship, note, field value, or missing
workspace object. Object memory proposals become canonical only when a teammate
accepts them; weak mentions should remain evidence rather than proposed memory.
Creation proposals should be the last resort after checking existing objects
and pending proposals.
_Avoid_: Memory write when it hides the approval step

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

**Correction Proposal**:
An approval-backed suggestion created when newer evidence disagrees with
already accepted or otherwise canonical workspace state. A correction proposal
does not rewrite the earlier decision by itself; it asks the team to approve
the replacement, cancellation, archive, or field update.
_Avoid_: Automatic fix, silent update

**Superseded Approval**:
A pending approval that is no longer actionable because newer evidence or a
newer proposal has replaced it before the team accepted or rejected it.
Supersession is limited to the stale lifecycle dimension, approval item, or
incoherent proposed outcome inside an artifact cluster; unrelated pending
proposals for the same artifact remain actionable even when they appear in the
same review bundle. A pending approval is also superseded when canonical state
already reflects the proposed outcome, including after a direct edit or an
accepted approval. Narrower or private evidence does not supersede a broader
approval queue. Superseded approvals leave the active approval queue but remain
available as history with their evidence and replacement relationship.
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
_Avoid_: Alias when referring to an external account or contact detail

**Capture Surface**:
A way information enters the timeline, such as web capture, Telegram, Slack,
email, documents, meetings, integrations, or calendar import.
_Avoid_: Connector when the surface is first-party

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
retrieval and extraction, not only to timeline display.
_Avoid_: Display-only metadata

**Conversation Evidence Window**:
A small set of raw events around a conversational anchor event that the agent
uses to decide whether a task, calendar change, or object memory proposal is
actually supported by the surrounding exchange. The window starts with the
same source conversation and may include cross-source linked context only when
there is a strong relationship signal; every cited event must be visible to
the audience that receives the answer or proposal.
_Avoid_: Single-message evidence, chat history dump

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

**Slack DM Capture**:
A direct message from a linked Slack user to the Timeline Slack app that lands
in the user's selected Timeline team. Slack DM capture mirrors Telegram DM
capture: plain messages are source evidence, while ask commands produce agent
answers.
_Avoid_: Support inbox, chat-only command surface

**Capture Acknowledgement**:
A lightweight reaction or reply that confirms a direct-message capture landed.
Capture acknowledgements belong in DMs, not in group chats or channels where
they would add shared-channel noise.
_Avoid_: Channel receipt, delivery guarantee

**Conversational Attachment**:
A file attached to a message from a conversational capture surface such as
Telegram or Slack. Audio attachments become transcribed timeline events;
supported text, image, PDF, and document attachments become document-drive
versions linked back to the source message.
_Avoid_: Generic blob, message metadata only

**Attachment Guardrails**:
The shared limits that decide whether a conversational attachment is processed,
skipped with metadata, or rejected before download. Guardrails cover file size,
file type, attachment count, and expensive OCR/transcription routes.
_Avoid_: Best-effort download

**Active External Team**:
The Timeline team selected for a linked external user when a direct-message
capture surface can route to more than one team. Telegram and Slack DMs share
this mental model.
_Avoid_: Default workspace, primary team

**Slack App Installation**:
An admin-created connection between a Timeline team and an installed Slack app
inside a Slack workspace. Installation creates a shared capture surface; it is
separate from a member's Slack user link.
_Avoid_: Personal Slack link

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
A dismissible tutorial shown in the app to help a team learn capture surfaces.
It teaches the product loop; it is not a requirement that external data has
successfully arrived.
_Avoid_: Setup wizard, activation gate

**Home Dashboard**:
The signed-in landing surface for a team member. It gathers capture, onboarding,
ingest access, pending approvals, and a compact recent activity view without
trying to be the canonical event browser.
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
enter the calendar as all-day events and can later be refined into timed events
when a specific time is agreed.
_Avoid_: Unschedulable meeting

**Calendar Refinement**:
An update that turns an existing calendar event into a more precise version of
the same commitment, such as converting a date-only all-day call into a timed
call once the time is known.
_Avoid_: Duplicate calendar event

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
background retries from producing duplicate pending approvals.
_Avoid_: Best-effort duplicate detection

**Suggestion Evidence**:
The raw events and extracted context that justify an agent suggestion. A single
suggestion can have multiple evidence links when later events confirm or refine
the same proposed workspace change.
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
event.

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

Domain expert: "No. Capture acknowledgements are for DMs. Group chats and
channels should stay quiet."

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
see why the agent proposed the change."

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
