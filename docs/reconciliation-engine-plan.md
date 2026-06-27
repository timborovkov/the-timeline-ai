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
- Evals test retrieval and safety, but not whether reconciliation produces the
  desired objects, clusters, suggestions, approvals, and source citations.

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
- `source`
- `provider`
- `external_object_id`
- `external_event_id`
- `event_type`
- `occurred_at`
- `visibility`
- `actor`
- `content_digest`
- `title`
- `summary`
- `source_url`
- `metadata`
- `normalizer_version`
- `created_at`

This row is the stable input for reconciliation. It is derived and replayable.
It can be deleted and rebuilt from `raw_events` plus provider payload metadata.

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
- Add `cluster_kind` if `entity_type` is too narrow for project/account work:
  `customer_project`, `incident`, `deal`, `document`, `decision`, `task`,
  `meeting`, `calendar_event`, `provider_record`, `topic`.
- Add `authority_owner` metadata for provider-owned clusters:
  `{ provider, externalObjectId, stateVocabulary }`.
- Add `last_reconciled_at`, `reconciliation_version`, and `health_status`.
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
- `metadata`
- `created_at`

Current `artifact_cluster_members` can be migrated into this shape and removed
from application code. Do not keep both write paths.

### Reconciliation Runs

Every engine pass records what it considered and what it emitted.

`reconciliation_runs`

- `id`
- `team_id`
- `trigger`: `raw_event | evidence_batch | cluster_replay |
  manual_repair | eval | backfill`
- `scope`: `evidence_id | cluster_id | raw_event_id | team_id`
- `status`: `pending | running | completed | failed | superseded`
- `input_fingerprint`
- `engine_version`
- `model_versions`
- `started_at`
- `completed_at`
- `error_code`
- `metrics`

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
- `dedupe_key`
- `status`: `pending | applied | approval_created | rejected | superseded |
  failed`
- `created_at`

`agent_suggestions` and `agent_suggestion_items` become the approval UI
projection of `reconciliation_outputs`, not a separate proposal source.

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

## Authority Policy

Create a policy module in `packages/shared/src/reconciliation/authority.ts`.

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

Eval cases live behind explicit manifests:

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
- forbidden outputs
- visibility assertions
- model/prompt versions
- minimum score gates

The harness has three modes.

### Deterministic Replay Evals

Runs in CI without external model calls unless explicitly enabled.

- Uses fixture packets under `packages/shared/src/reconciliation/evals/fixtures`.
- Mocks model calls with saved structured outputs.
- Asserts DB state, outputs, approval bundles, citations, and visibility.
- Runs on PGlite like current agent evals.

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

Behavior:

- Loads redacted fixture packets from `evals/reconciliation/live-cases`.
- Calls the real `llm.chatStructured()` pipeline.
- Stores run artifacts in `eval-runs/reconciliation/<timestamp>/`.
- Scores outputs with deterministic assertions plus an AI judge.
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
2. Add `packages/shared/src/reconciliation`.
3. Add typed interfaces:
   - `EvidenceEnvelope`
   - `EvidenceAnchor`
   - `EvidencePacket`
   - `ClusterResolution`
   - `ReconciliationPlan`
   - `ReconciliationOutput`
   - `AuthorityDecision`
4. Add source-ref validation shared by suggestions, summaries, chat, and evals.
5. Add replay-safe dedupe keys for evidence, associations, runs, and outputs.

Exit criteria:

- Existing tests pass.
- New schema has team-scoped indexes and uniqueness.
- No application behavior changes yet except writing shadow evidence rows.

### Phase 2: Source Normalization

1. Update integration event writer to write reconciliation evidence and anchors.
2. Replace `objectMap` direct object upsert with evidence hints.
3. Normalize email, Slack, Telegram, meetings, documents, calendar, and ingest
   webhooks.
4. Normalize web notes, voice/audio transcripts, MCP-derived evidence, and
   system object/approval events.
5. Add backfill scripts to build reconciliation evidence for existing raw
   events.
6. Add coverage audit for raw events missing normalized evidence.

Exit criteria:

- Every new raw event source writes or enqueues normalized evidence.
- Every ingestion surface in the coverage matrix has a normalizer contract,
  deterministic fixture, and live smoke case.
