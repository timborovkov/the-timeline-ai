# Suggestion and operating memory engine

Timeline preserves selected source evidence, retrieves it under the viewer's visibility, and proposes changes to durable workspace state. This document owns the current processing and authority model. [Domain ownership](architecture/ownership.md) maps code, [ADRs](adr/README.md) explain decisions, [rollout gates](#cross-source-evidence-rollout) control evidence-pack promotion, and [the roadmap](../todo.md) owns unfinished work.

## Source envelope and immutable persistence

Normalize provider input into a source-independent envelope with stable source identity, occurrence time, attribution, visibility and processing class. Persist source-ingested raw content immutably; derive corrections and projections rather than rewriting evidence. Retries use stable identities and preserve chronology. A provider webhook's receipt time is not automatically the upstream action time.

Every read/write enters the scoped workspace boundary. Derived facts, embeddings, proposals, caches and exported records cannot broaden source visibility. An admin is not a private-content bypass. Background processing and synthetic agents obey their narrower principal policies.

## Processing rights

| Signal class | Processing | Authority |
| --- | --- | --- |
| Communication | Extract useful facts; review conversational context for commitments and changes. Intentional notes may be evaluated without a firehose debounce. | May propose, with evidence and appropriate visibility; does not directly mutate canonical state. |
| Captured work | Parse structured lifecycle fields without spending a suggestion model call. Unstructured work records may require extraction. | May propose supported field changes through qualified identity/authority rules. |
| Pulse | Persist, index and associate with an existing artifact where a hard key exists. | Supporting evidence only; no extract/suggestion call and no new task from telemetry alone. |

`signalClass` on the ingest envelope, persisted as `source_metadata.signal_class`, controls these rights. Timeline `event_class` is a presentation taxonomy and cannot substitute for it. Classify the event, not the provider: a judged Drive change is communication, while an old unclassified file-change ping is a pulse. Provider-specific defaults exist only for legacy rows.

Curated documents are reference knowledge, not independent task-originating conversations. Captured files retain source-evidence semantics until explicitly promoted; see [files](captured-files.md). Avoid ingest summarizers whose only purpose is prettier embeddings.

## Identity, artifacts and hubs

Artifact clusters group evidence about source work items. Workspace objects represent the team's accepted operational state. They are not interchangeable and an association does not itself grant mutation authority.

Hard relationships include provider object IDs, canonical URLs, aliases, explicit references and human-curated links. Conversation proposals attach existing company/project hubs only through unique name mentions or container labels. Semantic search and recency recall candidates; they do not qualify a write. Ambiguous identity must remain unresolved rather than choosing the highest similarity.

Hub roles distinguish goals, tracked work, findings and mentions. Incidental mentions and automated findings stay supporting context on the parent work item; do not mint tasks for every entity. Priority remains the existing task field, not a second numeric importance score.

## Evidence packs

A shared bounded builder can assemble answer/proposal evidence with consumer-specific admission rules, deterministic ranking, citation identities and visibility checks. Answer retrieval may use broader semantic recall. Proposal admission requires a qualifying relationship, not semantic relevance alone, and preserves the approval source's visibility floor.

