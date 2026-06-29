# Reconciliation Engine Architecture Plan

Generated on 2026-06-28.

## Goal

Timeline should not depend on a lucky extraction pass to decide whether customer
emails, Monday boards, Sentry projects, Slack threads, documents, meetings, and
other provider events become useful memory. Every captured item should enter a
single reconciliation engine that decides:

1. Which real-world work artifact the evidence belongs to.
2. Which canonical workspace state the evidence can update directly.
3. Which object, relationship, board, task, calendar, or note changes need human
   approval.
4. Which suggestions and object memories are good enough, measured by live AI
   evals.

AI inference cost is not a constraint for this design. The engine should use
more model calls when that gives cleaner anchoring, better proposal quality,
stronger citation validation, or better regression detection.

This is a replacement architecture. The goal is not to preserve parallel legacy
paths for provider object upserts, conversation suggestions, object repair, and
artifact clusters. The goal is one engine, one proposal model, one source of
authority policy, and one eval harness.

## Current State

The repo already has strong primitives:

- Immutable `raw_events` with source-specific idempotency keys.
- Structured extracted `facts` and `fact_entities`.
- `artifact_clusters`, `artifact_cluster_anchors`, and
  `artifact_cluster_members`.
- Provider integration events with optional `objectMap`.
- Background suggestions with approval-backed `agent_suggestions`,
  `agent_suggestion_items`, and `agent_suggestion_evidence`.
- Object relationships, Connected Work, object summaries, and tiered
  provenance views.
- Fast deterministic agent evals under `pnpm test:eval`.

The problem is that these primitives are not governed by one pipeline:

- Integration sync currently writes raw events, optionally upserts objects, then
  attaches artifact evidence.
- Conversation capture currently routes through the suggestion worker and can
  create object/task/calendar/relationship proposals.
- Object repair has a separate object-centered proposal path.
- Artifact clusters can attach provider evidence but do not own the full
  proposed-state lifecycle.
- Agent evals test retrieval and safety. The reconciliation eval gate now covers
  the first source-ref, visibility-floor, evidence association, output, and
  replay contracts; broader object/cluster/proposal fixture coverage remains
  part of the target harness below.

## Target Architecture

Use one reconciliation engine for every source.

```text
source adapters
  web notes | voice/audio | email | slack | telegram | meetings | calendar
  documents | native integrations | ingest webhooks | MCP-derived evidence | system events
        |
        v
immutable raw events and source payload references
        |
        v
evidence normalization
  source facts, anchors, actors, timestamps, links, provider object identity
        |
        v
artifact resolution
  hard anchors -> structured anchors -> AI candidate set -> review candidates
        |
        v
reconciliation planner
  authority policy + lifecycle policy + object memory policy + board policy
        |
        v
reconciliation proposals
  direct authoritative writes | approval bundles | observed associations
        |
        v
canonical state and review UI
  objects | tasks | relationships | boards | calendar | notes | summaries | search | chat
        |
        v
evals and replay
  live model evals | fixture replay | regression snapshots | production sampling
```

The engine has five layers:

1. **Evidence normalization** converts raw events and provider payloads into a
   common evidence envelope.
2. **Artifact resolution** decides which artifact cluster each evidence item
   belongs to.
3. **Reconciliation planning** decides what should happen because of that
   evidence.
4. **Application** applies authoritative writes or creates approval bundles.
5. **Evaluation and replay** prove the engine still produces the intended
   objects, suggestions, citations, and non-leakage behavior.

## Ingestion Surface Coverage

Every ingestion surface must enter the same normalization, resolution, planning,
application, and eval path. A surface may have its own adapter and payload
shape, but it does not get its own proposal engine or object-writing shortcut.

| Surface | Examples | Required normalized evidence |
| --- | --- | --- |
| Web notes | Manual text notes, pasted customer updates, ad hoc project notes. | Author, text, occurred time, visibility, explicit links, mentioned objects, attachment refs, source URL when present. |
| Voice/audio | Voice memos, uploaded audio, future mobile capture. | Transcript source refs, speaker/author, transcript confidence, audio object ref, timestamps, visibility, extracted anchors. |
| Email | Inbound email, forwarded chains, attachments, customer domains, message IDs. | Message ID, thread key, sender/recipients/cc, domains, subject, forwarded boundary metadata, attachment refs, source URLs when available. |
| Slack | Native Slack workspace ingestion, channel/thread capture, files, reactions, edits/deletes. | Workspace/channel/thread/message IDs, sender, permalink, parent thread, file refs, edit/delete markers, channel binding, visibility. |
| Telegram | Bot-captured chats, forwards, attachments, voice transcripts. | Chat/message IDs, sender, reply/forward metadata, attachment refs, transcript refs, visibility, conversation key. |
| Meetings | Recall.ai transcripts, calendar-linked meetings, chunks, participants. | Meeting provider ID, calendar event ID, participants, speakers, transcript chunks, host-consent state, timestamps, visibility. |
| Calendar | Provider events, Timeline-created events, RSVP and cancellation rows, due-date mirrors. | Calendar event ID, provider event ID, recurrence/exception identity, attendee identities, schedule fields, RSVP/lifecycle state. |
| Documents | Uploaded files, Drive-harvested files, document versions, OCR/media text, chunks. | Document/version/chunk IDs, folder, file URL, version timestamp, title, extracted text refs, owner, visibility. |
| Native integrations | Google Drive, Linear, GitHub, Monday.com, Slack workspace, Sentry, and future Jira/Confluence/Notion/Figma/GitLab/HubSpot/Asana/Salesforce/Zendesk/Intercom/Datadog/Stripe/Trello/Basecamp/Bitbucket/Discord/Pipedrive/Attio/Close. | Provider, integration ID, selected resource, external object ID, external event ID, event type, actor, URL, provider lifecycle fields, provider payload ref, provider authority hints. |
| Ingest webhooks | Named customer/project webhooks, signed generic events, third-party tools without native adapters. | Webhook ID, credential/version, declared source name, dedupe key, optional artifact key, declared field authority, payload ref, visibility default. |
| MCP-derived evidence | Future explicit captures from custom MCP tool results. | Server/tool identity, call ID, fenced output ref, external source labels, user/team that invoked it, visibility, declared trust level. |
| System events | Object changes, approval application, board item changes, job recovery, reconciliation runs. | Actor, target object, target artifact, changed fields, source output ID, source refs, reason, audit metadata. |

Coverage rules:

- Each surface must define a normalizer contract before it can create
  reconciliation outputs.
- Each normalizer must produce stable source identifiers, source refs, a
  replayable payload reference, visibility, and at least one anchor or an
  explicit `no_anchor` reason.
- Each surface must have deterministic replay fixtures and at least one live
  eval case before it is considered migrated.
- Provider-specific object mapping is allowed only as evidence hints. Canonical
  object creation or updates happen through reconciliation outputs.
- Future providers from the integration catalog stay on the same contract; they
  do not add provider-specific memory pipelines.

