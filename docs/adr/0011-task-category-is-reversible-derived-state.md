# Task category is reversible derived state

Task category is a first-class, team-visible field on canonical task objects,
but it is not source-authored evidence or business lifecycle state. The product
may therefore apply one LLM-selected functional category asynchronously without
an approval. Automatic assignment must be reversible, inspectable in assignment
and object-change history, and prevented from overwriting a human override by a
requested-input hash and explicit `automatic`/`manual` authority mode.

This exception does not broaden agent write authority. Category cannot assign a
person, change status, priority, due date, access, notifications, or external
workflows. Those remain canonical changes under their existing direct-edit or
approval contracts. The classifier reads only a bounded team-visible task packet
and an already accepted primary-project relation; it cannot create relationships.

A task's optional primary project is durable relationship state, represented as
`task -> project` with relationship kind `child`. It is an explicit user or
approval-backed mutation, limited to one active project at write time, and is
separate from functional category. Board membership, co-mention, title similarity,
and category are never project ownership.