Do not assume all proposal adapters use packs. The builder is implemented with a default-off proposal rollout; generic-webhook modes and the remaining conversation adapters have separate gates. [Evidence rollout](#cross-source-evidence-rollout) is the sole owner of mode semantics, bounds, thresholds, samples and approved copy. Curated chunks and pulses can only support appropriately related proposals when their adapter is admitted.

Exact source citations must survive generation, revision and approval. If a required source becomes inaccessible, the proposal is stale; a cached excerpt is not renewed authorization. Pack failure may degrade only according to the selected mode's explicit policy, never silently widen access or invent support.

## Proposal lifecycle

Conversation reviews collect bounded related messages and propose concrete changes. A single firehose message is not automatically a task; intentional captures can be evaluated directly. Proposals preserve original evidence, source time and source-specific authority.

Pending proposals are living review objects: supported refinements amend or supersede the pending change rather than creating duplicate approvals. Preserve accumulated evidence, avoid guessed identity and distinguish a changed time from a different event. Accepted records are not silently rewritten when a later event arrives; propose another change or use the authorized repair path.

Captured-work matching joins on the source's durable ID, alias or unique `repo#number`. GitHub/Linear/Monday lifecycle changes can coalesce task status/assignee proposals without a suggestion-model call. Match an existing canonical or pending identity before creating another object. Source actor mapping must resolve to a permitted Timeline member; absence is not permission to guess an assignee.

A later outcome can propose completion only when the related evidence uniquely identifies the work. Multiple plausible open tasks must not be collapsed into a guessed done state. Provider-owned fields and human-owned fields keep their separate rules. Relationship proposals may use bundle-local references for objects created in the same approval bundle.

### Authority matrix

| Field | Authoritative without Timeline approval | Needs a proposal |
| --- | --- | --- |
| Provider cluster status for the object the provider owns | That provider, via `objectMap` / reconciliation | — |
| Timeline task / follow_up / deal / incident status | Human edit | Communication review or captured-work matcher |
| Timeline assignee / owner | Human edit | Matcher may fill **empty** slots from a mapped actor |
| Timeline due date | Human edit | Communication review; GitHub does not set due |
| Aliases / external ids on a Timeline task | Human edit | Matcher may merge provider aliases after a qualified match |
| New Timeline object | Human create | Communication / unstructured captured-work proposal, or a qualified merged-PR task proposal |
| Pulse-only telemetry | Never writes Timeline fields | May attach as related evidence |
| Timeline `priority` 1–4 | Human edit | Communication review should propose it on goals and tracked work when urgency is in evidence |
| New Timeline object from a finding or one-off mention | Never | Stay on the parent hub or as fact text |

Generic ingest webhooks are evidence-only
([ADR 0009](./adr/0009-ingest-webhooks-are-evidence-only.md)). Hosted MCP
`timeline.remember` stores agent notes through that same path.

## Approval and durable state

Authorized acceptance applies the supported change atomically with its provenance and audit history. Side effects use the outer transaction's after-commit collector: a released savepoint is not a committed transaction. Rejection does not erase the original source. Idempotent replay cannot reapply a completed mutation or lose a required retry.

Objects, boards and calendar have distinct semantics. Boards have explicit curated membership. Calendar changes require a concrete timed range or all-day date span; vague future work is not a placeholder meeting. Task category is reversible derived classification, not lifecycle state or evidence. Their focused references own field-level rules.

## Retrieval, summaries and communication

Retrieve through scoped source adapters. Keep objects, tasks, notes, boards, document chunks, transcripts and calendar context typed alongside raw evidence. Revalidate access when expanding a reference. A source failure is partial/unavailable retrieval, not proof that no evidence exists.

Embeddings are a recall index, not authoritative storage. Preserve source references and update/delete indexed representations through their owning lifecycle. Context budgets and rate limits bound model work; high-volume structured integrations should not run extraction just because they arrived through a familiar provider.

Summaries, answers and digests cite supporting evidence and distinguish accepted state from proposed state. They cannot turn a mention into a promise or extrapolate a missing date. Use the shared surface presentation policy for web, external chat and outbound MCP; source attribution must survive compact formatting.

## Storage and lifecycle

PostgreSQL holds canonical records, immutable sources, provenance, approvals and job state. Object storage holds source bytes and bounded transient extraction artifacts; Qdrant holds scoped vectors. Redis owns bounded queue/cache/admission state. No store independently widens authority.

[Drive lifecycle](architecture/drive.md) owns revision/snapshot/selection behavior; [extraction operations](runbooks/document-extract.md) owns sandbox isolation and cleanup; [billing](architecture/billing.md) owns admission and settlement; [security](security-privacy-trust.md) owns retention and deletion. These are linked contracts rather than parallel descriptions here.

## Website scans

[Website sources](websites.md) owns persistent configuration, scan admission, schedules and version promotion, including first-run scans. Firecrawl captures up to five public same-origin pages after permission confirmation; failures do not fall back to an in-house fetcher. Captures are team-visible cited web events and versioned Markdown documents. Extraction and suggestions use the existing pipelines; canonical changes require approval.

New scans reserve up to 100 accepted-source units and settle 20 units per captured page once, including unchanged pages. Legacy jobs retain their original multiplier. Immutable `website_sources` snapshots let retries reuse identical bytes. Current retrieval favours ready page versions while historical citations remain accessible.

[Local setup](setup/local.md) and [Railway](railway.md#environment-variables) own credentials; [live evaluation](testing/README.md#live-website-scan) owns verification. [Provider controls](providers.md) and [support deletion](setup/manual-support-deletion.md) cover retention and erasure.

## Read-time freshness and disagreements

Timeline and document semantic searches share bounded freshness ranking. `ranking`
accepts `auto`, `relevance`, or `balanced`. Auto balances ordinary searches and
preserves relevance for historical ranges and exact-source inspection. Balanced
search considers at most 200 semantic candidates, hydrates visibility and dates,
deduplicates, ranks, then paginates. Candidate-limit metadata describes bounded
recall, not an exhaustive search. Semantic `score` stays unchanged; separate
ranking metadata records the boost, effective date/basis, and ranking clock.

Source-date freshness contributes at most 0.05 with a 30-day half-life. Uploads
without trustworthy source dates and website observations receive at most 0.01.
Missing, invalid and future dates receive no boost. Telegram/Slack message time,
email occurrence, meeting evidence, and integration action time remain distinct
from ingestion and indexing time. Captured attachments resolve visible parent-event
provenance before falling back to upload time. Re-embedding never renews evidence age.
Historical/exact reads remain available; internal semantic pagination must use
relevance explicitly. No ranking score qualifies a canonical write.

Answer tools enrich event/document matches with bounded conversation evidence,
current objects and pending proposals through scoped reads. Identity comes from
explicit object IDs or SQL-hydrated source associations, never a semantic top
match or an unverified vector payload. At most five objects and five relevant
pending items per object are included. Bundles are filtered to relevant pending
items before truncation. Adapter failures and truncation are disclosed.

Current records, raw claims, and pending changes are distinct. Pending proposals
remain noncanonical; rejected changes do not erase source history. Source-specific
answers attribute the source, historical answers respect the requested period,
and unresolved contradictions retain both citations without an invented resolution.
Conversation context expands at most five matched moments through scoped lookups
(up to 40 events per moment and 100 events overall), preserving chronology. The
answer pack admits at most 24 core events; omitted expansion is reported as
truncated. Optional replies without text are excluded without weakening anchor
validation. Only
visibility-validated source IDs become evidence anchors. Board-item proposals retain
their exact object association and separate current board values. Later manual
document versions do not inherit a promoted attachment’s original message provenance.
Unrelated newer messages do not override a record. Existing provider/human authority rules remain authoritative. Retrieval
cannot guarantee that every contradictory source was found.

Customer explanations live in Help → Capture and the How it works FAQ; both must
remain consistent with this contract and verified release behaviour.

## Suggestion engine implementation map

The engine has several cooperating processors, not one model that periodically
rewrites the workspace. Trace a missing result through these boundaries in order:

| Stage | Implementation | Observable result |
| --- | --- | --- |
| Capture and classification | `integrations/event-writer.ts`, `integrations/signal-class.ts` | Immutable raw event, signal class, provider identity and occurrence time |
| Extraction | Worker `extract.ts`, shared `extract/` | Facts and mentions; these are evidence, not accepted objects |
| Conversation scheduling | Shared `conversation-review/`, worker `suggestions.ts` | A bounded review window for Slack/Telegram rather than independent message guesses |
| Candidate recall and qualification | Shared `suggestions/hub-context.ts`, `suggestions/linked-hubs.ts` | Existing hubs and work recalled into context; unique supported attachments |
| Proposal generation | Worker `suggestions.ts` | Typed create/update/relationship/note/calendar items with supporting evidence |
| Structured completion | `integrations/github-task-proposals.ts` | Approval-backed lifecycle/assignee updates and qualified merged-PR task proposals |
| Persistence and acceptance | Shared `suggestions/index.ts`, `reconciliation/` | Pending projections; atomic accepted canonical writes and provenance |
| Cleanup | `processObjectCleanupJob` in worker `suggestions.ts` | Merge/archive/relationship suggestions, not automatic destructive merges |
| Object explanations | `objects/summaries.ts`, worker `objectSummary.ts` | Cited cached summary with explicit pending/ready/stale/failed state |

Paths without an `apps/` prefix above are under `packages/shared/src`; workers
are under `apps/worker/src/workers`. The public workspace boundary remains
`withTeam`. A background principal does not obtain access to private evidence by
being an administrator or service worker.

### Project identity and associations

A project is a bounded initiative with a distinguishable purpose. A company is a
counterparty, not a project. Tasks belong to projects through a child relationship;
company associations are separate related-object relationships. Giving a task a
company UUID as `parentObjectId` is invalid.

The proposal path recalls at most 500 active, unmerged objects and supplies a
smaller prompt selection. Recency is a recall heuristic, not evidence of identity.
Explicit full names and aliases take precedence over broad shared-word matches.
An alias shared by sibling projects cannot disambiguate them; a company-only alias
cannot resolve a mixed-client context. If two full project identities are named,
the engine must not choose one merely because it is more recent.

For example, when both “Northstar portal” and “Northstar website redesign” exist,
“for Northstar portal” can identify the former. “For Northstar” alone does not
identify either. Calendar-linked hubs can provide inherited context under their
existing scope rules. Repository, board and channel labels can qualify context,
but a semantic nearest neighbour alone cannot authorize an attachment.

A task proposal can specify an existing `parentObjectId` or a new
`createProjectName`. Acceptance rechecks exact project names and aliases, rejects
ambiguous matches, and records a newly created project's provenance. These checks
do not provide multilingual concept resolution. “Customer portal” and a Finnish
translation require supported aliases or a reviewed identity resolution; shared
customer identity alone does not establish that their scopes are identical.

Generic project labels such as “software platform” are low-signal and are filtered
from inferred creates and considered by cleanup. Concrete scopes such as “partner
portal” remain eligible. Name filtering is deliberately conservative: it is not a
substitute for learning a project's purpose and maintaining reviewed aliases.

Identity resolution is shared by incoming proposals, document review and cleanup.
`identity-resolution.ts` handles exact names, approved aliases and provider identity,
retains Unicode distinctions, rejects conflicting company/repository scope, and
returns existing, new or ambiguous. First names and substring similarity are not
sufficient identity evidence. Identity uncertainty alone does not discard an evidence-backed proposal. Ambiguous
creates remain low-confidence review items with named candidate interpretations.
If exactly one candidate matches the proposed type and exact canonical name, the
proposal explicitly offers an update to that object, without adding aliases or
merging identities. Otherwise it explicitly proposes a separate object. Dependent
relationships and identity facets retain their local references. Reviewers can
accept the stated interpretation, reject it, or revise the separate-object proposal;
this is not an automatic identity choice or a candidate-selection UI.

Candidate retrieval combines exact/alias lookup, shared source/company context and
team-filtered semantic search over both object summaries and entity vectors. Missing
summaries therefore do not remove objects from semantic recall. Retrieval is bounded
(40 contextual candidates and 20 vector hits); it is not an exhaustive all-pairs
comparison. Without configured vectors, lexical and source-context recall remains
available, with lower multilingual recall.

`semantic-identity.ts` adjudicates translated names against team-visible source
statements. It validates quotations against captured source text, not extracted fact paraphrases.
Source context is bounded to 48,000 characters overall and 6,000 per entry, with
the incoming subject first. It requires supported scope for both objects and exact source quotations;
shared customers, meetings or repository context alone do not establish identity.
Validated citations accompany merge/update approvals. `IDENTITY_SEMANTIC_ENABLED`
controls paid semantic adjudication and historical factual repair; it defaults on.
Offline regression tests explicitly disable it, while live evaluations enable it.

Company affiliation is separate from project membership. An approved person email
facet, or an explicitly quoted email in a proposed facet, can support a relationship
to a uniquely matching company business domain. Public/common disposable domains
are excluded; conflicting company matches remain unresolved. The exclusion list is
conservative, not a complete global mailbox-provider registry. Relationships remain
approval-backed. New person proposals can use a local reference for their separate
email-facet proposal; approval resolves it only after the person exists.

### GitHub completed work

Structured integration events bypass the suggestion model. The captured-work
matcher first looks for existing tasks and pending task creates using provider
identity, aliases and qualified repository references. It proposes completion and
fills an empty assignee only when source attribution maps to one team member.
Comments, reviews and CI pulses cannot originate work just because their text
mentions a change.

For a merged pull request with no plausible existing or pending task, the matcher
can propose a new task with `status=done` when its repository identifies one active
project. The human title stays separate from provider aliases; the PR event is
attached as evidence. Creation remains pending approval. A closed, unmerged PR is
not completed work. Private events, ambiguous project identities and saturated
candidate scans cannot take this creation path. Replay uses the same proposal
identity, and accepted completed tasks prevent another create.

A repository-to-project association is still required. The engine must not invent
a new project for every repository, nor assume every similarly named repository
belongs to the same customer initiative. Explicit project aliases are useful when
a repository's name differs from the team's project vocabulary.

### Fields, lifecycle and chronology

The model receives workspace time, team members, existing objects and bounded
source context. Task payloads support priority 1–4, owner, assignee and `dueAt`.
These are optional because missing evidence must not become a guessed owner or
deadline. Priority is not a confidence score. Source actor, addressee, capture owner
and integration connector are distinct identities.

A source deadline must populate the task's `dueAt`, not only produce a calendar
entry. Relative dates resolve from source occurrence time and workspace timezone.
An assignee ID must identify an available member; unresolved named people should
remain named evidence rather than an arbitrary member assignment.

The source window must be interpreted in order. Work introduced and conclusively
finished in one meeting should yield its final supported state. “After QA, mark it
done” is conditional and does not mean QA has happened. “I think it is done” is
uncertain. A later deliverable may support completion when it uniquely identifies
one open item. Several plausible tasks require disambiguation, not a guessed done.

Current UI status vocabularies are type-specific:

| Object type | Lifecycle |
| --- | --- |
| Task | suggested, todo, doing, done, blocked, cancelled |
| Follow-up | todo, doing, done, cancelled |
| Project | planning, active, on_hold, shipped, cancelled |
| Decision | draft, proposed, accepted, rejected |
| Person / company | active, archived |
| Deal | open, qualified, proposal, won, lost |
| Incident | open, mitigated, resolved, postmortem |
| Hiring loop | sourcing, interviewing, offer, hired, closed |

The UI retains an existing unfamiliar value rather than silently rewriting it.
This does not certify historical rows as valid. Status repair must distinguish a
vocabulary migration from a factual lifecycle change and preserve approval and
human-edit authority. A task's completion does not imply its whole project shipped.

### Cleanup scheduling and limitations

`scheduleObjectCleanupSuggestions` registers `object-cleanup-daily` at `0 3 * * *`.
The job targets active workspaces and creates reviewable cleanup proposals. Source
code registration is not evidence that a deployed scheduler is healthy: inspect
its registered next run, worker consumption, failures and billing admission.

The global scheduler dispatches attributed per-team jobs so paid model/embedding
calls use each team's billing admission and usage ledger. Each run scans unmerged
objects by stable ID with a source cutoff and durable checkpoint; changes to
`updatedAt` do not skip older objects. Work is bounded to 25 objects per invocation,
with queued continuations and daily recovery. Archived objects are scanned as
identity candidates and are never automatically reactivated. Incoming source and
document proposals exclude archived targets, so a new actionable proposal cannot
be converted into an unusable update to an archived object.
Daily scans choose merge survivors deterministically for each pair; only an explicit
object repair may prefer its selected object as the survivor.

`engine_maintenance_runs` stores run kind, engine version, cursor, examined count,
status, timestamps, proposal counts, billing-operation references and diagnostic metadata.
Inference usage and actual charges remain in the existing billing ledger, joined
through those operation references. Cleanup records its initial
object count; the health surface retains the latest successful cleanup even when
newer document reviews fill the recent-run list. Exclusive renewable leases prevent two
workers from processing the same run concurrently. A failure or billing pause retains
the last successful checkpoint. The reconciliation page exposes recent cleanup and
document-review progress; the approval surface owns review and rejection.

Each active object receives scoped duplicate, relationship and low-signal review.
Person email facets support company affiliation; project/company semantic matches
require source support. Equal project names alone never authorize a cleanup merge;
source-backed semantic equivalence or a stable provider identity is required. Historical factual repair considers up to three recent
associated source events, proposes updates only to the selected object and excludes
fields previously edited by a human. Object-only repair and document chunk review
do not mark an ordinary source event consumed; their maintenance checkpoints are separate.
Structured GitHub completion repair remains in
its dedicated provider path. Summary refresh is requested through the existing
eligibility/billing-aware summary queue.

Rejected duplicate/archive proposals retain stable identities and are not repeated
unchanged. Provider records with distinct external identities stay separate and can
receive relationship proposals. Candidate retrieval and per-object evidence limits
remain deliberately bounded: full scan coverage does not imply perfect semantic
recall. Missing source content or lack of definitive evidence must remain a visible
no-action case rather than a guessed correction.

### Summaries and evidence availability

A summary explains what an object is, its current state, unresolved questions and
conflicts, with source references. It is a derived cache, not a source of authority.
`objectSummaries` stores state and text; `objectSummaryRuns` records attempts.
Auto-refresh is coalesced with a two-minute delay. Missing, pending, stale, failed
and insufficient-evidence states must be distinguishable during diagnosis.

The summary packet admits visible facts, source events, notes, relationships,
linked tasks, changes, approved proposal evidence, artifact evidence and related
curated chunks under its policy. Structured integrations may have artifact evidence
without extracted facts. The object detail's lightweight snapshot is therefore
not allowed to conclude “insufficient memory” until the full summary packet checks
the evidence it omitted. Private associations remain excluded from team summaries,
even if the current viewer owns that private source.

When a task originates from a PR, the captured PR content and evidence association
should explain the delivered change. A PR title is not enough to infer implementation
details absent from the capture. A successful eligibility check does not establish
that the summary worker completed its model request: inspect run status, queue,
retryable errors and credit admission separately.

### Internal Drive uploads versus captured documents

A new internal Drive upload or version extracts immutable chunks, enqueues embeddings
and queues a document suggestion job. The upload UI enables this by default and
supports an opt-out stored with the upload event. Existing team-visible documents
have a **Find objects** action. Explicit review can override the upload opt-out.
Pending, failed or empty extraction cannot be marked as successfully reviewed.
For an upload later shared with the team, review uses its team-visible sharing
event as the timeline anchor and the immutable version/chunks as content evidence.
The original private upload remains private. Missing sharing authority is retryable;
restricting a document during review pauses the run rather than completing it.

Document review uses the same proposal normalization, identity resolver, company
affiliation and acceptance pipeline as incoming events. Client-list rows may originate
company/person profiles and relationships without implying a task commitment.
Document content is untrusted data. Each bundle cites the upload event plus immutable
document-version and chunk IDs, with a source quote; accepting proposals remains
separate from extraction. Document-backed acceptance validates inside the canonical-write
transaction. Proposal reads (including pending context admitted to worker prompts),
reconciliation-output and summary reads revalidate current
document visibility; cached summaries retain all admitted source references for
that check even when the model cites only a subset. Bulk acceptance orders object creates before dependent
email identities and relationships.

Runs are idempotent by document version, extracted chunk generation and engine/model policy, checkpoint each
chunk and resume after failure. Only current team-visible documents originate team
proposals. Acceptance revalidates and locks document evidence, so replacement,
deletion or restricted visibility invalidates pending authority. Document extraction
does not amend unrelated pending tasks without document provenance. Captured source
attachments and external Google Drive changes retain their own event lifecycles.

## Recovery and development reset

Existing recovery and reconciliation tools repair processing and projections. The
`resuggest` CLI retains canonical objects and review history. It is not an object
reset. Production reconstruction, candidate generations, cutover and rollback are
outside the pre-launch scope.

For disposable local development data, use the operator-only command:

```sh
NODE_ENV=development ENGINE_DEV_RESET_ALLOWED=true bun run --filter @timeline/worker reset:objects -- --team=<uuid>
```

The default is a dry run showing affected counts. Stop the development web server
and other non-queue writers, then add `--offline --confirm=<same-team-uuid>` to reset.
The command requires local database, Redis and Qdrant endpoints and refuses hosted
Railway/production environments. No product reconstruction UI is provided.

The workflow acquires exclusive reset ownership, pauses queues, refuses to proceed
while jobs are active, and removes queued target-team work. It removes object/entity,
fact, note and change vectors (including supported legacy model points), then deletes
that team's derived objects, facts, proposals, reconciliation projections and review
state in dependency order. **Development object edits and approval decisions are
lost.** Captured events, document versions/chunks and compatible source vectors stay.

Replay enqueues eligible captured events through extraction/suggestions and current
documents through extraction/document review. Durable checkpoints resume an interrupted
replay; normal workers own proposal idempotency. The command records which queues it
paused so a restarted invocation can restore them without resuming intentionally
paused queues. A completed reset means replay was enqueued, not that inference or
approval has finished. Recovery and reconciliation expose subsequent worker failures.

## Evaluation and operational diagnosis

For approval-backed proposals, useful coverage and missed opportunities are the
primary quality measures. Concrete requests and tentative next steps supported by
source evidence should remain reviewable even when optional fields are unknown.
Use low confidence and explain uncertainty; omit unsupported fields. Precision,
duplicate burden and rejection rates remain diagnostics, not reasons to suppress
all uncertain proposals. Merges, privacy boundaries and canonical-write authority
retain stricter gates.

Review decisions persist item status, resolution time and resolving user, together
with proposal/evidence provenance and reconciliation outcome. Rejected unchanged
proposals remain suppressed. Suppression replay is marked as such and does not
attribute a new review to the worker; the original reviewer remains on the original
review record. Deduplicate by proposal/output identity when building evaluation
samples, rather than treating replay projections as additional feedback.
This is feedback storage, not automatic model training.
Promote representative reviewed outcomes into restricted, human-labeled evaluation
cases; acceptance/rejection alone is not a correctness label. Distinguish incorrect
identity, redundant work and user preference when labeling, and keep customer
content out of committed fixtures and logs.


Evaluate the complete path, not just a prompt response. Use a matrix covering:

- Exact and alias-based projects, siblings sharing a customer, multilingual aliases,
  generic names, old objects beyond recency limits, and ambiguous counterparties.
- Existing, pending and absent GitHub tasks; merged versus closed-unmerged PRs;
  comments/pulses; replay before and after approval; private and cross-team sources.
- Explicit and absent assignees, business and public email domains, urgency,
  absolute and relative deadlines, and contradictory dates.
- New work completed in the same meeting, conditional completion, older completion
  followed by reopening, several plausible tasks, and manual overrides.
- Summary availability with facts, artifact-only evidence, approved creates,
  restricted evidence, missing content and failed worker attempts.
- Cleanup beyond a single scan, repeated/rejected merges, translated names,
  provider identity differences, retries and partial failures.

Deterministic tests verify scope, persistence, idempotency and qualification.
Opt-in live tests verify actual model extraction and end-to-end persisted proposals
using synthetic data and disposable PGlite databases. The messy proposal-engine
suite adds source containers, noisy language, implicit outcomes and optional real
vector recall. The reconciliation live suite separately evaluates planner/judge
behavior. A skipped vector case is not evidence of vector recall quality.

Run commands and required setup are owned by [testing](testing/README.md). Record
live observations with revision, date, model, case outcomes and missing coverage in
[dated evidence](evidence/README.md); do not append pass counts to this architecture.
Use repeated critical scenarios before promoting model/prompt changes. One pass is
not a production quality certificate, and aggregate scores must not hide safety
failures or absent project associations.

For a production complaint, follow one source ID through capture, signal gating,
review scheduling, recalled candidates, model output, qualification, persisted
proposal, acceptance and summary job. Inspect content only within an authorized
team and keep customer material out of committed fixtures, logs and docs. An
anonymized structural reproduction can become a deterministic regression; production
samples and synthetic live-model runs are distinct evidence.

## Cross-source evidence rollout

Proposal packs are implemented behind a default-off switch. Deployment enforcement
and promotion evidence must be verified separately from code availability.

The shared builder, proposal and answer adapters, exact citations, revision
handling, approval UI, and redacted metrics are implemented, but pack-backed
proposals remain disabled by default. Current product copy must describe today's
behavior; present-tense cross-source proposal claims remain gated on each source
path shipping.

## Current state

Timeline accumulates raw events, extracted facts, workspace objects, embeddings,
artifact associations, and reconciliation outputs. The code can build shared
proposal and answer packs. Proposal behavior remains on the legacy path while
`CROSS_SOURCE_EVIDENCE_MODE=off`, which is the default.

| Path | What happens today |
| --- | --- |
| Generic ingest webhooks | `off`: the existing event-local proposal remains unchanged. `shadow`: pack metrics only; pack failures are recorded without interrupting legacy extraction. `enforced`: recent time-only chronology is replaced by the anchor plus directly related pack evidence, and every proposed change requires exact citations. The existing proposal-generation source gate remains an inner gate. |
| Slack, Telegram, email, meetings, and documents | Existing conversation-review and event-local proposal behavior remains unchanged regardless of the global rollout setting. These adapters must migrate and pass their own gates separately. |
| GitHub, Linear, Monday, and Sentry | Classified in [`relational-memory.md`](./relational-memory.md). Structured captured work and pulses persist, embed, and reconcile without the extract or suggestion models. GitHub PR and issue lifecycle fields enqueue a coalesced approval-backed Timeline task `done`/assignee job keyed by `repo#number`; qualified merged PRs can also propose new completed tasks as described above. Comments, reviews, commits, CI, and Sentry events are pulses or communication-lite: they are not proposal sources. Per-connection ingest processing is rate-limited. |
| Agent Ask | Broad workspace retrieval returns a viewer-visible answer-policy pack for raw-event evidence while keeping objects, notes, tasks, boards, documents, and calendar results as typed adjacent context. Semantic matches are labeled as retrieval provenance, pack-only citations are included in the packet's top-level reference index, and partial packets disclose failed source adapters. |

No proposal adapter is considered shipped until its shadow sample, safety,
quality, latency, and operations gates pass and enforcement is enabled for that
deployment.

## Decided target

Answers and proposals will share one bounded evidence-pack primitive with
consumer-specific policies. They share candidate and citation semantics, not
identical admission thresholds.

```text
anchor event or conversation core
              |
              v
same conversation or one-hop hard/object relationships
              |
              v
visibility-safe eligible candidates
              |
              v
deterministic rank, diversity, and budget policy
              |
              v
       typed evidence pack
          /          \
 answer policy      proposal policy
 broader recall     strict admission
```

The proposal policy admits cross-source evidence only through same-conversation
membership or a stable, non-semantic relationship. Qualifying relationships
include canonical artifact associations, provider or external IDs, canonical
URLs and explicit references, and human-curated object links. A model-extracted
fact or entity association may generate a candidate, but it cannot qualify that
candidate by itself.

Semantic relevance ranks already eligible evidence. It never admits evidence
into a proposal pack. Proposal ranking averages the current-model vectors
already stored for visible anchor events, then searches only the directly
qualified candidate IDs through the team-and-viewer Qdrant filter. Missing
stored vectors skip this tie-breaker; they never trigger a new embedding or
model call. Stored-vector lookup follows the anchor raw-event ID across raw,
integration, and calendar-event point scopes, requests capacity for every
eligible point kind, then collapses duplicate points by raw-event ID before
ranking unique candidates. Answer packs may admit
viewer-visible semantic matches, but must label and cite them as retrieved
evidence.

## Product vocabulary

- **Anchor:** One or more immutable raw events that caused the evidence review
- **Core evidence:** The anchor and protected same-conversation events
- **Supporting evidence:** Directly related, visibility-safe events from the same or another surface
- **Surface:** A source family people recognize, such as Slack, email, meetings,
  GitHub, Monday, or one immutable generic-webhook identity; mutable webhook
  names remain display labels only, and legacy webhook rows without IDs collapse
  conservatively into one surface
- **Evidence pack:** A deterministic, bounded build result containing cited events, relationship reasons, ordering, budget results, and policy provenance
- **Proposal audience:** The common audience allowed to see every selected citation and the resulting proposal
- **Consumer policy:** The answer or proposal rules applied to the shared pack builder

A pack is cross-source only when its selected citations span at least two
surfaces. Integration event types from one provider still count as one surface.

## Non-negotiable rules

1. **Team isolation and visibility apply before retrieval, ranking, model input,
   persistence, and display.** The first proposal release remains team-visible
   only. Answer packs remain viewer-scoped.
2. **A pack supplies evidence, not authority.** Inferred Timeline-owned memory
   remains approval-backed. A provider may still update fields it authoritatively
   owns under the existing reconciliation policy.
3. **Raw source content stays immutable.** Derived associations, rankings,
   proposals, and memory may change; captured source content does not.
4. **Proposal relationships are direct and one-hop.** Same time, same sender,
   semantic similarity, and transitive graph paths do not qualify evidence.
5. **Conflicting evidence stays visible.** Newer and authoritative evidence ranks
   higher, but unresolved material conflict produces no durable proposal.
6. **Every proposed item names its evidence.** The model must return exact raw
   event IDs from the supplied pack. Unknown, inaccessible, or empty selections
   invalidate that proposal bundle.
7. **Packs are bounded.** Core evidence is reserved before supporting evidence;
   every omitted or truncated candidate has a recorded reason.
8. **Provider events remain first-class evidence.** They can support a proposal
   even when their own state update bypasses the suggestion model.

## What good looks like

Slack records a commitment to send the Acme deck on Friday. A meeting confirms
Friday end of day. Monday shows the provider-owned work-item status. An email
contains the draft.

Timeline should:

- preserve each capture as independently cited evidence;
- relate only the events with a direct Acme deck relationship;
- let each proposed task, date, or note cite the exact events that support it;
- preserve Monday's authority over its own status field;
- show unresolved conflicts instead of manufacturing confidence; and
- group approvals according to existing target and authority rules, not because
  the events happened to share one pack.

One pack may support several proposal items or reconciliation outputs. A pack
does not imply one atomic update or one approval action.

## Rollout

The implementation order is:

1. Build the shared primitive and prove it on generic ingest webhooks.
2. Migrate Slack and Telegram conversation reviews.
3. Migrate event-local email, meeting, and document proposal paths.
4. Adapt the raw-event portion of Agent Ask while retaining typed workspace
   retrieval for objects, notes, tasks, boards, documents, and calendar state.

Every adapter starts disabled, runs in shadow mode, passes its own fixtures and
negative-link cases, and earns explicit enforcement. An adapter never inherits
readiness from another source path.

Cross-source proposal behavior is shipped for a source path only when:

- enforced mode is enabled for that path;
- the approval interface shows exact per-item multi-source citations;
- visible-but-changed evidence blocks acceptance; inaccessible or tombstoned
  evidence hides the derived proposal and any direct acceptance attempt
  supersedes it;
- proposal persistence and acceptance lock and snapshot-validate every selected
  pack row, revalidate the proposal's full audience, and hold those locks
  through the team-scoped application transaction so competing evidence
  revisions cannot leave two actionable replacements or race a durable write;
  first-time revisions serialize on their base identity, and calendar targets
  serialize before their linked raw evidence to preserve mutation lock order;
  object, task, board-membership, and board-item targets likewise lock before
  selected evidence; board mutations also lock their affected board row, while
  every target-owned object or board-item due-date mirror and every
  evidence-owned calendar event joins the same stable sorted calendar lock set
  so cross-cited mirrors cannot deadlock;
  occurrence-level `series` and `this_and_future` mutations lock the canonical
  recurring parent shared by direct edits and approval acceptance, and direct
  whole-series edits hold that lock until occurrence rematerialization commits;
- the canonical change and accepted approval commit atomically; an application
  error rolls both back before a fresh transaction records a retryable failed
  approval, while indexing and queue follow-ups run only after commit;
- the enforced pack is reserved inside the prompt budget before optional source
  and workspace context;
- deterministic, live, privacy, authority, quality, latency, and cost gates pass;
- rollback monitoring is active; and
- product copy names only the source paths that meet those conditions.

Rollout work is tracked in [the roadmap](../todo.md). The durable rationale is
[ADR 0014](adr/0014-cross-source-evidence-packs-use-policy-bound-related-evidence.md).
This document owns the engine and its rollout contract.

## Website and landing messaging

### Safe before pack-backed proposals ship

- Timeline captures evidence from chat, meetings, email, documents, and work
  systems in one searchable workspace.
- Ask can retrieve cited context across connected sources.
- Durable inferred memory remains reviewable, and provider-owned state keeps its
  source authority.
- Timeline is being built so directly related evidence can support the same
  proposal without losing its source.

### Allowed after a source path ships

- Capture work as it happens. Timeline turns directly related evidence from
  connected tools into cited updates for review.
- When work is discussed in chat, confirmed in a meeting, tracked in a work
  system, and clarified by email, Timeline can connect the evidence and cite it
  under each proposed update.

Copy must name the shipped scope. Do not imply that every proposal, integration,
or historical event already participates.

### Claims to avoid

- Fully automatic customer relationship management or project updates without
  authority checks or approvals
- Every suggestion synthesizes every connected source
- Semantic similarity alone proves that two events describe the same work
- One evidence pack always becomes one approval
- Timeline replaces every tracker or system of record

## Success criteria

The first enforced source path must meet all of these gates:

- 100% deterministic and committed reconciliation fixture passes
- Every live-evaluation case passes its existing judge threshold
- Zero visibility leaks, authority violations, unknown citations, ambiguous
  hard-link proposals, or reviewed false merges
- At least 200 successful, eligible shadow pack builds across seven consecutive
  days and three teams; every eligible attempt carries its own sample time,
  team key, and scenario family, and a failed or incomplete attempt never counts
  toward eligibility
- At least 25 genuinely cross-source shadow packs, with every required scenario
  family represented; telemetry must satisfy surface count ≤ selected count ≤
  candidate count
- One builder version and one proposal-policy version across the qualifying
  population; a version change starts a fresh promotion window
- Disjoint population fingerprints across cumulative sampling reports, derived
  from immutable attempt IDs or legacy immutable attempt provenance rather than
  mutable review annotations; an overlapping report is rejected instead of
  double-counted, and duplicate legacy identities are rejected as ambiguous. A
  single pre-fingerprint legacy aggregate remains loadable and is rewritten
  with the field absent rather than a fabricated empty population, but cannot
  be combined with another health aggregate until its population is traceable
- Loaded aggregate health must preserve the same count relationships as raw
  samples, including cross-source ≤ eligible ≤ total attempts, errors ≤ total,
  error-reason totals and error rate matching the error count, and aggregate
  surface ≤ selected ≤ candidate counts; mode values must be recognized and
  nonzero shadow eligibility requires a shadow population
- No additional embedding or generative-model request solely for proposal-pack
  ranking
- At most 24 protected conversation-core events, 8 supporting events, 4
  supporting events per surface, 500 scanned candidates, and 6,000
  estimated pack tokens
- Pack-build p95 below 1 second and error rate below 1%
- Immediate rollback for any safety violation, or when p95 exceeds 2 seconds or
  errors exceed 2% for 15 minutes

Coverage and source diversity are measured, but multi-source evidence is not
forced. A valid anchor-only or same-source pack remains correct when no related
cross-source evidence qualifies.

## Non-goals for the first implementation

- Semantic-only or transitive proposal joins
- Private or specific-user background proposal packs
- A durable `evidence_packs` database aggregate
- A new model call solely to assemble or rank a pack
- Continuous pack watchers or workspace-wide reranking on approval views
- Replacing typed Agent Ask retrieval with raw-event packs
- Automatic enforcement for a newly added consumer adapter
- Per-provider prompt implementations instead of one shared builder

## Related decisions and roadmap

- [ADR 0004: Conversation reviews drive conversational proposals](./adr/0004-conversation-reviews-drive-conversational-proposals.md)
- [ADR 0005: Workspace reconciliation is artifact-centered and approval-backed](./adr/0005-workspace-reconciliation-is-artifact-centered-and-approval-backed.md)
- [ADR 0009: Generic ingest webhooks are evidence-only capture sources](./adr/0009-ingest-webhooks-are-evidence-only.md)
- [ADR 0010: Artifact provenance is tiered and evidence-backed](./adr/0010-artifact-provenance-is-tiered-and-evidence-backed.md)
- [Cross-source evidence roadmap item](../todo.md)
