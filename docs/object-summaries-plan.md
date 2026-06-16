# Object Summaries Implementation Plan

Object summaries are the next object-memory slice. The goal is to make object
detail pages, search, and chat start from a compact, current, cited brief while
preserving the existing fact/evidence/notes model as the source of truth.

## Decisions

- Object summaries are derived team memory, not canonical facts.
- The visible object-page panel is titled `Summary`; generated/stale/pending
  state appears in the panel metadata.
- Summaries are non-editable. Users correct them by changing the underlying
  object fields, facts, notes, relationships, tasks, or accepted memory.
- Persisted summaries are team-wide and generated only from team-visible
  sources. Private or restricted evidence must not feed the stored summary.
- Pending approval suggestions are excluded until accepted into canonical
  object memory.
- Summaries should infer current state from newer, stronger evidence. Later
  confirmed facts supersede older tentative facts unless the newer source is
  ambiguous or weak.
- Contradictions are not silently hidden. Latest clear state wins; unresolved
  conflicts are surfaced with citations.
- Summaries should be selective and operational: identity, current state, active
  commitments, dates, relationships, blockers, risks, and source-backed next
  actions. Exhaustive history stays in Facts and Evidence.
- Generated prose paraphrases sources while preserving exact names, dates,
  numbers, owners, statuses, and commitments.
- Invalid or missing citations fail the generation run. The system validates
  source references; the model does not get to invent them.
- Summary updates do not write `object_changes` rows and do not count as "new
  since last visit."

## Product Surface

On the object detail page, the summary panel sits in the main column above
Evidence and Facts.

The panel should render:

- A 2-4 sentence `overview`.
- Optional current-state bullets for source-backed dates, next steps, owners,
  blockers, risks, or important relationships.
- Optional open questions or conflict notes when the packet contains meaningful
  uncertainty.
- Lightweight source chips attached to individual structured items where
  possible, with a compact source cluster for the overview.
- A metadata row such as `Updated 4 min ago · 7 sources`, `Updating after recent
  changes`, or `Update failed · Retry`.

When no summary exists:

- Show a calm empty state such as `Not enough object memory yet.` when the
  source packet is insufficient.
- Show `Generate summary` when there is sufficient source material and no
  summary/job exists.
- Show `Generating...` while a manual or background job is active.
- Show `Summary could not be generated · Try again` after a failed first run,
  without exposing raw provider errors.

Fresh summaries should not show an always-visible regenerate button. Manual
actions are reserved for missing, failed, or stale summaries.

## Stored Shape

Add a latest-summary table keyed by `team_id` and `entity_id`, plus an internal
run history table.

The latest summary should store structured JSON and rendering metadata:

- `overview`
- `currentState[]`
- `openQuestions[]`
- `conflicts[]`
- `plainText` for search/chat/indexing
- normalized `sourceRefs`
- `status`: `missing`, `pending`, `ready`, `stale`, or `failed`
- `generatedAt`, `staleAt`, `lastAttemptedAt`
- `model`, `promptVersion`, `inputFingerprint`
- `sourceCounts`
- safe `lastErrorCode` / `attemptCount` for retry UX and operations

Run history should record attempts, status, model, prompt version, fingerprint,
duration, source counts, and sanitized error codes. It is for debugging,
observability, evals, and regression analysis; it is not a v1 user-facing
history view.

## Source Packet

Generation uses a curated source packet, not a raw dump of all object rows.

Packet ordering is deterministic and recency-weighted:

1. Canonical object fields.
2. Active/open tasks and important relationships.
3. Latest high-confidence facts, ordered by source event time and extracted
   time.
4. Older identity/background facts that still define the object.
5. Recent notes.
6. Recent changes.

The packet builder returns `canGenerate` and a reason. V1 should allow
generation when the object is not merged and at least one is true:

- 2+ team-visible linked facts.
- 1+ team-visible linked fact plus one meaningful object field beyond
  name/type/status.
- 1+ object note with meaningful body text.
- 1+ open linked task plus 1+ fact, note, or relationship.
- 2+ meaningful relationships or recent changes.

