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
