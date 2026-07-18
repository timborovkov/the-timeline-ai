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
approval contracts. For canonical tasks, the classifier reads only a bounded
team-visible task packet and an accepted primary-project relation; it cannot
create relationships. A task approval may carry a precomputed category plus a
proposed existing/new project. Neither becomes canonical before acceptance.
Acceptance applies the proposed category immediately only when its taxonomy and
exact task/project input hash still match; otherwise ordinary asynchronous
classification remains authoritative.

A task's optional primary project is durable relationship state, represented as
`task -> project` with relationship kind `child`. It is an explicit user or
approval-backed mutation, limited to one active project at write time, and is
separate from functional category. Board membership, co-mention, title similarity,
and category are never project ownership.

Database compatibility triggers canonicalize legacy inverse project edges during
rolling deploys and reject a second active project edge, including one introduced
by changing a related object's type to `project`. Category-filtered pages compare
transactional per-category revision rows and use a bounded pending lookup, so
refresh does not depend on web and worker wall clocks or scan every matching task.
When a valid type promotion turns a task's sole generic child edge into its primary
project, the automatic category input is invalidated and requeued with that project
context.

A background task proposal may name one existing project or propose creating one
clearly named project from the same evidence. The approval preview exposes both
fields for correction. Accepting the task validates team/type/lifecycle boundaries,
creates or reuses the project idempotently, and writes the single task-to-project
edge. A human category edit becomes `manual`; a project edit invalidates an
automatic precomputed category so stale context cannot be silently accepted.
Archived tasks defer automatic work, so unarchiving recomputes the current
task/project packet and requeues classification only when that input changed.

Every task-proposal producer uses this same category/project contract.
`suggest_task` and task-shaped `suggest_object_memory` proposals resolve an
existing active project or a clearly named project-to-create before requesting
the category preview. Background extraction classifies up to its maximum 25
proposed tasks in one bounded structured LLM call rather than serializing one
provider call per task. The batch must return one prediction per stable proposal
key; missing or invalid predictions leave that proposal uncategorized so ordinary
post-acceptance classification can recover safely.

Pending approvals created before the primary-project contract may contain a
`parentObjectId` for a non-project object. Acceptance keeps those durable rows
actionable by recreating the legacy generic `task -> object` child relationship.
It does not reinterpret that object as a primary project. New proposal tools only
offer active projects or a project-to-create, so the compatibility path cannot
introduce new ambiguous project ownership.