Do not generate when the packet only contains name, type, aliases, status, or
empty relationships.

## Generation

Object summary generation goes through the shared inference layer in
`packages/shared`, using the summarization model purpose and structured output
validated by Zod. App and worker code must not call provider SDKs directly.

The model receives source IDs and source classes, then returns structured
summary items with source refs. The worker validates that every returned ref:

- Exists in the source packet.
- Belongs to the same team and object context.
- Is eligible for team-visible persisted summary use.
- Matches an allowed source kind for the claim.

Unknown refs, missing refs on required items, or private/restricted refs reject
the run. A rejected run keeps the last good summary if one exists.

## Freshness

Automatic refreshes are background jobs attached to canonical write paths, not
page renders.

Summary state becomes stale when relevant canonical memory changes:

- New accepted facts or fact links for the object.
- Source event visibility/tombstone changes that affect eligible evidence.
- Object field updates, archive/unarchive, merge, or identity changes.
- Note create/update/delete.
- Relationship create/delete.
- Linked open task changes.
- Accepted object-memory suggestions.

Automatic jobs should use a short debounce, roughly 1-5 minutes, so bursts from
fact extraction, merges, or related writes coalesce. Manual generation/retry
from the object page enqueues the same worker path immediately, subject to
dedupe and locks.

While stale, the UI keeps showing the last good summary with subtle updating
metadata. Do not blank the panel unless regeneration proves there is no longer
enough eligible source material or the object lifecycle invalidates the summary.

## Object Lifecycle

When objects merge, the survivor summary is marked stale and regenerated after
canonical rows are reassigned. The losing object's summary is not shown after
redirect. Historical run rows may remain internal for debugging.

When eligible sources are deleted, hidden, tombstoned, or become no longer
team-visible, any summary that cited them must be invalidated and regenerated
from remaining eligible sources. If the remaining packet is insufficient, the
generated prose disappears and the empty state returns.

## Search And Chat

Summaries ship to object page, search, embeddings, and chat in the same feature
slice.

- Search indexes summary text as derived object content that boosts the object
  result and improves snippets. Summaries are not separate search result types.
- Summary generation refreshes the existing object embedding payload instead of
  creating a separate summary vector scope.
- Chat/retrieval may include the compact summary and source refs as object
  overview context.
- Chat answers should cite the underlying facts, events, notes, tasks, or
  relationships when making factual claims. The summary is routing/compression
  context, not terminal evidence.
- Summaries never become new facts and never replace source citations.

## Implementation Slice

Build the complete foundation first, with staged trigger coverage when a path is
hard to centralize.

1. Add `object_summaries` and `object_summary_runs`.
2. Add the source packet builder, sufficiency checks, and citation-ref types in
   `packages/shared`.
3. Add an object-summary queue/job or extend the queue module with a dedicated
   job kind, including debounce, dedupe, locks, retries, and run metadata.
4. Add worker generation with structured output, citation validation, failure
   handling, and object embedding refresh.
5. Add object-page server action for `Generate summary`, `Retry`, and stale
   refresh enqueueing.
6. Add the summary panel above Evidence/Facts.
7. Feed saved summaries into object search snippets/ranking and chat retrieval
   packets.
8. Attach automatic enqueueing to high-confidence canonical write paths first:
   fact extraction/linking, object field updates, notes, relationships,
   merge/archive, and accepted object-memory suggestions.
9. Track harder invalidation paths explicitly until fully wired: remaining
   indirect task relationship updates and deeper source-chip navigation.

## Quality Gates

The first implementation should prove these cases:

- Newer confirmed facts supersede older tentative facts.
- Sparse objects do not get fake summaries.
- Private or restricted evidence never appears in persisted team summaries.
- Note, fact, field, relationship, merge/archive, and source visibility changes
  mark or enqueue summary refresh.
- Manual generation and retry show pending, complete, and failed states.
- Invalid model citations fail closed.
- Search returns the object for summary matches without creating duplicate
  summary results.
- Chat can use the summary as overview context while citing underlying sources.

Add at least one realistic DFK-style eval fixture with dates, proposal
materials, pricing-split discussion, and superseded tentative meeting slots.
