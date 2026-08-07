# Cross-source evidence implementation plan

> **Status:** Implemented and validated in code; rollout remains default-off and unshipped.

**Goal:** Build one visibility-safe, policy-bound evidence-pack primitive and
prove it on generic ingest webhook proposals before migrating conversation
reviews, other event-local proposal paths, and Agent Ask.

**Architecture:** A shared module discovers directly related raw events,
hydrates them through the existing team and viewer visibility boundary, ranks
eligible events deterministically, applies hard budgets, and returns an
ephemeral typed pack. Proposal and answer consumers apply different admission
policies. Proposal items select exact raw-event IDs from the pack, and existing
suggestion evidence, reconciliation source references, and run metadata persist
the audit trail.

**Tech stack:** TypeScript, Drizzle/Postgres, Qdrant, BullMQ, Zod, Vitest, the
existing `withTeam` workspace port, artifact reconciliation, suggestion worker,
Agent Ask retrieval, and approval UI.

**Durable decision:**
[ADR 0014](./adr/0014-cross-source-evidence-packs-use-policy-bound-related-evidence.md).
**Product contract:** [Cross-source evidence](./cross-source-evidence.md).

## Implementation state

The shared builder, visibility-safe one-hop discovery, deterministic budgets,
proposal and answer policies, exact item citations, suggestion revisions,
stale-evidence acceptance checks, Approvals presentation, generic-webhook
rollout modes, Agent Ask failure disclosure, and enforcing redacted promotion
reports are implemented. For generic ingest webhooks, `off` preserves legacy
proposal behavior, `shadow` records content-free pack results, and `enforced`
requires pack-backed exact citations and removes time-only raw context. Other
proposal adapters remain on their legacy paths until their later milestones.

This is code-complete, not a production promotion. The live/shadow sample
floors, adapter-specific quality gates, monitoring ownership, and explicit
deployment switch remain operational rollout work. No adapter may be described
as shipped solely because its enforced path exists in code.

## Scope

### First enforced milestone

The first milestone ships pack-backed generic ingest webhook proposals:

1. A webhook raw event anchors a deterministic proposal pack.
2. Direct one-hop artifact, provider-ID, canonical-URL, explicit-reference, or
   curated-object relationships admit supporting events.
3. Team visibility is enforced before content enters the pack or model prompt.
4. The proposal model selects exact evidence IDs for each proposed item.
5. Existing suggestion and reconciliation records persist pack provenance and
   per-item source references without a schema migration.
6. Approvals display per-item citations, block visible-but-changed evidence,
   and hide proposals backed by inaccessible evidence.
7. Operators can run the builder in `off`, `shadow`, or `enforced` mode.

### Later milestones

1. Slack and Telegram conversation reviews use the shared builder while
   retaining their protected same-conversation core.
2. Email, meeting, and document proposal paths replace recent time-only context
   with pack evidence.
3. Agent Ask already uses the answer policy for raw-event evidence while
   retaining its typed workspace-context tools; later work adds live quality
   evidence rather than changing its retrieval boundary.

### Explicit non-goals

- Semantic-only or transitive proposal admission
- Private or specific-user background proposal packs
- A durable evidence-pack table or normalized item-evidence junction in the
  first implementation
- A new embedding or generative-model request solely for proposal ranking
- Continuous pack watchers
- Forced source diversity when no cross-source evidence qualifies
- Replacement of typed object, note, task, board, document, or calendar
  retrieval in Agent Ask
- Automatic enforcement of an adapter that has not passed its own rollout gate

## Vocabulary and contracts

### Surface

A surface is the source family people recognize. Slack, Telegram, email,
meetings, GitHub, Linear, Monday, Sentry, and each named generic webhook are
distinct surfaces. Multiple event types from one provider remain one surface.

### Relationship classes

