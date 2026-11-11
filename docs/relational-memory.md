# Operating memory engine

Timeline preserves selected source evidence, retrieves it under the viewer's visibility, and proposes changes to durable workspace state. This document owns the current processing and authority model. [Domain ownership](architecture/ownership.md) maps code, [ADRs](adr/README.md) explain decisions, [rollout gates](cross-source-evidence.md) control evidence-pack promotion, and [the roadmap](../todo.md) owns unfinished work.

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

Do not assume all proposal adapters use packs. The builder is implemented with a default-off proposal rollout; generic-webhook modes and the remaining conversation adapters have separate gates. [Evidence rollout](cross-source-evidence.md) is the sole owner of mode semantics, bounds, thresholds, samples and approved copy. Curated chunks and pulses can only support appropriately related proposals when their adapter is admitted.

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
| New Timeline object | Human create | Communication / unstructured captured-work proposal |
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

First-run scanning captures up to five public same-origin pages through Firecrawl after the user confirms permission. Firecrawl is the only crawler; failures do not fall back to an in-house fetcher. Each page becomes a cited `source: web` event and a versioned Markdown document; extraction and suggestions use existing pipelines, with canonical changes requiring approval.

Reserve up to five accepted-source units before enqueue, recheck admission before crawling, and settle returned pages once. Downstream inference uses the AI meter. Immutable `website_sources` snapshots let retries reuse identical bytes; scan IDs scope retries, source lists and atomic onboarding completion.

[Local setup](setup/local.md) and [Railway](railway.md#environment-variables) own credentials; [live evaluation](testing/README.md#live-website-scan) owns verification. [Provider controls](providers.md) and [support deletion](setup/manual-support-deletion.md) cover retention and erasure.
