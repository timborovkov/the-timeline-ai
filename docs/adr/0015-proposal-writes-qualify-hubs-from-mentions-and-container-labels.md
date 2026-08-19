# ADR 0015 — Proposal writes qualify hubs from unique mentions and container labels

Canonical engine narrative:
[`docs/relational-memory.md`](../relational-memory.md). This ADR records the
write-path qualify decision. It does not replace the living workflow.

## Status

Accepted.

## Context

Ask retrieval already recalls companies, projects, and tasks with embeddings.
Proposal writes were still attaching client/project hubs from a recency dump of
workspace objects, or leaving tasks bare when the model did not emit
`parentObjectId`. That fails multi-client teams: a Slack channel named
`acme-project-development`, a Monday board named `Faba-ext`, or a meeting titled
"Faba weekly" is enough for a human to know the account, but the write path did
not treat those container labels as qualify evidence.

ADR 0004 already forbids semantic similarity as the join for conversational
proposals. ADR 0003 keeps inferred object memory approval-backed. ADR 0006
keeps company/vendor/deal links on `object_relationship` `localRef` edges.
This ADR freezes how a proposal **qualifies an existing hub** before the
approval bundle is stored.

## Decision

Communication proposal writes qualify an existing company, vendor, deal, or
project only when the evidence **uniquely names it**. Captured-work writes join
on provider id, alias, or a unique `repo#n` title. Embeddings recall. They do
not prove a write.

Qualify evidence is the event text plus cheap envelope labels:

- canonical name, alias, or a distinctive token (`Faba` in `Faba website
  redesign`);
- meeting / email titles (`meeting_title`, `title`, `subject`);
- **container labels**: Slack channel name, Telegram chat title, Monday board /
  item-board / workspace name, GitHub repo, Linear team/project name.

Generic tokens (`general`, `development`, `project`, `website`, `meeting`,
`weekly`, `board`) never unique-match. Two hits of the same hub type refuse
rather than guess. A mixed channel such as `acme-faba-shared` that names two
companies attaches neither company.

Edges after a unique qualify:

- unique **project** → `proposedPayload.parentObjectId` (primary project only);
- unique **company / vendor / deal** → `object_relationship` `kind=related`
  from the new task `localRef`;
- later conversation in the same window may **amend an unedited pending
  create in place** when it uniquely names a hub. User-edited pending items
  are skipped. Accepted unscoped tasks are not silently rewritten.

Core code reads documented envelope keys and already-persisted nested adapter
blobs (`github.repo`, `linear.team.name`). It must not grow
`if (provider === 'slack')` / `if (provider === 'monday')` qualify branches.
Adapters stamp container labels onto the envelope. Flattening remaining nested
blobs onto the documented keys is allowed; cosine-as-write is not.

There is one living engine narrative:
[`docs/relational-memory.md`](../relational-memory.md) Layer 6. New proposal
behavior updates that file in the same change as the code.

## Consequences

- Slack `#acme-project-development` uniquely qualifies the Acme project even
  when Acme is missing from the 40 most recently updated objects.
- Monday board `Faba-ext` uniquely qualifies Faba even when the item text never
  repeats the client name.
- `#general`, `#dev`, and boards named "Customer Projects" do not unique-match
  a hub whose only distinctive tokens are generic.
- Recency dumps remain prompt fill for disambiguation. They are not a join.
- Pairwise cosine qualify after vector recall stays a later, optional, still
  approval-backed slice. It is not this decision.

## Rejected alternatives

- **Cosine similarity as the write join:** rejected. Ask may recall; writes
  qualify.
- **Provider-specific qualify cores** (`if (provider === 'github')` in shared
  attach): rejected. Adapters may be specific; the qualify step reads envelope
  labels.
- **LLM-summarize every event so embeddings compare more fairly:** rejected.
  Cost and a second inference layer for prettier vectors.
- **A second numeric importance score:** rejected. `priority` 1–4 exists.
  Memory grade is a role, not a score.
- **Putting a company in `parentObjectId`:** rejected. That field is the
  primary project.

## Related documents

- [Operating memory engine](../relational-memory.md)
- [ADR 0003](./0003-object-memory-is-approval-backed-workspace-state.md)
- [ADR 0004](./0004-conversation-reviews-drive-conversational-proposals.md)
- [ADR 0006](./0006-object-relationship-proposals-use-bundle-local-refs.md)
- [ADR 0014](./0014-cross-source-evidence-packs-use-policy-bound-related-evidence.md)