Implementation status: Phase 1 currently writes normalized evidence for
integration events and generic raw-event surfaces such as web/email,
Slack/Telegram, ingest webhooks, document events, calendar events and due-date
mirrors, meeting finalization, and system object events. Integration events
that still carry `objectMap` also write associations, direct-write outputs, and
observed-association outputs alongside the existing integration object upsert
path. That bridge keeps current product behavior stable while later phases
retire direct provider object writes. Phase 2 now also includes a shared
coverage/backfill module and the worker command
`pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid>
--mode=audit|backfill`, so historical rebuildability can be measured before it
is claimed. Phase 3 has started with an anchor-based resolver that consumes
normalized evidence anchors, writes `artifact_evidence_associations`, claims
cluster anchors, carries the full visibility-floor envelope, and refuses
ambiguous multi-cluster matches by emitting pending conflict outputs instead
of silently merging evidence. Phase 4 has started with a shared field-scoped
authority policy module that classifies evidence as direct write, approval
required, observed-only, or blocked, and the integration output bridge now uses
that policy for provider-owned lifecycle outputs and observed associations.
Phase 4 also exports a shared structured planner module so live evals and later
worker planning paths use one prompt/schema contract for scenario, surface,
output-kind, source-ref, and visibility-risk classification. Conversation
reviews now also write applied `no_action` reconciliation outputs when the
review completes without proposals, with source refs for the reviewed evidence
window, visibility floors from the anchor evidence, and replay-safe dedupe.
Phase 5 has started with a durable reconciliation projection outbox: approval
projection creation, output status transitions, and projection repair now write
output-owned, deduped outbox rows alongside the existing `agent_suggestions`
projection. Approval projection creation and repair validate source refs before
creating or rebuilding UI rows, and projection metadata records the validation
result for audit/replay. Phase 3 also cut over the shared artifact evidence
helper so new generic artifact attachments write `artifact_evidence_associations`
with source refs, reused or normalized evidence rows, and visibility floors
instead of creating fresh `artifact_cluster_members` rows. Integration sync keeps
its richer association/output projection writer for provider-owned object maps,
while the legacy member table is now read/backfill compatibility only. Phase 6
has started with read compatibility for the new association graph: artifact
evidence listing, timeline semantic search, and object Connected Work hydrate
from `artifact_evidence_associations` as well as legacy members, pending
reconciliation outputs can appear as related approval work, and association
visibility floors are enforced before evidence reaches search results or object
detail context. Phase 8 has started by cutting accepted object/task suggestion
creates off the canonical `entities.source_event_id` write path: legacy
`sourceEventId` payloads are still validated and used for proposal evidence
selection while authoritative provenance remains on suggestion/reconciliation
evidence rather than the object row. Phase 7 now has a reusable eval matrix
that covers every active ingestion surface across customer-project, incident,
decision, calendar-project, and generic-webhook scenarios. Deterministic evals
score the matrix for output kinds, association roles, source refs, source
payload refs, and visibility floors; the opt-in live eval command runs the same
matrix through the real `llm.chatStructured()` path and can emit redacted case
artifacts plus a run manifest for replay/debugging. Typed surface and scenario
manifests now make coverage rows explicit for scheduled eval/reporting runners.

## Application Scenario Coverage

The engine must support more than customer-project clustering. These scenario
families define the product behaviors implementation and evals must cover.

| Scenario family | What the engine must do |
| --- | --- |
| Customer/account memory | Create and maintain company, person, deal, vendor, and customer-project memory from emails, meetings, Slack, CRM/support integrations, and documents. |
| Project execution | Connect Monday/Jira/Asana/Linear/GitHub work, documents, decisions, meetings, and conversations into one project artifact without letting one provider own unrelated state. |
| Incident and operational response | Connect Sentry/Datadog/GitHub/Slack/customer emails into incidents, lifecycle updates, impact evidence, owners, follow-ups, and postmortem documents. |
| Sales and renewal workflows | Reconcile CRM deals, customer emails, contracts, call notes, support tickets, Stripe/finance events, and follow-up tasks into account/deal state. |
| Support and success workflows | Connect Zendesk/Intercom tickets, customer companies, reported pain, SLAs, engineering issues, and follow-up commitments. |
| Product decisions | Extract decisions from email, Slack, Telegram, meetings, docs, PRs, Linear/Monday updates, and attach them to projects, customers, incidents, or roadmap topics. |
| Document-driven memory | Turn Drive/Notion/Confluence/Google Drive/document uploads into evidence for policies, contracts, specs, design docs, decisions, and object summaries without treating document prose as direct authority over objects. |
| Calendar and scheduling | Reconcile meetings, recurring events, RSVP changes, due-date mirrors, suggested calendar events, and follow-up tasks while preserving provider-owned schedule authority. |
| Board and task maintenance | Update board memberships and board-local fields when provider-owned or approved, and propose updates when conversation/document evidence suggests changes. |
| People and relationship graph | Propose person/company/project/task/decision relationships from repeated evidence, preserve rejected pairs, and avoid creating weak first-name or semantic-only edges. |
| Duplicate and identity repair | Merge duplicate objects, aliases, provider identities, domains, acronyms, and renamed projects through approval-backed outputs with cited evidence. |
| Conflicts and contradictions | Surface conflicting hard anchors, contradictory lifecycle updates, stale provider state, and competing proposals as explicit conflict outputs. |
| Privacy and visibility | Keep private/specific-user evidence out of team memory, summaries, team-visible approval rows, search, chat, and eval artifacts. |
| Replay and backfill | Reprocess old evidence after prompt/schema changes and converge without duplicate clusters, duplicate proposals, or unauthorized writes. |
| External-content safety | Fence MCP/provider/webhook content before model exposure and verify no prompt-injection text can become instructions, object fields, or unquoted summaries. |

## Design Principles

- **Raw evidence stays immutable.** The engine never edits raw event content.
  Reconciliation writes derived rows only.
- **Artifact first, object second.** Evidence can be useful when it belongs to a
  work artifact even if it does not yet justify object memory.
- **Hard anchors beat semantic similarity.** Stable IDs, URLs, message IDs,
  issue IDs, board IDs, email participants, domains, and explicit artifact keys
  decide cluster membership first.
- **Semantic matches are review candidates, not merges.** AI can propose a
  cluster match, but weak matches do not silently merge evidence.
- **Authority is narrow.** A provider can directly update the canonical artifact
  state it owns. It cannot rewrite unrelated Timeline-owned memory.
- **Approvals are structured deltas.** Human review accepts a typed change plan,
  not a blob of model prose.
- **Every claim has source refs.** Suggestions, summaries, chat answers, and
  provenance views cite source evidence, not just derived memory.
- **Private evidence does not become team memory.** Visibility gates run before
  clustering, proposal generation, summary generation, search indexing, and
  eval fixture assertions.
- **Replays must be safe.** Reprocessing the same raw events should converge to
  the same cluster memberships, current proposals, and canonical state.
- **Live evals are part of the architecture.** Model quality is a required
  runtime property, not a manual prompt check.

## New Domain Model

### Reconciliation Evidence

Add a normalized evidence table instead of making every worker reinterpret
`raw_events.source_metadata`.

`reconciliation_evidence`

- `id`
- `team_id`
- `raw_event_id`
- `source_payload_ref`
- `payload_digest`
- `source`
- `provider`
- `external_object_id`
- `external_event_id`
- `event_type`
- `occurred_at`
- `visibility`
- `visibility_owner_user_id`
- `visibility_user_ids`
- `actor`
- `content_digest`
- `title`
- `summary`
- `source_url`
- `metadata`
- `normalizer_version`
- `replay_state`
- `dedupe_key`
- `created_at`

This row is the stable input for reconciliation. It is derived and replayable
only when the source write retained an immutable payload snapshot or a durable
reference to the exact provider/customer content the normalizer saw.

`raw_events` remains the audit log, but it is not assumed to contain every
future anchor. If a provider adapter, email parser, transcript finalizer,
document extractor, webhook handler, or MCP capture normalizes away context, it
must write `source_payload_ref` before evidence extraction. The reference can
point at a raw MIME blob, parsed email chain, provider webhook payload,
integration object snapshot, document version/chunk, transcript chunk, fenced
MCP output, or redacted S3/object-store payload.

Constraints:

- Unique `(team_id, dedupe_key)`.
- `dedupe_key` includes source, raw event, source payload digest, and
  `normalizer_version`.
- Index `(team_id, raw_event_id, normalizer_version)`.
- Evidence without a usable payload snapshot is marked replay-degraded and
  cannot satisfy historical replay or live-fixture generation exit criteria.

### Source Payload Snapshots And Replay

Every ingestion surface owns a payload snapshot policy before it can create
reconciliation outputs.

- **Email and forwarded conversations:** retain raw MIME where available, parsed
  headers, normalized thread keys, attachment refs, and the forwarded-chain
  segments used for anchor extraction.