| Class | Examples | Proposal admission |
| --- | --- | --- |
| Core | Anchor event, same Slack thread, same Telegram conversation review | Yes; protected before supporting budgets |
| Hard reference | Provider/external object ID, canonical URL, explicit source reference | Yes |
| Canonical object or artifact | Unambiguous artifact association, accepted object link, human-curated relationship | Yes |
| Extracted candidate | Model-extracted fact/entity association without stronger provenance | Candidate generation only |
| Retrieval similarity | Semantic score, lexical overlap | Ranking only after admission |
| Incidental | Same sender, nearby time, transitive graph path | No |

### Proposed shared API

Create `packages/shared/src/evidence-pack/index.ts` with a contract equivalent
to:

```typescript
type EvidencePackPurpose = 'proposal' | 'answer';

interface BuildEvidencePackInput {
  teamId: string;
  viewerUserId: string;
  purpose: EvidencePackPurpose;
  anchorRawEventIds: string[];
  conversation?: { key: string; coreRawEventIds: string[] };
  artifactClusterIds?: string[];
  objectIds?: string[];
  policyVersion?: string;
}

interface EvidencePackItem {
  rawEventId: string;
  surface: string;
  role: 'core' | 'supporting';
  contentText: string;
  occurredAt: Date;
  relationshipSignals: EvidenceRelationshipSignal[];
  sourceRefs: ReconciliationSourceRef[];
  rank: number;
  rankReasons: string[];
  visibility: EvidenceVisibilityEnvelope;
  truncated: boolean;
}

interface EvidencePack {
  version: string;
  policyVersion: string;
  fingerprint: string;
  purpose: EvidencePackPurpose;
  audience: EvidenceVisibilityEnvelope;
  items: EvidencePackItem[];
  metrics: EvidencePackMetrics;
}
```

The implementation may refine names, but it must preserve these boundaries:

- the builder receives authenticated team and viewer scope;
- all returned content passed visibility hydration;
- every item has an immutable raw-event reference and surface;
- relationship admission and ranking are separate;
- policy and fingerprint versions are explicit;
- prompt rendering remains consumer-owned; and
- metrics contain no evidence text.

### Proposal policy budgets

| Budget | Initial limit |
| --- | ---: |
| Protected conversation-core events | 24 |
| Supporting events | 8 |
| Supporting events per surface | 4 |
| Eligible candidates scanned | 500 |
| Estimated evidence tokens | 6,000 |
| Existing total suggestion input | 24,000 |

Core evidence is reserved first. Supporting selection then applies relationship
provenance, source authority, recency, diversity, optional semantic relevance,
occurrence time, and raw-event ID. Every limit or content truncation produces a
machine-readable reason.

## Acceptance criteria

### Safety and correctness

- Every database read is team-scoped; semantic results are hydrated through
  Postgres visibility checks before use.
- The first proposal adapter accepts team-visible evidence only.
- Same sender, same time, semantic similarity, extracted facts alone, and
  transitive paths never admit cross-source proposal evidence.
- Ambiguous artifact matches and disjoint audiences produce no proposal.
- The pack never changes field-scoped reconciliation authority.
- Generic webhook evidence remains non-authoritative.
- Raw source content is never updated.
- Unknown, inaccessible, or empty model-selected evidence IDs invalidate the
  affected bundle.
- Every persisted proposal item has at least one exact source reference.
- New pack fingerprints supersede prior proposal revisions instead of silently
  accumulating evidence.
- Tombstoned, deleted, or newly inaccessible evidence hides the derived
  proposal; a direct acceptance attempt supersedes it.

### Boundedness and determinism

- Identical inputs and policy versions produce the same selected IDs, ordering,
  fingerprint, and truncation reasons.
- Core events remain present whenever the total prompt can contain them.
- The builder never scans or selects above the configured hard limits.
- Proposal ranking makes no new embedding or generative-model request.
- Candidate discovery does not perform per-candidate database or model calls.

### Product behavior

- A pack-eligible generic webhook proposal can cite directly related
  conversation and provider evidence.
- An anchor-only webhook continues to produce a valid same-source pack.
- Each approval item displays only its selected citations, grouped by surface.
- Internal ranks, relationship strengths, UUIDs, and fingerprints remain hidden
  from the default approval view.
- One pack may support several independently actionable outputs.

