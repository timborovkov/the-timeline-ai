# Object Relationships Implementation Plan

Object relationships and connected work are the next object-memory slice. The
goal is to make object detail pages useful before every durable edge has been
accepted, then improve proposal quality for the relationships and duplicate
objects that should become shared memory.

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
- Connected Work is separate from Object Relationships: it is computed from
  current source-backed evidence so object pages can show tasks, calendar
  events, boards, fact-backed people/object context, documents, timeline
  moments, and pending approvals around the object before durable memory is
  accepted.
- Duplicate Object Candidates can use object evidence, especially for
  short-name, acronym, and company-suffix variants. A rejected object pair
  should stay suppressed.
- Memory Repair is user-triggered proposal generation around an object or
  connected work area. It may search team-wide evidence, but returned proposals
  should stay focused on the object the teammate asked Timeline to repair. The
  first implementation queues object-scoped duplicate cleanup, low-signal
  archive cleanup, fact-backed `related` relationship proposals, and bundled
  full-name person-object creation when relationship-shaped evidence names a
  durable person.

## V1 Scope

1. Add a live Connected Work surface to object detail pages. It should show
   source-backed tasks, calendar events, fact-backed people/object context,
   boards, pending approvals, recent task history, timeline moments, and
   documents that materially involve the object without presenting those items
   as accepted object relationships. Open tasks and follow-ups should be
   prominent; completed or cancelled work should remain available as recent
   history without competing with active work.
2. Use supporting object evidence to drive higher-quality duplicate object
   candidates, including acronym/short-name cases such as `DFK` and `DFK
   Finland Oy` when facts, notes, or accepted relationships support identity.
3. Suppress rejected duplicate object candidate pairs by pair identity, not only
   by one suggestion's exact evidence hash.
4. Add an object-centered Memory Repair action that queues focused duplicate,
   low-signal archive, fact-backed relationship proposal generation, and
   conservative full-name person-object relationship bundles for the selected
   object.
5. Extend the suggestion worker schema and prompt so background suggestions can
   emit `object_relationship` items.
6. Use extracted facts as candidate input and bounded raw/conversation context
   as verification input.
7. Keep proposal precision high: require relationship-shaped evidence, visible
   citations, and no accepted, pending, or rejected equivalent edge.
8. Support proposal bundles that create missing endpoint objects and the
   relationship together when each endpoint independently qualifies as durable
   information.
9. Surface accepted and pending relationships on both existing endpoint object
   pages, with relationship activity and nearby object evidence available while
   cited per-edge explanations wait for the later graph/mind-map view.
10. Replace manual UUID linking on object detail pages with object search/select.
11. Keep the full graph/mind-map view out of this slice; revisit after real
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
- Duplicate object candidates are deduped and rejection-suppressed by sorted
  object pair after resolving merged-object targets.
- Short-name and acronym duplicate candidates require supporting object
  evidence; bare name similarity is not enough for aggressive three-letter
  matches.
- Rejected relationship proposals suppress identical future proposals by sorted
  endpoint pair. Reprocessing, model wording drift, repeated evidence, or small
  confidence changes must not automatically reoffer the same edge.
- Later evidence may support a different endpoint resolution, but the exact
  rejected pair stays suppressed unless a teammate manually creates it.
- Missing person-object repair only creates full-name person candidates from
  relationship-shaped facts. Bare first names remain evidence until a stronger
  person identity exists.

## Out Of Scope

- Full organization graph or mind-map view.
- Endpoint retargeting inside the approval UI.
- Domain-specific relationship ontology such as `works_at` or `represents`.
- Automatic relationship proposals from document chunks or OCR-heavy media,
  except later explicit high-confidence cases.
