# Object Relationships Implementation Plan

Object relationships are the next object-memory slice. The goal is to make
relationships visible, proposal-backed, and useful on object detail pages
without shipping the full graph or mind-map view yet.

## Decisions

- Accepted object relationships are shared team memory.
- Agent-discovered relationships enter the approval queue; they do not become
  canonical until accepted.
- V1 automatic proposals create only `related` relationships.
- The generic `linked` kind should be collapsed into `related`; migrate any
  existing rows and remove `linked` from UI/tool inputs.
- `related` is symmetric in product behavior. Canonicalize related edges by
  sorted endpoint UUIDs after resolving any local refs.
- Direction remains meaningful for directional kinds such as `blocks`,
  `blocked_by`, `parent`, and `child`.
- Relationship nuance belongs in cited facts, notes, or source evidence. The
  edge says which objects are connected; evidence explains why.
- Team-visible relationship proposals must be backed by team-visible evidence.

## V1 Scope

1. Extend the suggestion worker schema and prompt so background suggestions can
   emit `object_relationship` items.
2. Use extracted facts as candidate input and bounded raw/conversation context
   as verification input.
3. Keep proposal precision high: require relationship-shaped evidence, visible
   citations, no accepted/pending equivalent edge, and no recent rejected
   equivalent without materially new evidence.
4. Support proposal bundles that create missing endpoint objects and the
   relationship together when each endpoint independently qualifies as durable
   information.
5. Surface accepted and pending relationships on both existing endpoint object
   pages, including cited evidence for why the edge exists.
6. Replace manual UUID linking on object detail pages with object search/select.
7. Keep the full graph/mind-map view out of this slice; revisit after real
   relationship data exists.

## Bundle-Local References

Relationship proposals may refer to endpoint objects created by sibling items
in the same approval bundle.

- Create-object item payloads may include `localRef`, for example
  `{ "type": "person", "canonicalName": "John Doe", "localRef": "john-doe" }`.
- Relationship item payloads use `fromEntityId` / `toEntityId` for existing
  endpoints and `fromRef` / `toRef` for sibling-created endpoints.
- `localRef`, `fromRef`, and `toRef` are internal approval plumbing and should
  not be copied into canonical object metadata.
- Refs are scoped to a single suggestion bundle and must be unique inside that
  bundle.
- The approval UI should render resolved endpoint names, not local ref strings.

## Acceptance Rules

- `Accept all` applies object create items before relationship items so refs can
  resolve to accepted sibling item result IDs.
- Accepting a relationship line item by itself only succeeds when every ref
  endpoint already resolves to an accepted sibling result.
- Accepting a relationship line item must not silently accept dependent create
  items.
- Rejecting or superseding a dependency should make the dependent relationship
  item non-actionable rather than treating the relationship itself as rejected.
- Relationship refs resolve only within the same suggestion bundle.

## Dedupe Rules

- `related` relationships are deduped by sorted endpoint pair.
- Proposal dedupe should use the same sorted pair once refs can be resolved or a
  stable bundle-local pair when refs are still pending.
- Rejected relationship proposals suppress identical future proposals unless new
  evidence materially changes the proposal.
- Materially new evidence includes a clearer later raw event, repeated evidence
  across events, better endpoint resolution, or an explicit user correction.
- Reprocessing the same event, model wording drift, or small confidence changes
  are not materially new evidence.

## Out Of Scope

- Full organization graph or mind-map view.
- Endpoint retargeting inside the approval UI.
- Domain-specific relationship ontology such as `works_at` or `represents`.
- Automatic relationship proposals from document chunks or OCR-heavy media,
  except later explicit high-confidence cases.