### Operations

- `off` preserves current behavior and does not build packs.
- `shadow` builds packs and records content-free metrics without changing model
  input or user-visible output.
- `enforced` uses pack evidence and exact citation validation.
- Any safety violation is a promotion blocker and rollback trigger.
- Pack p95 remains below 1 second and errors below 1% before promotion.

## Implementation tasks

### Task 1: Add the shared evidence-pack contracts and policy registry

**Objective:** Establish a deep shared module with explicit inputs, outputs,
budgets, surface normalization, versions, and content-free metrics.

**Files:**

- Create: `packages/shared/src/evidence-pack/index.ts`
- Create: `packages/shared/src/evidence-pack/index.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

**Steps:**

1. Define anchor, item, relationship-signal, visibility-envelope, metrics,
   truncation, policy, and pack types.
2. Add proposal and answer policy records. Encode the agreed proposal limits in
   one versioned policy constant rather than scattering numbers across callers.
3. Normalize raw sources and integration provider metadata into the documented
   surface vocabulary.
4. Define stable error and no-pack reason codes for missing anchors, invisible
   anchors, empty audience, ambiguous relationships, candidate failure, budget
   exhaustion, and invalid policy.
5. Add a package export for `@timeline/shared/evidence-pack`.
6. Keep prompt strings and worker-specific output schemas outside this module.

**Verification:** Unit tests cover policy defaults, source normalization,
version serialization, invalid inputs, and content-free metrics. Run
`pnpm test:dist-imports` because a shared export is added.

### Task 2: Centralize audience intersection and visibility-safe hydration

**Objective:** Reuse the existing visibility model instead of implementing a
second authorization path inside the builder.

**Files:**

- Modify: `packages/shared/src/visibility.ts`
- Create: `packages/shared/src/visibility.test.ts`
- Modify: `packages/shared/src/team-scope.ts`
- Modify: `packages/shared/src/team-scope.test.ts`
- Modify: `packages/shared/src/suggestions/index.ts`
- Modify: `packages/shared/src/suggestions/index.test.ts`
- Modify: `packages/shared/src/evidence-pack/index.ts`

**Steps:**

1. Extract the existing suggestion evidence-audience intersection into a shared
   visibility helper without weakening private or specific-user semantics.
2. Add a narrow TeamScope method that hydrates an explicit set of candidate raw
   event IDs through Postgres visibility and tombstone checks.
3. Preserve Qdrant team and viewer filters as a first defense, then require SQL
   hydration before content reaches a pack.
4. Make the proposal policy reject any non-team anchor or supporting event in
   the first milestone.
5. Return structured invisible, deleted, tombstoned, and disjoint-audience
   counts without returning their content.

**Verification:** Tests cover team isolation, private owner access,
specific-user subsets, disjoint audiences, deleted/tombstoned events, a forged
Qdrant result, and team-only proposal rejection. Run `pnpm test:eval` and
`pnpm test:reconciliation-eval`.

### Task 3: Implement one-hop candidate discovery

**Objective:** Build a bounded candidate union from existing relationship
primitives without semantic-only or transitive admission.

**Files:**

- Modify: `packages/shared/src/evidence-pack/index.ts`
- Modify: `packages/shared/src/evidence-pack/index.test.ts`
- Modify: `packages/shared/src/artifacts/index.ts`
- Modify: `packages/shared/src/artifacts/index.test.ts`
- Modify: `packages/shared/src/reconciliation/resolver.ts` only if a reusable
  read-only resolver must be extracted
- Modify: `packages/shared/src/conversational/link-artifacts.ts` only if its
  normalized explicit-reference helpers need exporting

**Steps:**

1. Always include requested visible anchor IDs and protected core IDs.
2. Resolve direct artifact associations, non-semantic anchors, provider IDs,
   external IDs, canonical URLs, explicit source references, and accepted object
   links.
3. Treat model-extracted fact/entity associations as candidate hints only.
   Require a stronger relationship before admission.
4. Reject ambiguous cluster matches instead of selecting one by recency or
   semantic score.
5. Stop after one relationship hop. Do not recursively traverse related
   artifacts or objects.
6. Union and deduplicate candidates by raw-event ID before hydration and cap the
   candidate set at 500.
7. Avoid per-candidate queries by batching anchors, associations, and raw-event
   hydration.

**Verification:** Fixtures cover each accepted signal, extracted-only rejection,
semantic-only rejection, same-sender/time rejection, ambiguous anchors,
transitive-path rejection, duplicate paths to one event, and candidate overflow.

### Task 4: Add deterministic ranking, diversity, budgets, and fingerprints

**Objective:** Select a reproducible bounded pack without another model call.

**Files:**

- Modify: `packages/shared/src/evidence-pack/index.ts`
- Modify: `packages/shared/src/evidence-pack/index.test.ts`
- Modify: `packages/shared/src/qdrant/client.ts` only if existing stored vectors
  need a safe read API
- Modify: `packages/shared/src/qdrant/client.test.ts` when that API changes

**Steps:**

1. Rank core status, relationship provenance, source authority, recency, source
   diversity, optional stored-vector relevance, occurrence time, and raw-event
   ID in that order.
2. Use an existing stored anchor vector only. Skip semantic ranking when it is
   unavailable.
3. Reserve core evidence, then apply the 8-event supporting cap and 4-event
   per-surface cap.
4. Apply a deterministic content/token estimator and the 6,000-token pack
   budget without raising the 24,000-token suggestion limit.
5. Preserve raw references while returning bounded content excerpts for prompt
   rendering. Record item and pack truncation reasons.
6. Compute the fingerprint from normalized anchor/core IDs, selected ordered
   IDs, model-visible content and occurrence time, policy and builder versions,
   relationship reasons, and truncation state. This ensures a permitted
   calendar refresh creates a new proposal revision even when its IDs are
   unchanged.
7. Return metrics for candidate and selected counts, surfaces, relationship
   classes, token estimates, duration, and omissions without evidence text.

**Verification:** Repeat and randomized-order tests produce identical selections
and fingerprints. Boundary tests cover every cap, core reservation, per-surface
diversity, unavailable vectors, and content truncation.

### Task 5: Add exact per-item citation output and persistence

**Objective:** Replace post-hoc lexical evidence selection on pack-backed paths
with model-selected, validated item citations.

**Files:**

- Modify: `apps/worker/src/workers/suggestions.ts`
- Modify: `apps/worker/src/workers/suggestions.test.ts`
- Modify: `apps/worker/src/workers/suggestions.evals.test.ts`
- Modify: `packages/shared/src/suggestions/index.ts`
- Modify: `packages/shared/src/suggestions/index.test.ts`
- Modify: `packages/shared/src/suggestions/reconciliation-projection.test.ts`

**Steps:**

1. Add `evidenceRawEventIds` with at least one and no more than the 32 selected
   pack events to each pack-backed suggestion item in the structured model
   schema.
2. Render pack item IDs beside fenced external content. Tell the model to cite
   only IDs in the pack and produce no item when material conflict is unresolved.
3. Validate every returned ID against the visible pack. Reject an affected
   bundle with a structured reason when an ID is unknown, inaccessible, empty,
   duplicated incorrectly, or outside the selected pack.
4. Keep lexical `minimalEvidenceForBundle` only for `off` and legacy paths.
   Never call it as an enforced-mode fallback.
5. Extend `SuggestionItemInput` with selected evidence IDs and validate that
   each is contained in the suggestion's bundle evidence union.
6. Store the union in `agent_suggestion_evidence`, selected IDs in item metadata,
   and exact per-item citations in each reconciliation output's `sourceRefs`.
7. Store pack version, policy version, fingerprint, metrics, build time, and
   truncation state in suggestion metadata and reconciliation run metrics.
8. Preserve source authority when a pack contains provider-owned direct state
   and Timeline-owned approval-backed changes.

**Verification:** Tests prove exact item citations, unknown-ID rejection,
bundle-level union behavior, per-item output source references, mixed-authority
outputs, prompt fencing, and no lexical fallback in enforced mode.

### Task 6: Define proposal revisions and stale-evidence enforcement

**Objective:** Ensure pack changes and inaccessible evidence cannot leave a
misleading actionable approval.

**Files:**

- Modify: `packages/shared/src/suggestions/index.ts`
- Modify: `packages/shared/src/suggestions/index.test.ts`
- Modify: `packages/shared/src/suggestions/reconciliation-projection.test.ts`
- Modify: `apps/web/src/app/actions/suggestions.ts` or the current acceptance
  action boundary
- Modify: the nearest action tests

**Steps:**

1. Compare incoming and pending pack fingerprints before merging a suggestion.
2. When the fingerprint changes, create a new revision and supersede the prior
   items and reconciliation outputs with a pack-change reason.
3. Do not describe append-only bundle evidence as the current selection.
4. Revalidate every selected source reference on approval hydration and
   acceptance.
5. Supersede an item when required evidence is deleted, tombstoned, or no longer
   visible. Reuse the existing `superseded` state rather than adding a `stale`
   enum in the first implementation.
6. Do not return a derived proposal when any of its required evidence is no
   longer visible to the viewer; its title and payload may contain source
   details that must not survive a visibility narrowing.
7. Keep acceptance idempotent when revalidation races with a newer revision.

**Verification:** Tests cover unchanged rebuilds, changed fingerprints,
supersession, tombstones, visibility narrowing, stale acceptance races, output
dedupe, and bundle status refresh.

### Task 7: Integrate generic ingest webhooks behind rollout modes

**Objective:** Prove the shared builder on the roadmap's evidence-only source
without changing native-provider authority.

**Files:**

- Modify: `packages/shared/src/env.ts`
- Modify: `packages/shared/src/env.test.ts`
- Modify: `.env.example`
- Modify: `apps/worker/src/workers/suggestions.ts`
- Modify: `apps/worker/src/workers/suggestions.test.ts`
- Modify: `apps/web/src/app/api/webhooks/ingest/route.test.ts` when enqueue
  behavior changes
- Modify: `scripts/e2e-env.ts`
- Modify: `scripts/e2e-env.test.ts`
- Modify: `docs/setup/local.html`
- Modify: `docs/railway.html`

**Steps:**

1. Add typed `CROSS_SOURCE_EVIDENCE_MODE=off|shadow|enforced`, defaulting to
   `off`, and document that changes require a worker restart or redeploy.
2. Keep `ingest_webhooks.proposal_generation_enabled` as the inner source gate.
3. At the suggestion orchestration boundary, leave current behavior untouched
   in `off` mode.
4. In `shadow`, build the pack and persist content-free metrics, but do not add
   the pack to the prompt or create pack-derived output.
5. In `enforced`, render the pack and require exact item citations.
6. Return a valid anchor-only pack when no supporting evidence qualifies.
7. Fail closed and retry when candidate discovery or required visibility
   hydration fails. Do not treat a failed adapter as an empty complete pack.
8. Add structured no-action and invalid-citation reason codes to worker metrics
   and redacted logs.

**Verification:** Tests cover all three modes, default-off behavior, invalid env
values, inner webhook gating, shadow side-effect isolation, enforced pack use,
anchor-only behavior, and retryable failures.

### Task 8: Show per-item evidence in Approvals

**Objective:** Present human-readable citations under the proposal item they
support while keeping implementation details out of the default view.

**Files:**

- Modify: `packages/shared/src/suggestions/index.ts`
- Modify: `apps/web/src/lib/suggestions.ts`
- Modify: `apps/web/src/components/approvals/approvals-client.tsx`
- Modify: the nearest approval component and serialization tests
- Modify: `design.md`

**Steps:**

1. Hydrate each item's evidence from its authoritative reconciliation output
   source references and the bundle's visible evidence rows.
2. Extend the design-system evidence contract for item-level approval citations,
   then render source, timestamp, author, bounded excerpt, and source-event link
   under each item, grouped by normalized surface.
3. Preserve the bundle evidence summary as contextual evidence.
4. Keep raw IDs, fingerprints, ranks, relationship strengths, payload refs, and
   visibility internals inside `TechnicalDetails` or explicit audit views.
5. Show a clear stale state and disable acceptance when visible evidence changed
   after proposal creation. Hide the proposal when required evidence is no
   longer visible or active.
6. Preserve keyboard navigation, focus behavior, screen-reader labels, and
   narrow-screen layout.

**Verification:** Component tests cover multiple surfaces, repeated evidence
across items, inaccessible evidence, stale state, keyboard interaction, and no
internal identifiers in default UI. Run `pnpm run doctor` and the relevant web
tests.

### Task 9: Extend evals, telemetry, and promotion tooling

**Objective:** Make safety, quality, cost, and latency release gates executable
before enforcement.

**Files:**

- Modify: `packages/shared/src/reconciliation/eval-cases.ts`
- Modify: `packages/shared/src/reconciliation/evals.test.ts`
- Modify: `packages/shared/src/reconciliation/live-eval.test.ts`
- Modify: `packages/shared/src/reconciliation/production-sampling.ts`
- Modify: `packages/shared/src/reconciliation/production-sampling.test.ts`
- Modify: `apps/worker/src/scripts/reconciliation-production-sampling.ts`
- Modify: `packages/shared/src/reconciliation/dashboard.ts`
- Modify: `packages/shared/src/reconciliation/dashboard.test.ts`
- Modify: `apps/web/src/app/app/team/reconciliation/page.tsx` only when new
  content-free pack metrics belong in the admin view

**Steps:**

1. Add deterministic cases for true multi-source citations, extracted-only
   rejection, same-time/sender rejection, ambiguous hard links, transitive-link
   rejection, disjoint audiences, conflict no-action, mixed authority,
   deterministic ordering, truncation, and pack revision.
2. Add live cases that require exact per-item IDs and complete cited surfaces.
3. Extend production sampling with pack version, mode, eligible and selected
   counts, source diversity, invalid citation count, false-link review outcome,
   token estimate, build latency, error reason, and truncation reason.
4. Store aggregates only. Keep evidence text and provider payloads out of
   metrics and logs.
5. Add p50, p95, and p99 pack latency and error-rate reporting over shadow
   attempts instead of relying on average end-to-end reconciliation time or
   allowing `off`/`enforced` samples to dilute the rollout gates.
6. Make the promotion report enforce evidence coverage, fixture success, shadow
   sample floor, zero-tolerance safety counters, p95 latency, and error rate.
   The production CLI ingests explicit redacted evidence-pack sample files and
   merges fresh summaries with any loaded historical report health. It requires
   repeatable scenario-family flags; it rejects sample assessment when
   the required-family policy is omitted and counts a seven-day gate only when
   those UTC dates are consecutive.
7. Document the operational rollback command and owner. Changing the mode
   requires a restart or redeploy.

**Verification:** `pnpm test:eval`, `pnpm test:reconciliation-eval`, and the
redacted production-sampling tests pass. Run the live reconciliation eval when
the required environment is available.

### Task 10: Promote the generic webhook adapter

**Objective:** Move the first adapter from shadow to enforced only after the
agreed release gates pass.

**Files:**

- Modify: deployment environment and operator runbook outside source control
- Modify: `docs/setup/local.html` or `docs/railway.html` only when operational
  instructions change
- Modify: `todo.md` after the milestone is proven

**Steps:**

1. Pass the evidence coverage audit for the enabled source path.
2. Run shadow mode for at least seven consecutive days and collect at least 200
   eligible packs across three teams, including 25 cross-source packs and every
   required scenario family.
3. Review cross-source samples and confirm zero visibility leaks, authority
   violations, unknown citations, ambiguous-link proposals, and false merges.
4. Confirm pack-build p95 below 1 second, error rate below 1%, no extra model
   call, and no material suggestion queue-age regression.
5. Enable `enforced` in the controlled worker environment and monitor rollback
   counters.
6. Roll back immediately for any safety violation, or when p95 exceeds 2 seconds
   or pack errors exceed 2% for 15 minutes.

**Verification:** Save a redacted promotion report and deployment record. Do not
mark the adapter shipped based on configuration alone.

### Task 11: Migrate conversation reviews

**Objective:** Replace the Slack and Telegram disambiguation-only linked window
with pack-backed, item-cited proposal evidence while preserving conversation
semantics.

**Files:**

- Modify: `packages/shared/src/conversation-review/index.ts`
- Modify: `packages/shared/src/conversation-review/index.test.ts`
- Modify: `apps/worker/src/workers/suggestions.ts`
- Modify: `apps/worker/src/workers/suggestions.test.ts`
- Modify: `apps/worker/src/workers/suggestions.evals.test.ts`

**Steps:**

1. Pass the existing two-day, 24-event same-conversation window as protected
   core evidence.
2. Replace `buildLinkedContextWindow` as a proposal source with the shared
   one-hop builder. Retain or deprecate it explicitly; do not leave competing
   cross-source rules.
3. Allow qualifying cross-source events to support proposal items rather than
   limiting them to disambiguation.
4. Preserve Slack thread-root reservation, debounce, supersession, and
   team-visible-only scheduling.
5. Pass the adapter-specific shadow and promotion gates before enforcement.

**Verification:** Tests cover Slack threads, unthreaded channels, Telegram
conversations, corrections, unrelated same-sender chatter, multi-source item
citations, replay determinism, and no private evidence.

### Task 12: Migrate event-local proposal paths

**Objective:** Replace time-only recent context for email, meetings, and
documents without expanding source authority.

**Files:**

- Modify: `apps/worker/src/workers/suggestions.ts`
- Modify: `apps/worker/src/workers/suggestions.test.ts`
- Modify: source-specific dispatcher/worker tests when their enqueue contracts
  change

**Steps:**

1. Add one adapter at a time for email, meetings, and documents.
2. Use the current raw event as the anchor and directly related pack items as
   evidence.
3. Keep typed workspace, calendar, board, and pending-approval state as adjacent
   prompt context.
4. Remove time-only recent chronology from enforced paths once parity fixtures
   prove it is no longer needed.
5. Run adapter-specific shadow samples and promotion checks before enforcement.

**Verification:** Each adapter has positive multi-source, unrelated chronology,
visibility, conflict, citation, and anchor-only fixtures.

### Task 13: Adapt Agent Ask raw-event retrieval

**Objective:** Reuse pack citations for answers without collapsing typed
workspace context into raw evidence.

**Files:**

- Modify: `packages/shared/src/agent/retrieval.ts`
- Modify: `packages/shared/src/agent/retrieval.test.ts`
- Modify: `packages/shared/src/agent/tools.ts`
- Modify: `packages/shared/src/agent/tools.test.ts`
- Modify: `packages/shared/src/agent/ask.ts`
- Modify: `packages/shared/src/agent/evals.test.ts`

**Steps:**

1. Add an answer-policy adapter for raw-event evidence returned by broad
   workspace retrieval.
2. Allow viewer-visible semantic matches to enter answer packs with explicit
   semantic-retrieval provenance.
3. Keep object, note, task, board, document, and calendar results as typed
   adjacent context with their existing citations.
4. Allow partial answers only when the response discloses a failed source
   adapter.
5. Preserve required-source behavior when a person explicitly names a source.

**Verification:** Agent evals cover cross-source synthesis, semantic evidence
labeling, typed-state separation, required-source failures, private visibility,
and complete citations. Run `pnpm test:eval`.

### Task 14: Align documentation and product claims per milestone

**Objective:** Keep current-state, target-state, and shipped-source claims
consistent as adapters graduate.

**Files:**

- Modify: `docs/cross-source-evidence.md`
- Modify: `docs/cross-source-evidence-implementation-plan.md`
- Modify: `todo.md`
- Modify: `README.md`
- Modify: `docs/product-brief.html`
- Modify: `docs/index.html`
- Modify: relevant sales or landing copy only for enforced source paths

**Steps:**

1. Mark tasks complete only after implementation and required gates pass.
2. Name which source paths are `off`, `shadow`, `enforced`, or shipped.
3. Use present-tense cross-source proposal claims only for advertised paths that
   meet the shipped definition.
4. Keep authority language scoped to inferred Timeline-owned memory.
5. Run the repository document-release workflow before every milestone handoff.

**Verification:** Links resolve, current-state tables match code and deployment,
and no page implies that an unshipped adapter synthesizes cross-source
proposals.

## Test matrix

| Area | Required proof |
| --- | --- |
| Isolation | Cross-team candidates never hydrate, rank, enter prompts, persist, or display |
| Visibility | Team-only proposal policy; viewer-scoped answer policy; disjoint audience fails closed |
| Admission | Hard/direct signals accepted; extracted-only, semantic-only, temporal, sender, and transitive signals rejected |
| Ranking | Stable order and fingerprint under randomized query order; authority and diversity precedence |
| Budgets | Core reservation; item, surface, candidate, and token caps; recorded truncation |
| Citations | Exact per-item IDs; invalid IDs rejected; output source references match selected evidence |
| Conflict | Contrary eligible evidence retained; unresolved conflict yields no proposal |
| Authority | Provider-owned direct effects and Timeline-owned approvals coexist without escalation |
| Lifecycle | Replay idempotence; new fingerprint supersedes; tombstones and visibility changes block acceptance |
| Rollout | Off parity; shadow no side effects; enforced exact-citation contract; rollback counters |
| UI | Per-item grouped citations, accessible interaction, no internal detail leakage |
| Ask | Broader semantic admission remains viewer-scoped and distinct from proposal policy |

## Required validation by milestone

After any documentation or code change, follow `AGENTS.md`:

1. Run `pnpm validate`.
2. Run `pnpm run doctor` and require `React Doctor score: 100` plus `No issues found!`.
3. Run the nearest changed-package tests.
4. Run `pnpm test:dist-imports` when adding the shared export.
5. Run `pnpm test:eval` for retrieval, visibility, citation, or answer changes.
6. Run `pnpm test:reconciliation-eval` for evidence, source-reference,
   visibility-floor, authority, or reconciliation changes.
7. Run `pnpm test:reconciliation-eval:live` when prompts or live reconciliation
   behavior change and the required environment is available.
8. Run broader `pnpm test` and relevant end-to-end coverage before enforcing a
   source adapter.
9. Run the document-release workflow before handoff.

## Sequencing and review boundaries

Keep changes independently reviewable in this order:

1. shared contracts and visibility extraction;
2. candidate discovery;
3. deterministic selection and fingerprints;
4. exact item-citation persistence;
5. stale/revision behavior;
6. webhook shadow integration and telemetry;
7. approval UI;
8. eval and promotion tooling;
9. webhook enforcement;
10. one later adapter per change.

Do not combine later consumer migrations with the first webhook slice. Do not
enable enforcement in the same change that introduces unreviewed pack-building
behavior.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| False cross-source merge | Strong one-hop admission, ambiguous-match rejection, semantic ranking only, negative fixtures, shadow review |
| Visibility leak | TeamScope hydration before content use, team-only proposal v1, output floor checks, stale revalidation |
| Authority escalation | Keep pack and field authority separate; mixed-authority evals |
| Incorrect citations | Exact model-selected IDs, subset validation, per-item output source references, no enforced lexical fallback |
| Prompt growth | Protected core plus 8 supporting events and a 6,000-token pack budget inside the existing prompt cap |
| Non-deterministic revisions | Stable ordering, versioned policy, fingerprint, explicit supersession |
| Queue or provider cost regression | No new proposal-ranking call, batched discovery, p95/error gates, off/shadow/enforced rollback |
| Product overclaim | Per-adapter shipped definition and milestone-gated copy |

## Completion definition

The full program is complete only when the webhook, conversation-review,
event-local, and Agent Ask milestones have each passed their adapter-specific
gates; per-item evidence is visible and enforceable; current documentation names
the deployed scope; and no open roadmap item still describes implemented work
as future behavior.
