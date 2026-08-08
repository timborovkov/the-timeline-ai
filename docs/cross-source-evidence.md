# Cross-source evidence product brief

**Status:** Implemented behind a default-off rollout switch; not shipped

**Audience:** Product, engineering, design, and website copy

**Last updated:** 2026-08-07

Timeline's cross-source evidence direction is one operating memory backed by the
tools where work happened. The shared builder, proposal and answer adapters,
exact citations, revision handling, approval UI, and redacted metrics are now
implemented, but pack-backed proposals remain disabled by default and are not
shipped. Current product copy must describe today's behavior;
present-tense cross-source proposal claims remain gated on each source path
shipping.

## The promise

Timeline should not ask a team to maintain another system of record. It captures
work from chat, meetings, email, documents, boards, tickets, and provider tools,
then connects evidence that refers to the same real-world work.

The target product story is:

> **One memory from every surface.** A commitment in Slack, confirmed on a call,
> tracked in Monday, and clarified by email becomes one cited record instead of
> four disconnected histories.

This is not AI chat over notes or a generic integration sync. The
differentiation is compounding operational memory across the tools a team
already uses while preserving citations, visibility, source authority, and
human review.

## Current state

Timeline accumulates raw events, extracted facts, workspace objects, embeddings,
artifact associations, and reconciliation outputs. The code can build shared
proposal and answer packs. Proposal behavior remains on the legacy path while
`CROSS_SOURCE_EVIDENCE_MODE=off`, which is the default.

| Path | What happens today |
| --- | --- |
| Generic ingest webhooks | `off`: the existing event-local proposal remains unchanged. `shadow`: pack metrics only; pack failures are recorded without interrupting legacy extraction. `enforced`: recent time-only chronology is replaced by the anchor plus directly related pack evidence, and every proposed change requires exact citations. The existing proposal-generation source gate remains an inner gate. |
| Slack, Telegram, email, meetings, and documents | Existing conversation-review and event-local proposal behavior remains unchanged regardless of the global rollout setting. These adapters must migrate and pass their own gates separately. |
| GitHub, Linear, Monday, and Sentry | Structured events feed artifact reconciliation, associations, source references, and provider-authoritative outputs. They do not run the suggestion model. |
| Agent Ask | Broad workspace retrieval returns a viewer-visible answer-policy pack for raw-event evidence while keeping objects, notes, tasks, boards, documents, and calendar results as typed adjacent context. Semantic matches are labeled as retrieval provenance, and partial packets disclose failed source adapters. |

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
model call. Answer packs may admit viewer-visible semantic matches, but must
label and cite them as retrieved evidence.

## Product vocabulary

- **Anchor:** One or more immutable raw events that caused the evidence review
- **Core evidence:** The anchor and protected same-conversation events
- **Supporting evidence:** Directly related, visibility-safe events from the same or another surface
- **Surface:** A source family people recognize, such as Slack, email, meetings, GitHub, Monday, or a named generic webhook
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
  occurrence-level `series` and `this_and_future` mutations lock the canonical
  recurring parent shared by direct edits and approval acceptance;
- the canonical change and accepted approval commit atomically; an application
  error rolls both back before a fresh transaction records a retryable failed
  approval, while indexing and queue follow-ups run only after commit;
- the enforced pack is reserved inside the prompt budget before optional source
  and workspace context;
- deterministic, live, privacy, authority, quality, latency, and cost gates pass;
- rollback monitoring is active; and
- product copy names only the source paths that meet those conditions.

The complete sequence, file map, test matrix, and release gates are in the
[cross-source evidence implementation plan](./cross-source-evidence-implementation-plan.md).
The durable contract is recorded in
[ADR 0014](./adr/0014-cross-source-evidence-packs-use-policy-bound-related-evidence.md).

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
  days and three teams; a failed attempt never counts toward eligibility
- At least 25 genuinely cross-source shadow packs, with every required scenario
  family represented; telemetry must satisfy surface count ≤ selected count ≤
  candidate count
- One builder version and one proposal-policy version across the qualifying
  population; a version change starts a fresh promotion window
- Disjoint population fingerprints across cumulative sampling reports, derived
  from immutable attempt IDs or legacy immutable attempt provenance rather than
  mutable review annotations; an overlapping report is rejected instead of
  double-counted, and duplicate legacy identities are rejected as ambiguous
- Loaded aggregate health must preserve the same count relationships as raw
  samples, including cross-source ≤ eligible ≤ total attempts, errors ≤ total,
  error-reason totals and error rate matching the error count, and aggregate
  surface ≤ selected ≤ candidate counts
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
