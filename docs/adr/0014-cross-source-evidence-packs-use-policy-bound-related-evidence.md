# ADR 0014 — Cross-source evidence packs use policy-bound related evidence

## Status

Accepted.

The decision is implemented behind `CROSS_SOURCE_EVIDENCE_MODE`, which defaults
to `off`. Implementation does not promote any proposal adapter; `shadow` and
`enforced` remain deployment choices gated by the product contract.

## Context

Timeline captures immutable raw events from conversations, meetings, email,
documents, generic webhooks, and native providers. Those events already feed
facts, artifact associations, workspace objects, semantic retrieval, answers,
and approval-backed reconciliation. The proposal paths do not assemble evidence
consistently.

Slack and Telegram proposals use a bounded same-conversation window. Their
entity-linked cross-source context is limited to disambiguation. Email,
meeting, document, and generic-webhook proposals use an anchor event plus recent
chronology and broad workspace context. Native provider events feed artifact
reconciliation without calling the suggestion model. Agent Ask retrieves across
sources, but its query-oriented workspace packet is not a proposal evidence
contract.

Allowing every consumer to invent its own retrieval would duplicate visibility,
relationship, ranking, citation, and budget behavior. Allowing semantic search
to join proposal evidence directly would let a weak similarity signal validate
a durable change. Persisting every candidate set as a new aggregate would add a
lifecycle that existing immutable evidence, suggestion evidence, reconciliation
source references, and run metrics can already audit.

ADRs 0003, 0004, 0005, 0009, and 0010 already establish the surrounding
constraints: inferred memory is approval-backed, conversation proposals require
strong relationships, reconciliation preserves provider authority, generic
webhooks are evidence-only, and artifact provenance is durable and tiered.

## Decision

Timeline will use one shared, deterministic evidence-pack builder for raw-event
evidence. The builder has consumer policies for `proposal` and `answer` use.
Typed object, note, task, board, document, and calendar retrieval remains
adjacent workspace context rather than being relabeled as raw-event evidence.

An evidence pack is a bounded build result, not a new durable database
aggregate. Its input contains one or more anchor raw-event IDs, an authenticated
team and viewer scope, a consumer policy, and optional conversation, object, or
artifact-cluster anchors. Its output contains:

- protected core events and ranked supporting events;
- the normalized surface and immutable raw-event reference for each item;
- fenced sender identity context for first-person attribution;
- relationship provenance and deterministic rank reasons;
- visibility and audience information;
- policy, builder, and budget versions;
- a stable fingerprint over build inputs and the selected model-visible
  evidence state, including the full normalized content fingerprint and
  occurrence time even when displayed content is truncated; and
- candidate, selection, source-diversity, truncation, token, and latency metrics.

Candidate discovery fetches a bounded unique set and records an explicit
`candidate_limit` omission count when qualifying evidence exists beyond that
bound. Both answer and proposal consumers receive fenced sender context for
each row so first-person statements retain their speaker.

### Proposal admission

Proposal packs admit an event only when it is core evidence or has a direct,
one-hop, non-semantic relationship to the anchor or core.

Qualifying relationships are:

- same-conversation membership;
- an unambiguous canonical artifact or object association;
- a provider or external object ID;
- a canonical URL or explicit source reference; or
- a human-curated object relationship.

A model-extracted fact or entity association can generate a candidate but
cannot qualify cross-source proposal evidence by itself. Same sender, nearby
time, lexical overlap, semantic similarity, and transitive graph paths do not
qualify an event.

Semantic relevance may rank candidates after they qualify. Proposal building
uses an existing stored anchor vector when available. If no stored vector is
available, it skips semantic ranking instead of making a new embedding request.
Answer packs may admit viewer-visible semantic matches because answers do not
change durable state, but their citations retain the retrieval provenance.

### Visibility and authority

Candidate discovery, hydration, ranking, model input, persistence, and display
all use team- and viewer-scoped access. Qdrant filtering does not replace
Postgres visibility hydration. The first proposal implementation accepts only
team-visible evidence. Answer packs remain viewer-scoped.
Private answer evidence preserves both users authorized by raw-event semantics
when the explicit visibility owner differs from the event author; pack audience
intersection must not discard a viewer who can read every selected row.

The pack never grants write authority. It only supplies evidence. Timeline-owned
inferred memory remains human-gated. Provider-owned lifecycle and field updates
may remain direct when the existing field-scoped reconciliation policy grants
that provider authority. Generic webhook evidence never becomes authoritative.

