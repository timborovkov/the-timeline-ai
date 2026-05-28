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

**Owner/Admin**:
A team member with elevated control over team settings and shared operational
workflows. This role does not override private or restricted item visibility.
_Avoid_: Superuser, workspace root

**Raw Event**:
An immutable source record captured into the timeline. Raw events are the
evidence layer behind facts, objects, agent answers, and later exports.
_Avoid_: Message, activity, log entry

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
audit history rather than erasing source evidence.
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
