# Glossary

Definitions for product and engineering discussions. Current behavior belongs in the [documentation index](docs/README.md), not in this glossary.

| Term | Meaning |
| --- | --- |
| **Active External Team** | The Timeline team selected for a linked external user when a direct-message conversation can route to more than one team. |
| **Active Source Path** | The single provider connection and scoped external resource that currently feed one external source into a Timeline team. |
| **All-Day Calendar Event** | A calendar event that occupies one or more whole local dates in its event or workspace time context. |
| **Artifact Cluster** | A set of derived workspace artifacts that represent the same real-world commitment, object, schedule, decision, or follow-up across product surfaces. |
| **Artifact Provenance** | The source-backed origin story for a derived workspace artifact, explaining why the artifact exists, belongs on a work surface, or changed, and which raw-event evidence window supported that creation, membership, or update. |
| **Ask** | The agent chat surface. |
| **Attachment Guardrails** | The shared limits that decide whether a conversational attachment is processed, skipped with metadata, or rejected before download. |
| **Authoritative Source** | A capture surface or integration allowed to directly update the canonical artifact it owns through a stable external identity, such as a provider event id or external object id. |
| **Board Card Detail** | The board-context view of a workspace object on a board. |
| **Board Item History** | The preserved record of board item membership and property changes, including adds, removals, lane moves, assignments, due-date changes, and accepted suggestions. |
| **Board Item Properties** | The standard board-local fields that help a team manage a board item, such as lane, position, responsible team member, due date, priority, next step, and board-local notes. |
| **Board Item Update Proposal** | An approval-backed suggestion to change board item properties based on timeline evidence. |
| **Board Item** | The user-facing card or row created by a board membership. |
| **Board Membership Proposal** | An approval-backed suggestion to add, remove, or update a workspace object's membership on a board. |
| **Board Membership** | The intentional relationship that places a workspace object on a board for that board's purpose. |
| **Board Preset** | A board creation starting point that explains a board's intended use through a plain-language purpose, example use cases, eligible object kinds, and starting stages. |
| **Board Purpose** | The plain-language explanation of what a board is for, what kinds of objects belong on it, and what evidence should justify membership or board item updates. |
| **Board State** | The board-specific workflow information attached to a board membership, such as the object's lane, position, or board-local stage. |
| **Board View** | One way to display the same curated board items: Kanban or grouped list. |
| **Board** | A curated work surface for a team-defined purpose, such as a pilot pipeline, development task board, marketing plan, product catalog, or management review. |
| **Budget Deferral** | A normal processing state where a captured file is indexed with lightweight metadata or preview context while deeper OCR, vision, transcription, or chunking waits for promotion, targeted inspection, or explicit user intent. |
| **Calendar Occurrence Exception** | A materialized occurrence that has been moved, edited, or cancelled separately from its recurring series. |
| **Calendar Refinement** | An update that turns an existing calendar event into a more precise version of the same commitment, such as converting a single-day date-only all-day call into a timed call once the time is known. _Avoid_: Duplicate calendar event |
| **Capture Acknowledgement** | A lightweight reaction or reply that confirms a direct-message capture landed. |
| **Capture Surface** | A way information enters the timeline, such as web capture, Telegram, Slack, email, documents, meetings, integrations, or calendar import. _Avoid_: Connector when the surface is first-party |
| **Captured File** | A source-backed file captured from a conversational surface or integration and made available for search, citation, and agent use. |
| **Captured Work Signal** | A signal class for durable work records. |
| **Communication Signal** | A signal class for conversational evidence. |
| **Connected Work** | The source-backed work context shown around one workspace object, such as tasks, calendar events, documents, shared links, captured files, boards, timeline moments, fact-backed people/object context, or pending approvals that mention, target, or materially involve that object. |
| **Connection Attention** | A user-actionable state where a provider connection or integration scope needs someone to restore, replace, narrow, or retry external access before sync can continue normally. |
| **Conversation Evidence Window** | A small set of raw events around a conversational anchor event that the agent uses to decide whether a task, calendar change, or object memory proposal is actually supported by the surrounding exchange. |
| **Conversation Review** | An ongoing review of a source conversation that re-evaluates durable information as new raw events arrive, including follow-up events that clarify or contradict an earlier anchor. |
| **Conversational Attachment** | A file attached to a message from a conversational capture surface such as Telegram or Slack. |
| **Core Evidence** | The anchor events and protected same-conversation events that define an evidence review. |
| **Correction Proposal** | An approval-backed suggestion created when newer evidence disagrees with already accepted or otherwise canonical workspace state. |
| **Date-Only Calendar Event** | A calendar event mentioned with a date but no time. |
| **Digest Destination** | A workspace-configured place the daily digest is sent. |
| **Direct Agent Conversation** | A private, provider-backed conversation between one verified Timeline user and the agent. |
| **Document Drive** | The curated browsing surface for folders and documents. |
| **Document** | A durable team knowledge file that members intentionally browse, version, and manage in the document drive. |
| **Duplicate Object Candidate** | A reviewable proposal that two workspace objects may represent the same real-world thing. |
| **Durable Information** | Information worth preserving because it changes future retrieval, interpretation, workflow, identity resolution, ownership, status, scheduling, or relationships for the team. |
| **Eligible External Teams** | The teams a verified external identity may select for a provider conversation. |
| **Environment Reset** | A development-only operational action that destroys all data and derived state in a non-production Timeline environment so it can be rebuilt from migrations and seed data. |
| **Event Visibility** | The audience attached to a raw event or equivalent timeline item: private, team, or specific users. |
| **Event-Local Proposal** | An approval-backed suggestion generated primarily from one raw event plus its extracted facts, mention-qualified hubs, and typed adjacent workspace state. |
| **Evidence Association** | A source-backed link between raw-event evidence and a workspace artifact, including direct references, conversation replies, attachments, links, and object-mediated context that make the evidence relevant to the artifact. |
| **Evidence Pack Policy** | The consumer-specific admission, ranking, visibility, and budget rules applied by the shared evidence-pack builder. |
| **Evidence Pack** | A deterministic, bounded set of visibility-safe raw events related to one or more anchor events. |
| **Evidence-Only Source** | A capture surface whose incoming information can support search, answers, and approval-backed suggestions but cannot directly update canonical workspace state. |
| **Explicit Chat Note** | Text that a person deliberately sends to the evidence pipeline from a direct agent conversation without asking the agent to answer. |
| **Extracted Representation** | A queryable text representation derived from a captured file or document version, such as source text, transcript text, visual description, or metadata preview. |
| **File Promotion** | The act of making an existing captured file visible and manageable as a document without copying its source blob or severing its source evidence link. |
| **Home** | The signed-in landing surface for a team member. |
| **Identity Facet** | A structured identifier on a person object, such as an email address, phone number, Telegram handle, Slack user id, GitHub username, or linked Timeline team member. |
| **Impact Context** | The workspace consequences or links attached to a timeline moment, such as tasks, boards, objects, calendar events, documents, decisions, follow-ups, or pending approvals that were created, changed, referenced, or suggested from the underlying evidence. |
| **Ingest Webhook Burst** | Multiple distinct webhook deliveries from the same ingest webhook that arrive close together. |
| **Ingest Webhook Credential** | A team-managed secret that authorizes writes into one ingest webhook. |
| **Ingest Webhook Duplicate Delivery** | A repeated webhook delivery whose payload is identical to a recent delivery for the same ingest webhook. |
| **Ingest Webhook Owner** | The team member who creates or configures an ingest webhook. |
| **Ingest Webhook Rotation** | Replacing an ingest webhook credential without changing the named ingest webhook source. |
| **Ingest Webhook** | A team-managed capture surface that accepts arbitrary external payloads as raw source evidence. |
| **Integration Audit Log** | The operational history of an integration, such as connection, sync, replay, and provider errors. |
| **Integration Scope** | The team-approved set of external resources Timeline may sync through a provider connection, such as selected GitHub repositories, a GitHub organization, Linear teams, Drive folders, specific Drive files, the user's Drive root, or shared drives. |
| **Intentional Capture** | A communication event the team wrote on purpose: home Capture, Telegram `/note`, or a voice memo. |
| **ISO Week** | A Monday-start calendar week identified by ISO week-year and week number. |
| **Job Recovery Dashboard** | A team-scoped owner/admin surface titled Job recovery for retrying or dismissing failed and stuck product jobs from the last 7 days, tied to visible team artifacts such as transcription, extraction, embedding, document processing, meeting finalization, and integration sync. |
| **Legal Acceptance** | A person-level acknowledgement of the current Terms of Use and Privacy Policy versions required before entering the signed-in product. |
| **Lifecycle Update** | A workspace reconciliation outcome that changes the state of a derived artifact because timeline evidence shows progress, completion, cancellation, blocking, rescheduling, or another workflow-state change. |
| **Meeting Capture Confirmation** | A short-lived acknowledgement that participants have been informed before Timeline joins a meeting. |
| **Meeting No-Show Window** | The bounded time Timeline will wait after joining a meeting link when nobody admits or joins the call. |
| **Memory Grade** | The role of a hub, not a numeric importance score. |
| **Memory Repair** | A user-triggered request for Timeline to re-evaluate an object, artifact, or connected work area and propose missing object memory, duplicate object candidates, or relationship candidates. |
| **Mention-Qualified Hub** | An existing company, vendor, deal, or project that the proposal engine may attach because the evidence uniquely names it (canonical name, alias, a distinctive token such as `Faba` in `Faba website redesign`, a meeting title, or a container label such as Slack `#acme-project-development`, Monday board `Faba-ext`, or Telegram chat title). |
| **Noise** | Captured content that should remain raw evidence but should not become durable facts or object memory, such as message mechanics, incidental tool mentions, generic categories, reactions, forwarded links, or unsupported guesses. _Avoid_: Fact when the statement only repeats how a message was sent |
| **Object Board Context** | The compact summary of boards that currently include a workspace object, including each board's purpose and the object's board-local state. |
| **Object Memory Proposal** | An approval-backed agent suggestion to create or update object memory, such as adding an alias, identity facet, relationship, note, field value, or missing workspace object. |
| **Object Memory** | The team's durable understanding of a workspace object: its canonical name, aliases, structured fields, relationships, facts, notes, and approved changes over time. |
| **Object Relationship** | A durable object-memory edge between two workspace objects, such as a person being linked to a company, a task blocking a project, or two objects being otherwise connected. |
| **Onboarding Checklist** | A dismissible team setup checklist that teaches the product loop: capture, invite teammates, connect chat and email, upload a document, ask the agent, invite the bot to a call, review a proposal, configure daily digests, and connect a source, webhook, or Timeline MCP. |
| **Owner/Admin** | A team member with elevated control over team settings and shared operational workflows. |
| **Person Object Candidate** | A reviewable proposal for a person workspace object. |
| **Person Object** | A workspace object for a real-world person, whether or not that person belongs to the Timeline team. |
| **Personal Pin** | A current team member's ordered shortcut to durable workspace content. |
| **Pipeline Board** | A board started from pipeline-style defaults for tracking objects through relationship, sales, partnership, or delivery stages. |
| **Preset Defaults** | The editable starting stages, board item properties, example labels, and recommended object kinds supplied by a board preset. |
| **Primary Project** | The optional canonical project that owns a task, stored as one durable task-to-project `child` relationship. |
| **Progress Capability** | A provider adapter's best available signal that an accepted agent turn is still queued or running. |
| **Proposal Audience** | The common audience allowed to see every selected citation and the resulting approval-backed proposal. |
| **Proposal Generation Default** | The source-level setting that decides whether future source evidence should immediately ask the agent to propose approval-backed workspace changes. |
| **Proposal Revision** | A reviewer-authored rewrite of an unresolved approval item. |
| **Provider Connection** | A person-owned login or credential grant to an external provider, such as a team member's GitHub account. |
| **Pulse Signal** | A signal class for telemetry and heartbeats. |
| **Q&A Note** | An object note that preserves a reusable question-and-answer exchange from a message-like capture surface, such as Telegram, Slack, or email, on the most relevant existing workspace object, usually a topic, decision, project, or policy-like object. |
| **Quick Meeting Capture** | An ad hoc request for Timeline to join a live meeting from a chat command or minimal form, where the title may be filled in after the transcript is finalized. _Avoid_: Scheduled meeting when the call is already happening |
| **Raw Event** | An immutable source record captured into the timeline. |
| **Reconciliation Dashboard** | A team-scoped owner/admin health view for evidence coverage, clusters, and proposed workspace updates. |
| **Recurring Calendar Series** | A canonical calendar event with an RRULE schedule that materializes concrete occurrence rows for near-term display and search. |
| **Reference Knowledge** | Curated document-drive files (manual upload, promoted captured files) stored as versions and chunks. |
| **Rejected Approval** | A proposal the team has explicitly declined. |
| **Representation Correction** | A user-authored correction layered over an extracted representation, such as a fixed transcript name or OCR phrase. |
| **Saved Meeting** | A reusable meeting capture target, usually with a stable meeting link and aliases, where teammates expect Timeline to join without re-entering the link. |
| **Sender Context** | Sender, conversation, and thread information that helps interpret a captured message. |
| **Sender Resolution** | The derived association between a captured sender and a person object. |
| **Sender** | The person or external identity that produced a captured message. |
| **Signal Class** | The processing role of one raw event, independent of which OAuth app emitted it. |
| **Slack App Installation** | An admin-created connection between a Timeline team and an installed Slack app inside a Slack workspace. |
| **Slack Conversation Binding** | A routing relationship from a Slack conversation to a Timeline team. |
| **Slack Direct Agent Conversation** | A direct message conversation from a verified Slack user to Timeline. |
| **Slack User Link** | An OAuth-proven relationship between a Slack user in a Slack workspace and a Timeline team member. |
| **Slack Workspace** | An external Slack tenant where the Timeline Slack app is installed. |
| **Source Deletion** | A deletion signal reported by the original capture surface. |
| **Source Envelope** | The provider-blind fields every adapter must emit: signal class, optional object map, external object id, human-facing content text, URLs, and aliases. |
| **Source Owner** | The team member responsible for a shared capture surface when the source does not map cleanly to a single human author. |
| **Source Surface** | The source family a person recognizes, such as Slack, email, meetings, GitHub, Monday, or one immutable generic-webhook identity. |
| **Superseded Approval** | A pending approval that is no longer actionable because newer evidence or a newer proposal has replaced it before the team accepted or rejected it. |
| **Support Request** | A public or signed-in request for help or sales contact. |
| **Supporting Evidence** | A directly related, visibility-safe raw event admitted through a stable one-hop relationship to the anchor or core. |
| **Synthetic Team Agent** | A non-member, zero-UUID actor used by an explicitly trusted team-level surface, such as an agent-enabled outbound MCP key or an unlinked sender in a bound Telegram group or Slack channel. |
| **Targeted File Inspection** | An agent-initiated read of a specific captured file or document version to answer a narrow question about the original file. |
| **Task Category** | A single product-owned functional workstream on a canonical task, such as Engineering, Design, Sales, or Legal & Compliance. |
| **Team Export** | A portable archive of data the requesting owner/admin is allowed to access. |
| **Team Member** | A person who belongs to a team. |
| **Team** | A workspace shared by a group of people. |
| **Tentative Slot Group** | A set of proposed meeting times that are visible as tentative calendar holds after approval. |
| **Time Resolution** | The deterministic translation of human time phrases into exact workspace-local date spans and UTC query ranges. |
| **Timeline event class** | A provider-agnostic presentation family for captured events: communication, work record, pulse, incident, artifact, or schedule. |
| **Timeline Moment** | A user-facing cluster of related raw events shown together on the timeline so team members can understand a meaningful slice of work before drilling into individual source evidence. |
| **Trust Audit Log** | An append-only record of sensitive reads and security-relevant actions inside the product. |
| **Visibility Default** | The initial visibility applied to future items from a capture surface. |
| **Visibility Owner** | The person allowed to change an item's visibility. |
| **Visual Description** | A model-generated description of what a visual captured file or document page shows, distinct from faithful source-text extraction. |
| **Voice Memo** | A spoken capture sent because speaking was faster than typing, such as a Telegram or Slack voice note. |
| **Work Hub** | The Timeline task, project, person, or artifact cluster that events from different surfaces attach to. |
| **Workspace Object** | A durable team memory item that represents something the team wants to track, such as a person, company, project, task, decision, deal, or follow-up. |
| **Workspace Reconciliation** | The process of keeping derived workspace artifacts aligned when newer raw-event evidence confirms, revises, supersedes, or invalidates earlier derived state. |
| **Workspace Time Context** | The team's default frame for interpreting relative dates, day boundaries, week numbers, and calendar display when no user-specific timezone is explicitly needed. |
| **Workspace Timezone** | The team's canonical timezone for workspace time context. |

## Distinctions

- Attribution is not authority: author, visibility owner, connection owner and approving member can differ.
- A Timeline team is not an external Slack workspace or a provider account.
- Captured evidence is immutable; derived state is revisable under its owning policy.
- Source event time resolves claims in evidence; conversation time resolves a current question. Workspace-relative dates use the team timezone.
- A code change is not proof of deployment, provider configuration, or legal approval.
- Signal class controls processing rights; event class labels timeline content. See [the memory engine](docs/relational-memory.md).