- Existing provider `objectMap` behavior is still shadow-compared but no new
  code depends on it.
- Backfill can reach 100% of eligible historical team-visible raw events.

### Phase 3: Artifact Resolution Engine

1. Implement hard and structured anchor matching.
2. Implement AI cluster ranking for ambiguous cases.
3. Migrate `artifact_cluster_members` into
   `artifact_evidence_associations`.
4. Stop writing new `artifact_cluster_members`.
5. Add conflict outputs for hard-anchor collisions.
6. Add manual cluster association approval flow.

Exit criteria:

- New evidence attaches to clusters only through reconciliation associations.
- Semantic matches never silently merge.
- Provider-owned clusters win for exact provider identity.

### Phase 4: Planner And Authority Policy

1. Implement authority policy module.
2. Implement planner structured model calls.
3. Emit `reconciliation_outputs` for all direct writes, proposals, observed
   associations, no-actions, and conflicts.
4. Convert integration direct object updates into authoritative outputs only
   where policy allows.
5. Convert conversation suggestion worker to call reconciliation planner.
6. Convert object repair to manual reconciliation replay.

Exit criteria:

- No code path creates approval suggestions directly from source evidence.
- No provider code directly upserts Timeline-owned objects.
- Every direct write has an authority decision and source refs.

### Phase 5: Approval Projection And Application

1. Make `agent_suggestions` a projection of reconciliation outputs.
2. Add output IDs to suggestion metadata.
3. Apply accepted suggestions through reconciliation output application.
4. Remove legacy suggestion dedupe keys that are not output-based.
5. Add suppression rules to reconciliation outputs, not worker-specific logic.
6. Refresh object summaries, embeddings, board context, and notifications from
   accepted outputs.

Exit criteria:

- Approval UI behavior is unchanged or better.
- Accept/reject/supersede updates the underlying reconciliation outputs.
- Replays do not recreate rejected exact proposals.

### Phase 6: UI And Observability

1. Add work artifact detail surface.
2. Update object Connected Work to read associations and outputs.
3. Update provenance views to read the new association model.
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
5. Add CI/task gate rules for reconciliation changes.
6. Run historical replay against seeded/demo data.
7. Run production-sampling evals during closed beta before broad rollout.
8. Delete old write paths:
   - provider `objectMap` upsert path
   - direct `createSuggestion` use from suggestion worker
   - object repair proposal code that bypasses reconciliation
   - `artifact_cluster_members` application writes
9. Keep read-only migrations only until the cutover migration completes, then
   remove dead code.

Exit criteria:

- No legacy writer remains.
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
- External content is fenced before agent/model exposure.
- Direct writes require a positive authority policy decision.
- Semantic-only evidence never merges clusters without review.
- Approval proposals require valid source refs.
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
- Provider adapters no longer upsert Timeline-owned objects directly.
- The suggestion worker no longer creates approval bundles directly from source
  evidence.
- Object repair is implemented as scoped reconciliation replay.
- Artifact evidence is written through `artifact_evidence_associations`; no
  application writer still writes `artifact_cluster_members`.
- Direct writes are impossible without an authority policy decision.
- Approval UI rows are projections of reconciliation outputs.
- Rejected exact proposals are suppressed at the reconciliation-output layer.
- Search, chat, summaries, and provenance views all read the same accepted
  associations and source refs.
- Deterministic reconciliation evals pass in CI.
- Live reconciliation evals pass the required quality bar before release.
- Production-sampling evals run during closed beta and convert confirmed misses
  into deterministic fixtures.
- Historical replay converges without duplicate clusters, duplicate proposals,
  or unauthorized memory changes.
- The old writer code is deleted after migration, not left as compatibility
  handling.

## Open Decisions

1. Whether `artifact_clusters.artifact_type` should keep using `entity_type` or
   move to a dedicated `artifact_cluster_kind`.
2. Whether the work artifact detail surface should be a new route
   `/app/work/[clusterId]` or embedded behind objects and boards first.
3. Whether live eval artifacts belong in git when redacted or only in local/CI
   run storage.
4. Whether ingest webhooks can declare field-level authority in v1 or should
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