- **Chat and messaging:** retain message IDs, edited/deleted state, thread
  windows, channel context, user identity refs, and redacted content chunks.
- **Meetings and audio:** retain transcript chunk refs, speaker attribution,
  meeting provider IDs, recording/transcript provider metadata, and consent
  state.
- **Documents:** retain document version refs, chunk IDs, source URL, extracted
  text digest, and attachment/version metadata.
- **Native integrations:** retain provider payload snapshots for object,
  webhook, and sync records whenever the provider payload contains fields not
  represented losslessly in `raw_events.source_metadata`.
- **Ingest webhooks:** retain the signed payload ref, credential version,
  declared source name, dedupe key, and redaction digest.
- **MCP-derived evidence:** retain the fenced tool output ref, server/tool
  identity, call ID, invocation actor, and visibility envelope.

Snapshots are immutable. Secrets and credentials are redacted or encrypted
before storage; customer content keeps the same team/user visibility envelope as
the source event. Backfills use snapshots when available. If historical raw
events lack enough source payload, the replay result must say so explicitly
instead of claiming full rebuildability.

### Evidence Anchors

Move all cluster matching inputs into typed rows.

`reconciliation_evidence_anchors`

- `id`
- `team_id`
- `evidence_id`
- `anchor_type`
- `anchor_value`
- `strength`: `hard | provider | structured | semantic | human`
- `confidence`
- `source`: `adapter | extractor | model | human`
- `metadata`
- `dedupe_key`
- `created_at`

Constraints:

- Unique `(team_id, evidence_id, anchor_type, anchor_value, source)`.
- Index `(team_id, anchor_type, anchor_value)`.
- Conflicting hard/provider anchors emit conflict outputs instead of silently
  merging clusters.

Anchor examples:

- `provider_object:monday:board:123`
- `provider_object:sentry:project:456`
- `provider_object:sentry:issue:789`
- `email_thread:<message-id-or-normalized-thread-key>`
- `email_domain:customer.com`
- `participant_email:buyer@customer.com`
- `url:https://...`
- `artifact_key:customer:acme:implementation`
- `contract_id:MSA-42`
- `repo:owner/name`
- `issue_key:ENG-42`

### Artifact Clusters

Keep `artifact_clusters`, but make them the center of reconciliation instead of
a sidecar attached by integrations.

Changes:

- Rename product language to **work artifact** in docs/UI where it helps
  non-technical users.
- Add a dedicated `artifact_cluster_kind` enum. Do not reuse canonical
  `entity_type`; provider records, incidents, meetings, accounts, customer
  projects, and system workflows are not the same type system as durable
  workspace objects.
- Initial `artifact_cluster_kind` values: `customer_project`, `account`,
  `incident`, `deal`, `document`, `decision`, `task`, `meeting`,
  `calendar_event`, `provider_record`, `topic`, `person_context`,
  `relationship_bundle`, `system_workflow`, `other`.
- Phase 1 ships `artifact_cluster_kind`; later phases add
  `authority_owner` metadata for provider-owned clusters:
  `{ provider, externalObjectId, stateVocabulary }`.
- Later phases add `last_reconciled_at`, `reconciliation_version`, and
  `health_status`.
- Keep cluster anchors unique per team and hard-anchor based.

### Evidence Associations

Replace ad hoc `artifact_cluster_members` usage with a richer association model.

`artifact_evidence_associations`

- `id`
- `team_id`
- `cluster_id`
- `evidence_id`
- `raw_event_id`
- `role`: `origin | update | lifecycle_update | discussion | blocker |
  decision | related_context | contradiction | correction | evidence_only`
- `strength`
- `confidence`
- `association_source`: `hard_anchor | structured_anchor | model_candidate |
  human | authoritative_provider`
- `rationale`
- `source_refs`
- `visibility`
- `visibility_owner_user_id`
- `visibility_user_ids`
- `visibility_floor`
- `visibility_floor_owner_user_id`
- `visibility_floor_user_ids`
- `metadata`
- `dedupe_key`
- `created_at`

Current `artifact_cluster_members` can be migrated into this shape and removed
from application code. New application writes now target
`artifact_evidence_associations`; legacy member rows remain only for read
compatibility and historical backfill until the migration retires the table.

Constraints:

- Unique `(team_id, cluster_id, evidence_id, role, association_source)`.
- Unique `(team_id, dedupe_key)`.
- `dedupe_key` includes team, cluster, evidence, role, association source, and
  association policy version.

Association visibility is copied from the evidence envelope or narrowed by
policy. A private or specific-users evidence item may attach only as a
visibility-compatible private/restricted association. It cannot raise a
team-visible cluster identity, summary, approval row, search hit, MCP server
response, or chat answer.

### Reconciliation Runs

Every engine pass records what it considered and what it emitted.

`reconciliation_runs`

- `id`
- `team_id`
- `trigger`: `raw_event | evidence_batch | cluster_replay |
  manual_repair | eval | backfill`
- `scope`: logical run scope such as `evidence_id`, `cluster_id`,
  `raw_event_id`, `team_id`, `anchor_resolution`,
  `integration_direct_write`, `integration_observed_association`, or
  `approval_projection`
- `status`: `pending | running | completed | failed | superseded`
- `input_fingerprint`
- `engine_version`
- `model_versions`
- `started_at`
- `completed_at`
- `error_code`
- `metrics`
- `created_at`

### Reconciliation Outputs

Create a typed output table before applying changes.

`reconciliation_outputs`

- `id`
- `team_id`
- `run_id`
- `cluster_id`
- `output_kind`: `direct_write | approval_bundle | observed_association |
  no_action | conflict | eval_observation`
- `target_kind`: `object | task | calendar_event | identity_facet |
  object_note | object_relationship | object_merge | board_membership |
  board_item_update | cluster_identity | cluster_lifecycle`
- `operation`: `create | update | archive_or_cancel | merge | link |
  unlink | supersede | noop`
- `target_id`
- `payload`
- `authority_decision`
- `confidence`
- `requires_approval`
- `source_refs`
- `source_payload_refs`
- `visibility`
- `visibility_owner_user_id`
- `visibility_user_ids`
- `visibility_floor`
- `visibility_floor_owner_user_id`
- `visibility_floor_user_ids`
- `dedupe_key`
- `status`: `pending | applied | approval_created | rejected | superseded |
  failed`
- `created_at`
- `updated_at`

`agent_suggestions` and `agent_suggestion_items` become the approval UI
projection of `reconciliation_outputs`, not a separate proposal source.

Constraints:

- Unique `(team_id, dedupe_key)`.
- `dedupe_key` includes team, cluster, target kind, operation, target identity,
  source refs, authority policy version, and output planner version.
- Index `(team_id, run_id, status)`.
- Index `(team_id, cluster_id, output_kind, status)`.

Output visibility is the most restrictive visibility floor of the supporting
associations/evidence, unless a provider-owned direct write is backed by an
explicitly team-visible authoritative provider source. Approval projections
inherit output visibility exactly.

### Approval Projection Outbox

Projection transitions are durable rows owned by reconciliation outputs.

`reconciliation_projection_outbox`

- `id`
- `team_id`
- `output_id`
- `suggestion_id`
- `suggestion_item_id`
- `action`: `create_projection | mark_applied | mark_rejected | mark_failed |
  mark_superseded | repair_projection`
- `status`: `pending | processing | processed | failed`
- `payload`
- `dedupe_key`
- `processed_at`
- `created_at`
- `updated_at`

Constraints:

- Unique `(team_id, dedupe_key)`.
- Index `(team_id, status, created_at)`.
- Index `(team_id, output_id)`.
- Index `(team_id, suggestion_item_id)`.

The synchronous Phase 5 projection path marks these rows `processed` in the same
transaction as the output/projection transition. Future repair or async
projection workers must consume the same table with exactly-once dedupe instead
of inventing a separate projection queue.

### Visibility Envelope