One pack can support several proposal items and reconciliation outputs. Pack
membership does not make those effects atomic, combine their authority, or
require one approval action.

### Ordering and bounds

Proposal ordering is deterministic:

1. protected core status;
2. relationship provenance;
3. authoritative-source strength;
4. recency;
5. source diversity;
6. semantic relevance when a stored vector is available;
7. occurrence time and raw-event ID as stable tie-breakers.

The initial proposal policy reserves up to 24 conversation-core events, admits
up to 8 supporting events and 4 supporting events per surface,
scans no more than 500 eligible candidates, and reserves no more than 6,000
estimated input tokens inside the existing suggestion prompt budget. Core
evidence is allocated before supporting evidence. The result records every
truncation and omission reason. A supporting candidate that does not fit the
remaining token budget is omitted without ending selection; lower-ranked
candidates remain eligible when they fit the remaining budget.

In enforced mode, the rendered pack is a required prompt section. The prompt
assembler reserves its complete token cost before allocating the optional
current-event, related-context, and workspace sections, so an oversized source
event cannot truncate the pack out of the model input.

Hard object relationships have no global age cutoff. The bounded candidate
pool applies relationship strength, authority, and recency before its unique
event candidate limit. Multiple associations to one admitted event retain all
relationship signals, including any weaker authoritative signal, before the
full ranking and diversity policy control selection.
Same-conversation core retains its existing two-day window.

### Citations and proposal lifecycle

Every pack-backed proposal item must return one or more exact raw-event IDs from
the supplied pack. The worker rejects a bundle with unknown, inaccessible, or
empty item citations. Enforced mode does not fall back to post-hoc lexical quote
matching.

The suggestion stores every selected pack row in the existing bundle evidence
rows, including selected rows that no returned item cites. Each item stores its
cited IDs in metadata, and its
reconciliation output `sourceRefs` is the authoritative per-item citation set.
The suggestion and reconciliation run store the pack version, policy version,
fingerprint, metrics, and truncation state. This does not require a new table.
Each selected pack row also carries a content-and-occurrence snapshot
fingerprint. Persistence locks and revalidates the activity, viewer visibility,
and snapshot of every selected raw-event row in the proposal transaction before
writing any derived state. It retries the proposal when mutable calendar
evidence changes while the model is running.

A rebuild that changes the fingerprint creates a new proposal revision and
supersedes the old item and output. It does not append evidence to an old
proposal and call the accumulated set current. Revision creation takes a
transaction-scoped lock on the team and base dedupe identity before it re-reads
candidate revisions, including the first revision where no predecessor row can
be locked. Display and acceptance revalidate every selected pack row, including
supporting rows that no item cites. A
proposal with deleted, tombstoned, or newly
inaccessible required evidence is hidden because its derived fields may contain
source details; any direct acceptance attempt supersedes it and requires a
rebuild.
Acceptance also revalidates that every row still supports the proposal's full
projection audience, not only the accepting actor. Pack-backed application runs
inside the same team-scoped transaction that locks those evidence rows, so a
calendar refresh, tombstone, or visibility change cannot race between the final
check and the durable workspace mutation.

All source-controlled display fields rendered into model prompts, including
surface labels derived from integration or ingest-webhook metadata, use the
same external-content trust boundary as evidence text and sender context.

The builder has no continuous watcher. Existing suggestion,
conversation-review, and reconciliation triggers build new packs as qualifying
evidence arrives. Approval page views revalidate selected evidence but do not
rerank the workspace.

### Conflicts and failures

Eligible evidence can support, refine, supersede, or contradict the anchor.
The builder does not hide contrary evidence. Newer and authoritative evidence
ranks higher, and the proposal model must produce no durable proposal when a
material conflict remains unresolved.

Enforced proposal building fails closed when an adapter, visibility hydration,
citation validation, or required retrieval step fails. It records a
content-free reason and uses the existing worker retry policy. Shadow mode
records the failure but preserves legacy extraction because it must not change
proposal availability. Answer consumers may continue with available evidence
only when they disclose the missing source.

Operational logs and metrics may contain IDs, counts, surfaces, relationship
categories, ranks, token estimates, latency, truncation reasons, fingerprints,
and outcome codes. They must not contain evidence text, excerpts, private
identifiers, or provider payloads.

### Rollout

A server-side `CROSS_SOURCE_EVIDENCE_MODE` setting controls `off`, `shadow`, and
`enforced` behavior and defaults to `off`. Shadow mode builds and measures packs
without changing model input or creating pack-derived output. Its fingerprint
is telemetry only and never enters the metadata field that activates proposal
revision handling. Enforced mode uses the pack. The generic webhook's existing
proposal-generation setting remains an inner source gate. Changing the global
mode requires a worker restart or redeploy.