Every derived row that can influence memory or UI carries a visibility envelope:
`visibility`, `visibility_owner_user_id`, `visibility_user_ids`, and
`visibility_floor`.

Rules:

- A derived association, output, approval projection, summary, search document,
  chat citation, or outbound MCP result cannot be more visible than the most
  restrictive supporting source.
- Team-visible cluster identity and lifecycle state are computed only from
  team-visible associations or explicit team-visible provider authority.
- Private/specific-user evidence can create private/specific-user outputs, but
  it cannot create or strengthen team-visible object memory.
- Human approval may accept a restricted output for the same restricted
  audience; it does not promote private evidence into team memory.
- Queries must filter both the cluster and each supporting association/output by
  the viewer's visibility envelope.
- Evals must include private, specific-user, and mixed-visibility clusters and
  fail on any leak into team-visible fixtures or production-sampling artifacts.

### Legacy Provenance Retirement

The reconciliation provenance graph replaces the old single-event pointer model.
`source_refs`, `source_payload_refs`, `reconciliation_output_id`, and
`artifact_evidence_association_id` become the only authoritative provenance
interfaces for canonical memory changes.

Migration rules:

- Stop writing `sourceEventId`/`source_event_id` as canonical object, object
  change, board item, or suggestion provenance.
- Stop writing `agentSuggested` as canonical object provenance. Approval status
  lives on `reconciliation_outputs` and its projection rows.
- Stop normalizing suggestion payloads whose only provenance is
  `sourceEventId`; every payload must cite source refs and output IDs.
- If legacy columns must remain during migration, they are read-only
  compatibility projections generated from reconciliation provenance. They are
  not accepted as write input.
- Definition of Done requires removing legacy write paths and dropping or
  deprecating the legacy columns after backfill verification.

## Engine Pipeline

### 1. Normalize Every Source

Every source writes `raw_events` first, then enqueues `reconcile_evidence`.

Affected paths:

- `apps/web/src/app/actions/events.ts`
- inbound email route/action code
- Slack conversational capture
- Telegram capture
- meeting finalize worker
- calendar writes
- document finalize/extract paths
- `apps/worker/src/workers/integrationSync.ts`
- ingest webhook handlers

Provider adapters stop returning `objectMap` as "please upsert an object now".
They return normalized evidence hints:

- source identity
- provider object identity
- source URL
- actor
- lifecycle vocabulary
- candidate object type
- candidate display title
- candidate state
- authoritative fields
- anchors

The normalizer writes `reconciliation_evidence` and anchors. It does not create
objects, update objects, or create approval suggestions.

### 2. Build Evidence Packets

For each evidence item, build a packet:

- normalized evidence row
- raw event source text
- source payload snapshot refs and digests
- provider metadata
- extracted facts
- participants and actor identities
- direct anchors
- nearby conversation window when source is conversational
- linked provider siblings when a provider exposes them
- existing clusters matched by hard or structured anchors
- candidate objects and relationships from current memory

AI calls are allowed here:

- extract missing anchors from messy emails and forwarded chains
- summarize provider payloads into source-backed evidence summaries
- classify event type and roles
- infer likely customer/project/account from participants and domains
- generate candidate cluster matches with reasons

The packet builder must fence external content before model calls when provider
or MCP content is involved.

### 3. Resolve Artifact Cluster

Resolution order:

1. Exact hard anchor match.
2. Provider object identity match.
3. Explicit artifact key match.
4. Structured customer/project anchors with no conflict.
5. AI candidate match, only when it has source-backed rationale and passes a
   deterministic ambiguity check.
6. New cluster.
7. Review candidate when ambiguous.

Ambiguity rules:

- If two hard anchors point to different clusters, emit a `conflict` output and
  do not merge automatically.
- If semantic candidates are close, emit an approval bundle for cluster
  association.
- If the evidence is private or specific-users, it may attach only to
  visibility-compatible private/restricted context. It cannot create team-wide
  memory.
- If a provider owns the exact external object, the provider-owned cluster wins
  for that object. Related customer/project clusters can get observed
  associations, not ownership.

### 4. Plan Reconciliation

The planner receives:

- evidence packet
- resolved cluster
- cluster evidence history
- current canonical state
- authority policy
- model-generated candidate changes

It emits outputs in four categories.

**Observed association**

Evidence belongs around a cluster but does not change canonical memory.

Example: a forwarded customer email mentions a Sentry issue and a Monday board
but only asks "can we discuss next week?" It attaches to the customer project
cluster as discussion context.

**Direct authoritative write**

The source owns the state being updated.

Examples:

- Sentry issue resolved -> incident cluster lifecycle becomes `resolved`.
- Monday status column changed -> Monday-owned board item state updates.
- GitHub PR merged -> GitHub-owned implementation cluster lifecycle becomes
  `resolved`.
- Calendar event cancellation from its provider -> that calendar event
  cancels.

Direct writes still record source refs and run outputs. They are not silent.

**Approval bundle**

The evidence suggests Timeline-owned memory should change.

Examples:

- Create company object from repeated customer domain and email signature.
- Link person to company.
- Create decision from an email thread.
- Attach Sentry incident to customer project.
- Add board membership for a project object.
- Merge duplicate company objects.

Approval bundles are typed and dependency-aware. A bundle can create a company,
create a person, and create the relationship between them using bundle-local
refs.

**No action**

The engine decided the evidence is already represented, too weak, out of scope,
or not visible enough. No-action rows are useful for evals and debugging.

### 5. Apply Outputs

Application has exactly two write paths:

1. `applyAuthoritativeOutput(outputId)` for direct writes.
2. `createApprovalProjection(outputId)` for review-required changes.

All current direct writes from provider `objectMap`, conversation suggestion
creation, and object repair proposals should be migrated to emit
`reconciliation_outputs` first.

Existing `agent_suggestions` can remain as the review UI table if it is treated
as a projection:

- `agent_suggestions.metadata.reconciliation_run_id`
- `agent_suggestions.metadata.reconciliation_output_ids`
- `agent_suggestion_items.metadata.reconciliation_output_id`

After migration, no code should call `createSuggestion` directly except through
the reconciliation projection adapter.

Projection consistency contract:

- `reconciliation_outputs` is the source of truth for proposal status,
  dependencies, suppression, application failures, and replay supersession.
- Creating approval projection rows happens in the same database transaction as
  the output status transition to `approval_created`, or through a durable
  outbox row committed in that transaction and consumed exactly once.
- Accept, reject, dismiss, retry, and supersede actions update the output first,
  then update projection rows in the same transaction or through the same
  output-owned outbox flow.
- Item dependencies live on reconciliation output payloads. Projection rows may
  render them, but they cannot invent separate dependency state.
- Application failures are written to the output and mirrored to projection
  metadata for UI. The retry source is still the output.
- Rejection suppression keys are output-level keys. Replays consult rejected or
  superseded outputs before creating replacement projections.
- Projection repair jobs can rebuild `agent_suggestions` from outputs, but they
  cannot create new proposal semantics.

## Authority Policy

Create a policy module in `packages/shared/src/reconciliation/authority.ts`.
Phase 4 now exports this module as
`@timeline/shared/reconciliation/authority`; provider object-map outputs use it
for direct-write vs observed-association decisions.

Policy input:

- source
- provider
- event type
- cluster kind
- target kind
- target field
- external object identity
- visibility
- current owner
- confidence

Policy output:

- `direct`
- `approval_required`
- `observed_only`
- `blocked`
- rationale

Provider examples:

| Source | Direct authority | Needs approval |
| --- | --- | --- |
| Monday | Its selected board, item, subitem, status, owner, due date, and WorkDoc state. | Timeline company/person/project memory inferred from board names, comments, or email references. |
| Sentry | Its issue/project/release lifecycle and incident facts tied to Sentry identity. | Customer impact, owner promises, company/person relationships, and project priority. |
| GitHub | Its issue, PR, release, and deployment lifecycle. | Product/customer decisions inferred from PR text. |
| Calendar | Its provider-owned event schedule and RSVP state. | Follow-up tasks, object relationships, and decisions inferred from meeting titles or notes. |
| Email | No broad direct authority. | Company/person/deal/project/decision/task/relationship proposals. |
| Slack/Telegram | No broad direct authority. | Tasks, decisions, relationships, notes, board updates, and object changes. |
| Documents | Document version and chunk state. | Object memory inferred from document content. |
| Ingest webhook | Direct authority only when the webhook declares a signed artifact key and field allowlist. | All other memory changes. |

Direct authority is field-scoped. A Sentry issue can resolve an incident cluster
but cannot change a customer company status. A Monday status column can update a
Monday-owned board item but cannot mark a Timeline project complete unless that
project is explicitly the Monday-owned artifact.

## AI Usage

Because inference cost is not limiting, split model work into focused calls.

Use separate structured calls for:

- source summarization
- anchor extraction
- entity candidate extraction
- cluster candidate ranking
- proposed memory changes
- contradiction detection
- source-ref validation
- eval judging

Do not ask one prompt to do all work. Smaller calls are easier to eval and
retry.

Every model output must be Zod-validated and source-ref checked. A candidate
change without valid source refs fails closed into `no_action` or `failed`
output, depending on whether the model missed optional or required evidence.

Suggested prompt versions:

- `reconcile-normalize-2026-06`
- `reconcile-anchor-2026-06`
- `reconcile-cluster-rank-2026-06`
- `reconcile-plan-2026-06`
- `reconcile-validate-2026-06`
- `reconcile-eval-judge-2026-06`

## Live AI Eval Harness

Add `pnpm test:reconciliation-eval` and include it in the relevant task gate
when reconciliation code changes. Keep `pnpm test:eval` for chat/retrieval
safety.

The harness is not a single golden-path test. It is a product-quality suite that
proves the engine creates the right clusters, objects, relationships,
suggestions, direct writes, conflicts, citations, and no-actions across every
ingestion surface and scenario family.

Phase 1 implements deterministic and live evals as inline Vitest cases. The
target harness moves broader replay fixtures behind explicit manifests:

- `packages/shared/src/reconciliation/evals/surfaces/*.json`
- `packages/shared/src/reconciliation/evals/scenarios/*.json`
- `evals/reconciliation/live-cases/*.json`

Each manifest names:

- ingestion surfaces covered
- scenario family
- fixture input files
- expected clusters
- expected direct writes
- expected approval outputs
- expected no-actions or conflicts
- expected source refs
- expected source payload refs when replay requires them
- forbidden outputs
- visibility assertions
- model/prompt versions
- minimum score gates

The harness has three modes.

### Deterministic Replay Evals

Runs in CI without external model calls unless explicitly enabled.

Phase 1 currently runs a fixture-backed matrix in
`packages/shared/src/reconciliation/eval-cases.ts` plus PGlite tests for
normalization, coverage/backfill, and anchor resolution. These cases assert
coverage across web, email, Slack, Telegram, meeting, document, calendar,
ingest-webhook, GitHub, Linear, Google Drive, Monday, and Sentry evidence;
source-ref validity; source payload refs; output kind counts; association
roles; visibility floors; private-evidence leak failures; replay coverage;
resolver outputs; and idempotency. Typed manifests in
`packages/shared/src/reconciliation/eval-manifests.ts` name each current surface
and scenario row, the fixture cases that prove it, expected output/association
kinds, payload-ref surfaces, prompt versions, and minimum pass scores. The
target replay harness adds fixture packets under
`packages/shared/src/reconciliation/evals/fixtures`, saved structured model
outputs, and fuller DB-state assertions for approval bundles, citations, and
visibility.

Required surface fixture families:

1. Web note -> project/company/person proposals.
2. Voice transcript -> task, calendar, and decision proposals.
3. Forwarded email chain -> company/person/project suggestions and thread
   anchors.
4. Slack thread -> decision/task/relationship proposals with thread anchors.
5. Telegram chat -> task/follow-up proposals and attachment refs.
6. Meeting transcript -> decision, follow-up, participant, calendar, and object
   associations.
7. Calendar event -> provider-owned schedule update and meeting-linked context.
8. Document version -> document evidence, object suggestions, and summary
   source refs.
9. Native integration event -> provider-owned lifecycle update plus
   approval-backed related memory.
10. Ingest webhook -> signed artifact-key handling, approval-only fallback, and
    declared field authority.
11. MCP-derived evidence -> fenced external content and observed-only/default
    proposal behavior.
12. System object/approval event -> audit-backed association without raw source
    mutation.

Required scenario fixture families:

1. Forwarded customer email chain creates company/person/project suggestions.
2. Monday board plus email thread resolves to one customer project cluster.
3. Sentry issue plus customer email attaches incident impact without letting
   Sentry rewrite customer memory.
4. Ambiguous customer domains create cluster review candidates, not merges.
5. Private forwarded email does not create team-visible memory.
6. Provider replay is idempotent.
7. Rejected relationship proposal suppresses exact repeats but allows a new
   endpoint resolution with new evidence.
8. Later authoritative lifecycle event supersedes earlier weaker state.
9. Conflicting hard anchors emit a conflict output.
10. Missing or invalid source refs fail proposal creation.
11. CRM/support/revenue evidence creates account/deal/support suggestions
    without over-writing provider-owned records.
12. Incident evidence connects Sentry/Datadog/GitHub/Slack/customer email into
    one incident artifact with customer-impact suggestions.
13. Product decision evidence links a decision to project/customer/task objects
    with source-specific citations.
14. Calendar recurrence and due-date mirror evidence does not duplicate events
    or turn schedule metadata into task completion.
15. Document evidence updates summaries and proposals only through cited chunks
    or document-version refs.
16. Board-local updates distinguish board membership, board item state, and
    object memory.
17. Duplicate object repair merges aliases/provider identities only when source
    evidence supports identity.
18. External prompt-injection text stays fenced and cannot become instructions,
    object names, or uncited summaries.

Deterministic assertions:

- expected cluster count and anchor ownership
- expected association roles and strengths
- exact direct-write target fields
- exact approval item target kinds and operations
- dependency ordering inside approval bundles
- source-ref validity and visibility
- forbidden direct writes
- rejected/superseded output behavior
- replay idempotency after running the same fixture twice
- migration coverage for historical raw events

### Live Model Evals

Runs on demand and in scheduled quality checks with real models.

Command:

```bash
pnpm test:reconciliation-eval:live
```

Phase 1 behavior:

- Uses the shared fixture matrix from
  `packages/shared/src/reconciliation/eval-cases.ts` in
  `packages/shared/src/reconciliation/live-eval.test.ts`.
- Calls the real `llm.chatStructured()` path when
  `RECONCILIATION_LIVE_EVAL=1` is set.
- Can load a local env file before the live call with
  `RECONCILIATION_LIVE_ENV_FILE=/path/to/.env`.
- Can write one redacted JSON artifact per live fixture plus a run-level
  `manifest.json` with `RECONCILIATION_LIVE_ARTIFACT_DIR=/path/to/eval-run`,
  or create timestamped run folders with
  `RECONCILIATION_LIVE_ARTIFACT_ROOT_DIR=eval-runs/reconciliation`. Artifacts
  keep model ids, prompt versions, expected/actual category summaries,
  planner pass/fail status, AI-judge scores, enum-only judge failure/strength
  codes, packet fingerprints, prompt fingerprints, and hashed raw-event refs;
  the manifest summarizes case files, surface/scenario coverage, pass/fail
  counts, judge pass/fail counts, and average judge score. Neither file type
  persists prompt text, source payload refs, raw event ids, or free-text judge
  rationale.
- Bounds each live planner and judge request with
  `RECONCILIATION_LIVE_CALL_TIMEOUT_MS` (default 90 seconds). Provider errors
  and timeouts become explicit case failures and still write redacted artifacts
  when artifact output is enabled.