The first rollout is environment-scoped and starts with generic ingest
webhooks. Later milestones cover conversation reviews, other event-local paths,
and Agent Ask. Every adapter has its own fixtures, negative-link tests,
visibility tests, shadow evidence, and explicit enforcement gate.
Promotion evidence must contain exactly one builder version and one policy
version within the shadow population; `off` and `enforced` samples do not affect
that version gate. Changing either version requires a fresh qualifying shadow
population. An explicitly supplied empty telemetry export is still assessed
and fails the shadow-population gates.
Sampling reports retain a content-free latency distribution so merged reports
recompute cumulative p50, p95, and p99 values instead of merging percentiles.
They also retain stable content-free population fingerprints derived from an
immutable attempt ID, with immutable attempt provenance as the legacy fallback,
and reject report merges with overlapping population identities. Mutable review
outcomes, eligibility labels, and error annotations do not change that identity,
while ambiguous duplicate legacy identities are rejected rather than counted as
separate attempts. Cumulative reports therefore cannot double-count historical
attempts. A shadow attempt must also complete without an error before it counts
as eligible, and reported pack counts must satisfy surface count ≤ selected
count ≤ candidate count. Dashboard persistence goes through the named team reconciliation
scope, including the CLI's explicit trusted internal-user path.
Reports without evidence-pack telemetry omit pack health and promotion state.

## Consequences

Proposal citations become model-selected and item-specific instead of being
inferred after generation from lexical overlap. Evidence ranking becomes
repeatable and observable. Provider state can support Timeline-owned proposals
without losing its own authority model.

When mutable evidence changes a pack fingerprint, Timeline locks the expected
actionable predecessor items, creates the replacement approval, and supersedes
its predecessor in one transaction. A competing revision aborts when that
predecessor set has already changed. A failed replacement therefore leaves the
prior actionable approval intact, and concurrent rebuilds cannot leave two
actionable replacements. A base-identity advisory lock also serializes two
first-time builders before either predecessor exists.

The first implementation adds a shared module, consumer adapters, stricter
model output validation, proposal revision behavior, per-item evidence display,
and rollout telemetry. A data migration upgrades existing unambiguous
canonical-URL shared-link associations from semantic model candidates to hard
anchors and removes a legacy duplicate when the hard association already
exists. The implementation does not require a durable pack lifecycle, a new
model call, or private background proposals.

Pack-backed acceptance commits the approval and its canonical mutation in the
same transaction while the selected evidence rows remain locked. Application
failure rolls that transaction back; a fresh compare-and-set transaction then
records the item as retryable `failed` without overwriting a concurrent reviewer
action. Embedding, indexing, and queue effects are collected during application
and dispatched only after the database commit. Calendar acceptance and direct
calendar mutations share a target advisory lock acquired before linked raw-event
locks, preventing opposite row-lock orders.

Strict admission reduces recall compared with open semantic retrieval. This is
intentional for durable proposals. Answer policies can use broader recall while
retaining the same visibility and citation primitives.

## Rejected and deferred alternatives

- **Semantic-only proposal joins:** rejected because similarity is not durable
  relationship proof.
- **Transitive relationship expansion:** rejected for the first version because
  each hop compounds false-link risk.
- **One retrieval implementation per consumer:** rejected because visibility,
  citation, and budget behavior would drift.
- **Persisted `evidence_packs` and `evidence_pack_items`:** deferred until packs
  need independent reuse, querying, or lifecycle beyond their outputs.
- **Normalized item-to-evidence junction:** deferred while per-item output source
  references and metadata meet the audit and display contract.
- **Private and specific-user background packs:** deferred until ownership,
  notifications, audience intersection, and approval visibility are designed as
  a separate milestone.
- **Per-team production rollout controls:** deferred in favor of isolated worker
  environments for the first controlled release.

## Related documents

- [Cross-source evidence product brief](../cross-source-evidence.md)
- [Cross-source evidence implementation plan](../cross-source-evidence-implementation-plan.md)
- [ADR 0004](./0004-conversation-reviews-drive-conversational-proposals.md)
- [ADR 0005](./0005-workspace-reconciliation-is-artifact-centered-and-approval-backed.md)
- [ADR 0009](./0009-ingest-webhooks-are-evidence-only.md)
- [ADR 0010](./0010-artifact-provenance-is-tiered-and-evidence-backed.md)