- Scores the structured result with deterministic assertions for scenario
  family, ingestion surfaces, output kinds, source refs, approval/direct-write
  policy shape, and visibility/privacy risk.
- Runs a second structured `llm.chatStructured()` judge call for each live case.
  The judge returns a 0-1 usefulness/safety score, pass/fail, privacy concern,
  and bounded enum codes only. The live smoke gate requires each judged case to
  pass with a score of at least 0.9.

Target behavior:

- Loads redacted fixture packets from `evals/reconciliation/live-cases`.
- Calls the real `llm.chatStructured()` pipeline.
- Promotes timestamped artifact roots into the scheduled CI/live-eval workflow.
- Promotes the current structured judge into scheduled reporting and production
  sampling dashboards.
- Fails if required objects, suggestions, source refs, cluster associations, or
  no-leakage invariants are missing.

Live eval output should include:

- expected clusters vs actual clusters
- expected objects vs actual direct writes and approval items
- missing suggestions
- extra suggestions
- citation validity
- visibility failures
- model versions
- prompt versions
- packet fingerprints
- judge rationale

Live eval suites:

| Suite | Purpose |
| --- | --- |
| `surfaces-smoke` | One live case per ingestion surface to catch missing normalizer or source-ref behavior. |
| `customer-projects` | End-to-end account/project evidence from email, Monday, Sentry, meetings, and Slack. |
| `incidents` | Operational evidence from Sentry/Datadog/GitHub/Slack/customer email. |
| `sales-success` | CRM/support/revenue/customer conversation scenarios. |
| `documents-decisions` | Document, meeting, PR, and conversation evidence that should create or update decisions. |
| `privacy-security` | Private evidence, specific-user evidence, prompt injection, and MCP/provider fencing. |
| `replay-regression` | Replays historical and previously failed cases under current prompts. |

Minimum live eval quality bar before ship:

- 100% pass on privacy and visibility cases.
- 100% pass on citation validity.
- 100% pass on forbidden-direct-write assertions.
- 95% pass on required cluster/object/proposal existence.
- 90% pass on no-extra-dangerous-proposal cases.
- 90% pass on scenario-specific usefulness score from the AI judge.
- Zero direct writes outside authority policy.

When a live eval fails, the artifact should be usable as a new deterministic
fixture after the expected behavior is clarified.

### Production Sampling Evals

Runs against redacted production-like packets after deployment or during a
closed beta.

Rules:

- Sample across all active ingestion surfaces, not only the busiest one.
- Strip or hash private user content before artifact storage.
- Record evaluator outputs separately from customer-visible memory.
- Convert every confirmed miss, bad suggestion, bad cluster match, privacy
  near-miss, or extra dangerous proposal into a deterministic fixture.
- Track per-surface and per-scenario pass rates over time.

Production eval dashboards should show:

- pass rate by ingestion surface
- pass rate by scenario family
- required objects missed
- required suggestions missed
- extra dangerous suggestions
- citation failures
- visibility failures
- authority policy violations
- prompt/model version regressions
- time from raw event to reconciled output

## Application Surfaces

### Work And Timeline

Work and timeline views should show reconciliation impact without forcing users
to open raw evidence first:

- timeline moments show attached work artifacts, pending outputs, direct
  authoritative updates, and conflicts
- Work views group open tasks, board cards, object updates, incidents,
  decisions, and follow-ups by accepted artifact association
- filters can target source type, artifact kind, output kind, authority source,
  pending approvals, conflicts, and stale/no-action outcomes
- citation chips open source evidence, while artifact chips open the work
  artifact or object context

### Work Artifact Page

Create a cluster detail surface, or extend object detail where the cluster has a
canonical object.

It shows:

- artifact identity and lifecycle
- authority owner
- primary anchors
- evidence associations grouped by role
- direct authoritative updates
- pending approval bundles
- conflicts and ambiguous associations
- related objects, board items, incidents, documents, and calendar events
- source citation quick views
- "Repair/Reconcile" action for manual replay

### Object Detail

Object detail should read Connected Work from reconciliation associations and
outputs. It should not run its own separate relationship discovery logic.

### Boards And Tasks

Board and task surfaces should distinguish:

- provider-owned board/item state
- accepted Timeline board/item state
- pending board membership and item update outputs
- observed evidence that explains why an item appears near a board but has not
  changed board state

Board-local provenance stays separate from object-level provenance.

### Approval Queue

Approval cards should show:

- artifact cluster
- proposed canonical change
- source refs
- authority rationale
- why approval is required
- dependencies inside the bundle
- exact effect of accepting

### Search And Chat

Search and chat should retrieve:

- canonical objects
- summaries
- raw evidence
- reconciliation associations
- pending and accepted outputs when relevant

Chat can use reconciliation clusters as orientation context, but factual
answers still cite source evidence.

### Sources, Connections, And Setup

Connection surfaces should show whether each source is:

- connected and producing raw events
- normalized into reconciliation evidence
- covered by deterministic evals
- covered by live smoke evals
- failing normalization, replay, or authority checks

Setup docs and connection UI should not advertise a source as
reconciliation-ready until those states are true.

### Timeline As MCP Server

Outbound MCP must expose only accepted team-visible state and cited
team-visible evidence. It should not expose private evidence, unresolved
specific-user associations, raw pending proposals, or eval artifacts. Bearer-key
access stays team-scoped and must respect the same visibility floor used by
search and chat.

### Admin And Observability

Add an internal reconciliation dashboard:

- queue depth
- failed runs
- conflicts
- outputs by kind
- direct writes by provider
- approval acceptance/rejection rate
- eval pass rate
- top no-action reasons
- providers with high ambiguity

## Migration Plan

This plan intentionally removes legacy half-paths.

### Phase 1: Schema And Library Foundation

1. Add reconciliation schema:
   - `reconciliation_evidence`
   - `reconciliation_evidence_anchors`
   - `artifact_evidence_associations`
   - `reconciliation_runs`
   - `reconciliation_outputs`
   - `reconciliation_projection_outbox`
2. Add `packages/shared/src/reconciliation`.
   - Exported today as `@timeline/shared/reconciliation` for source-ref
     validation, visibility-floor checks, dedupe-key builders, cluster-kind
     constants, and deterministic eval scoring.
   - `@timeline/shared/reconciliation/authority` exports the field-scoped
     authority policy and serializes authority decisions for reconciliation
     outputs.
   - `@timeline/shared/reconciliation/planner` exports the structured planner
     schema, prompt builder, and model-call wrapper used by live evals and later
     worker planning flows.
   - `@timeline/shared/reconciliation/normalization` exports the raw-event and
     integration-event normalizers.
   - `@timeline/shared/reconciliation/resolver` exports the anchor-based
     evidence association resolver.
3. Add typed interfaces.
   - Phase 1 exports `VisibilityEnvelope`, `SourceRef`, source-ref validation
     results, replay-safe dedupe inputs, deterministic eval case/result types,
     artifact-cluster kind constants, and resolver input/result types.
   - Phase 4 exports the first planner-facing result interface for scenario,
     ingestion-surface, output-kind, direct-write surface, source-ref, and
     privacy-risk classification. Later phases add broader interfaces such as
     `EvidencePacket`, `ClusterResolution`, `ReconciliationPlan`,
     `ReconciliationOutput`, and `AuthorityDecision` as those modules move from
     plan to code.
4. Add source-ref validation.
   - Phase 1 validation is shared by reconciliation scoring/tests and the
     exported reconciliation package.
   - Suggestions now validate source refs during approval projection creation
     and repair; later phases wire the same validation into summaries, chat, and
     other source-ref consumers instead of accepting legacy single-event
     provenance.
5. Add replay-safe dedupe keys and unique constraints for evidence, anchors,
   associations, runs, and outputs.
6. Add payload snapshot storage/ref support for provider/webhook/email/MCP
   sources that cannot be replayed from `raw_events` alone.
7. Add the visibility envelope fields and helpers shared by evidence,
   associations, outputs, approval projections, search, chat, and outbound MCP.
8. Add dedicated `artifact_cluster_kind`; do not couple cluster kind to
   canonical object `entity_type`.

Exit criteria:

- Existing tests pass.
- New schema has team-scoped indexes, uniqueness, and visibility indexes.
- Every new reconciliation row shape includes the required dedupe key and
  visibility envelope where applicable.
- No application behavior changes yet except writing shadow evidence rows.

### Phase 2: Source Normalization

1. Update integration event writer to write reconciliation evidence and anchors.
2. Update source writers to persist `source_payload_ref` before lossy
   normalization.
3. Replace `objectMap` direct object upsert with evidence hints.
4. Normalize email, Slack, Telegram, meetings, documents, calendar, and ingest
   webhooks.
5. Normalize web notes, voice/audio transcripts, MCP-derived evidence, and
   system object/approval events.
6. Add backfill scripts to build reconciliation evidence for existing raw
   events. The current operator entrypoint is
   `pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid>
   --mode=backfill [--source=<event_source>] [--limit=N] [--page-size=N]
   [--dry-run] [--all]`.
   Default backfills are missing-only; `--all` is reserved for intentional
   replay after a normalizer version change.
7. Add coverage audit for raw events missing normalized evidence or payload
   snapshots. The current entrypoint is
   `pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid>
   --mode=audit [--source=<event_source>] [--limit=N] [--page-size=N]`; it
   reports missing, full-replay, and replay-degraded rows by source.

Exit criteria:

- Every new raw event source writes or enqueues normalized evidence.
- Email, Slack, Telegram, document, calendar, meeting-finalization, system
  object-event, integration, and ingest-webhook writers have direct regression
  tests for normalized evidence rows.
- Every lossy source writes immutable payload snapshots or is marked
  replay-degraded.
- Every ingestion surface in the coverage matrix has a normalizer contract,
  deterministic fixture, and live smoke case.
- Existing provider `objectMap` behavior is still shadow-compared but no new
  code depends on it.
- Backfill can reach 100% of eligible historical raw events while preserving
  their visibility envelopes, and reports degraded historical rows separately.
- Coverage audit is a release artifact: if any surface has missing evidence or
  unexpected degraded replay rows, the migration is not considered fully
  rebuildable.

### Phase 3: Artifact Resolution Engine

1. Implement hard and structured anchor matching.
   - Initial resolver is exported as `@timeline/shared/reconciliation/resolver`
     and tested against PGlite.
   - Ambiguous hard-anchor matches emit pending `conflict` reconciliation
     outputs with source refs and visibility floors.
2. Implement AI cluster ranking for ambiguous cases.
3. Migrate `artifact_cluster_members` into
   `artifact_evidence_associations`.
4. Stop writing new `artifact_cluster_members`.
   - The shared artifact evidence helper now writes associations for generic
     raw-event-backed artifact evidence and deliberately skips integration
     object-map events because integration sync already writes its own
     association/output projection rows.
5. Extend conflict outputs beyond resolver ambiguity into stale provider state
   and contradictory lifecycle updates.
6. Add manual cluster association approval flow.
7. Enforce association visibility floors when attaching evidence to clusters.

Exit criteria:

- New evidence attaches to clusters only through reconciliation associations.
- Semantic matches never silently merge.
- Provider-owned clusters win for exact provider identity.
- Mixed-visibility clusters never promote private/specific-user evidence into
  team-visible identity or lifecycle state.

### Phase 4: Planner And Authority Policy

1. Implement authority policy module.
   - Initial field-scoped policy is exported as
     `@timeline/shared/reconciliation/authority` and covered by deterministic
     tests.
   - Integration object-map association/output writes call the shared policy for
     provider-owned direct writes and observed associations.
2. Implement planner structured model calls.
   - Initial planner prompt/schema/model-call wrapper is exported as
     `@timeline/shared/reconciliation/planner` and covered by deterministic
     tests.
   - The live reconciliation eval harness calls the shared planner module, so
     live artifacts exercise the same prompt contract future worker code will
     consume.
3. Emit `reconciliation_outputs` for all direct writes, proposals, observed
   associations, no-actions, and conflicts.
   - Conversation-review no-action outcomes now emit applied `no_action`
     outputs with source refs, source payload refs when present, visibility
     floors, and dedupe keys.
4. Convert integration direct object updates into authoritative outputs only
   where policy allows.
5. Convert conversation suggestion worker to call reconciliation planner.
6. Convert object repair to manual reconciliation replay.
7. Add visibility floors to every emitted output.
8. Generate output dedupe keys from target, operation, source refs, and policy
   version.

Exit criteria:

- No code path creates approval suggestions directly from source evidence.
- No provider code directly upserts Timeline-owned objects.
- Every direct write has an authority decision and source refs.
- Every output has dedupe, source refs, source payload refs when available, and
  a visibility envelope.

### Phase 5: Approval Projection And Application

1. Make `agent_suggestions` a projection of reconciliation outputs.
2. Add output IDs to suggestion metadata.
3. Add the transactional projection/outbox contract for create, accept, reject,
   retry, supersede, and repair flows.
   - Initial implementation writes `reconciliation_projection_outbox` rows for
     approval projection creation, output status transitions, and deterministic
     projection repair from `reconciliation_outputs`.
   - Current synchronous projection rows are marked `processed`; future async
     projection workers consume the same table instead of adding a second queue.
4. Apply accepted suggestions through reconciliation output application.
5. Remove legacy suggestion dedupe keys that are not output-based.
6. Add suppression rules to reconciliation outputs, not worker-specific logic.
7. Refresh object summaries, embeddings, board context, and notifications from
   accepted outputs.

Exit criteria:

- Approval UI behavior is unchanged or better.
- Accept/reject/supersede updates the underlying reconciliation outputs.
- Projection rows can be deleted and rebuilt from reconciliation outputs without
  changing proposal semantics.
- Replays do not recreate rejected exact proposals.

### Phase 6: UI And Observability

1. Add work artifact detail surface.
2. Update object Connected Work to read associations and outputs.
   - Object detail Connected Work now pulls source events from
     `artifact_evidence_associations` when the associated cluster is tied to the
     object, and surfaces pending approval-required `reconciliation_outputs`
     that target or cite the object.
   - Association/output visibility and `visibility_floor` are enforced before
     rows can appear on the object detail surface.
3. Update provenance views to read the new association model.
   - Artifact evidence listing and timeline search now read
     `artifact_evidence_associations` without requiring legacy
     `artifact_cluster_members` rows.
   - Association visibility and `visibility_floor` are enforced during search
     hydration so private/specific-user evidence cannot leak through a
     team-visible source event.
4. Add reconciliation dashboard and run logs.
5. Add manual "Reconcile" action for cluster/object/team scopes.

Exit criteria:

- A user can explain why evidence is attached, what changed, and what needs
  review.
- Operators can diagnose missed objects, extra suggestions, conflicts, and
  provider authority mistakes.

### Phase 7: Evals, Replay, And Cutover

1. Add deterministic reconciliation evals.
2. Add live model eval command.
3. Add redacted live fixture format and artifact output.
4. Add surface and scenario manifests for every coverage-matrix row.
   - Phase 1 has typed manifests exported from
     `@timeline/shared/reconciliation/eval-manifests`; later phases can move
     full fixture payloads into JSON-backed manifests.
5. Add CI/task gate rules for reconciliation changes.
6. Run historical replay against seeded/demo data.
7. Run production-sampling evals during closed beta before broad rollout.
8. Delete old write paths:
   - provider `objectMap` upsert path
   - direct `createSuggestion` use from suggestion worker
   - object repair proposal code that bypasses reconciliation
   - `artifact_cluster_members` application writes
   - direct `sourceEventId`/`source_event_id` canonical provenance writes
   - direct `agentSuggested` canonical provenance writes
   - suggestion payload normalizers that accept `sourceEventId` as the only
     provenance
9. Keep read-only migrations only until the cutover migration completes, then
   remove dead code.
10. Drop or formally deprecate legacy provenance columns once output/source-ref
    backfill verification passes.

Exit criteria:

- No legacy writer remains.
- Legacy single-source provenance is no longer accepted as write input.
- Deterministic, live, and production-sampling evals pass the quality bar for
  every active ingestion surface and scenario family.
- Replay is idempotent.
- `pnpm validate`, `pnpm run doctor`, targeted tests, `pnpm test:eval`, and
  `pnpm test:reconciliation-eval` pass.

## What This Requires

Engineering requirements:

- A new `packages/shared/src/reconciliation` domain package with typed
  boundaries for normalization, packet building, cluster resolution, planning,
  authority decisions, output application, replay, and eval fixtures.
- A dedicated reconciliation worker and queue with idempotent job keys,
  per-cluster locks, retries, run records, and replay controls.
- Source adapters that emit evidence hints instead of directly creating objects
  or suggestions.
- A migration from `artifact_cluster_members` to
  `artifact_evidence_associations`.
- A projection layer that turns reconciliation outputs into approval UI rows.
- A source-ref validator shared by reconciliation, suggestions, summaries, chat,
  and evals.
- A payload snapshot/ref layer for source data that would otherwise be lost
  during normalization.
- A visibility envelope helper used by evidence, associations, outputs,
  approval projections, retrieval, and outbound MCP.
- A transaction/outbox projection layer that keeps approval rows consistent with
  reconciliation outputs.
- Historical backfill and audit scripts for normalized evidence and cluster
  association coverage.
- A live eval runner that can call real models, persist artifacts, and fail the
  build or release gate on privacy, citation, authority, or proposal-quality
  regressions.

Product requirements:

- A work artifact surface or object-detail extension that shows cluster
  evidence, authority, conflicts, and pending outputs.
- Approval UI that explains why each proposed change exists, what accepts will
  write, and why approval is required.
- Operator tooling for failed runs, ambiguous matches, stale outputs, conflicts,
  replay, and provider-specific authority mistakes.
- Clear language separating evidence, observed association, pending proposal,
  accepted memory, and provider-owned state.

Data requirements:

- Stable source identifiers for every provider event that should participate in
  reconciliation.
- Immutable source payload refs for lossy providers and user-generated inputs.
- Team-visible source refs for every team-visible suggestion or direct write.
- Redacted fixture packets for live evals.
- Backfilled anchors for historical raw events where provider metadata is
  strong enough.

## Affected Areas

Database:

- `packages/db/src/schema/raw-events.ts`
- `packages/db/src/schema/facts.ts`
- `packages/db/src/schema/artifact-clusters.ts`
- `packages/db/src/schema/agent-suggestions.ts`
- `packages/db/src/schema/entities.ts`
- source payload snapshot schema/storage refs
- new reconciliation schema files and migrations

Shared packages:

- `packages/shared/src/artifacts/index.ts`
- `packages/shared/src/integrations/event-writer.ts`
- `packages/shared/src/integrations/types.ts`
- `packages/shared/src/suggestions/index.ts`
- `packages/shared/src/objects/index.ts`
- `packages/shared/src/objects/summaries.ts`
- `packages/shared/src/agent/retrieval.ts`
- `packages/shared/src/agent/tools.ts`
- new `packages/shared/src/reconciliation/*`

Workers:

- `apps/worker/src/workers/integrationSync.ts`
- `apps/worker/src/workers/suggestions.ts`
- `apps/worker/src/workers/extract.ts`
- `apps/worker/src/workers/objectSummary.ts`
- meeting/document/calendar workers that create raw events
- new reconciliation worker

Web app:

- approval actions and UI
- object detail Connected Work
- artifact/provenance components
- team integration audit pages
- search and chat context packets
- internal reconciliation dashboard

Docs:

- `README.md`
- `todo.md`
- `design.md`
- setup docs if new eval commands or env vars are added
- ADR for "reconciliation engine owns derived state"

## Non-Negotiable Invariants

- Raw event content is never updated by reconciliation.
- Every query remains team-scoped through `withTeam`.
- Private and specific-user evidence cannot produce team-visible memory.
- Visibility envelopes and floors are preserved on evidence, associations,
  outputs, approval projections, search, chat, and outbound MCP.
- External content is fenced before agent/model exposure.
- Direct writes require a positive authority policy decision.
- Semantic-only evidence never merges clusters without review.
- Approval proposals require valid source refs.
- Approval projection state cannot diverge from reconciliation output state.
- Canonical objects do not rely on legacy `sourceEventId` or `agentSuggested`
  provenance.
- Replays are idempotent and converge.
- Rejected exact proposals stay suppressed.
- Object summaries and chat use derived memory for orientation, but cite source
  evidence for factual claims.

## Definition Of Done

The architecture is complete only when all of these are true:

- Every source that writes `raw_events` also creates or enqueues normalized
  reconciliation evidence.
- Every active ingestion surface has a normalizer contract, deterministic
  fixture coverage, live smoke coverage, replay behavior, and source-ref
  validation.
- Every lossy source has immutable source payload snapshots or is explicitly
  excluded from full replay/eval-fixture guarantees.
- Evidence, associations, outputs, and approval projections carry visibility
  envelopes and enforce visibility floors.
- Evidence, anchors, associations, and outputs have modeled dedupe keys and
  team-scoped unique constraints.
- Clusters use dedicated `artifact_cluster_kind`, not canonical object
  `entity_type`.
- Provider adapters no longer upsert Timeline-owned objects directly.
- The suggestion worker no longer creates approval bundles directly from source
  evidence.
- Object repair is implemented as scoped reconciliation replay.
- Artifact evidence is written through `artifact_evidence_associations`; no
  application writer still writes `artifact_cluster_members`.
- Direct writes are impossible without an authority policy decision.
- Approval UI rows are projections of reconciliation outputs.
- Approval projection changes are transactional with outputs or flow through an
  output-owned durable outbox.
- Rejected exact proposals are suppressed at the reconciliation-output layer.
- Search, chat, summaries, and provenance views all read the same accepted
  associations and source refs.
- Deterministic reconciliation evals pass in CI.
- Live reconciliation evals pass the required quality bar before release.
- Production-sampling evals run during closed beta and convert confirmed misses
  into deterministic fixtures.
- Historical replay converges without duplicate clusters, duplicate proposals,
  or unauthorized memory changes.
- Legacy `sourceEventId`/`source_event_id` and `agentSuggested` provenance write
  paths are removed or read-only compatibility projections pending column
  removal.
- The old writer code is deleted after migration, not left as compatibility
  handling.

## Open Decisions

1. Whether the work artifact detail surface should be a new route
   `/app/work/[clusterId]` or embedded behind objects and boards first.
2. Whether live eval artifacts belong in git when redacted or only in local/CI
   run storage.
3. Whether ingest webhooks can declare field-level authority in v1 or should
   start approval-only until real usage proves safe patterns.

## First Implementation Slice

Build the vertical slice that proves the customer-project problem:

1. Normalize forwarded email, Monday, and Sentry events into reconciliation
   evidence.
2. Resolve one customer project cluster from:
   - email thread IDs
   - customer domains
   - Monday board IDs
   - Sentry project and issue IDs
3. Emit observed associations for all relevant evidence.
4. Let Sentry directly update only Sentry-owned incident lifecycle.
5. Let Monday directly update only Monday-owned board item state.
6. Generate approval bundles for:
   - missing company object
   - missing person object
   - person-company relationship
   - customer-project relationship
   - decision object from email
7. Show the cluster on object detail Connected Work.
8. Add deterministic and live evals for this exact slice.

This slice proves the architecture without preserving the old split-brain
behavior. After it works, migrate the remaining sources through the same
normalizer, resolver, planner, and eval harness.
