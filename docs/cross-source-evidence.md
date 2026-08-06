# Cross-source evidence — product brief

**Status:** north-star direction (not fully shipped)
**Audience:** product, eng, and website copy
**Last updated:** 2026-08-05

## The promise we sell

Timeline does not ask people to maintain another system of record. It watches
work as it already happens — chat, meetings, email, boards, tickets, docs —
and compiles that into cited memory and approval-backed updates.

The product story on the landing page and elsewhere should be:

> **One memory from every surface.** A commitment in Slack, confirmed on a
> call, tracked in Monday, and clarified by email becomes one cited record —
> not four disconnected tools.

That is the differentiation. Not “AI chat over your notes.” Not “another
integration sync.” **Compounding operational memory across the tools the team
already uses.**

## Why this matters

Today’s tools punish recording and then punish reporting. People discuss work
in Slack, decide it in a meeting, track it in Monday, and confirm it by email —
then reconstruct status by hand. Organizational memory leaks between surfaces.

Timeline’s job is to close that loop: capture each surface as evidence, relate
the evidence to the same real-world work, and propose durable changes only when
the story is solid enough for a human to accept.

## Current state (honest)

We already accumulate knowledge into the workspace (raw events, facts, objects,
embeddings, reconciliation). What we do **not** yet do for proposals is assemble
a true cross-source evidence pack.

| Path | What happens today |
| --- | --- |
| Slack / Telegram | Same chat/thread window. Other sources appear only when already object-linked, and only for disambiguation. |
| Email / meetings / docs | Mostly event-local: one event + recent chronology + existing workspace dump. |
| Monday / Linear / GitHub / Sentry | Structured sync → objects/reconciliation. Not a cross-source suggestion synthesizer. |
| Agent ask | Can retrieve across sources via semantic search. Closest to the ideal for *answers*. |

Proposals are still largely siloed by capture path. That is an intentional
v1 constraint (same-source-first conversation reviews; cost and quality
control), not the end state we sell.

Related ADRs: [0004](./adr/0004-conversation-reviews-drive-conversational-proposals.md),
[0005](./adr/0005-workspace-reconciliation-is-artifact-centered-and-approval-backed.md).

## Target architecture

Treat every durable proposal as an **evidence review** over a related set of
events, not a single-source prompt dump.

```text
chat / meeting / email / ticket / board / doc
        │
        ▼
   immutable raw evidence
        │
        ▼
 object-linked + retrieval-ranked
   cross-source evidence pack
        │
        ├── agent answers (cite pack)
        └── approval proposals (only if pack supports durable change)
```

### Rules that stay non-negotiable

1. **Cite only what the audience can see.** Visibility floors still win.
2. **Approvals stay human-gated** for durable object/calendar/board state.
3. **Raw source content stays immutable.** Derived memory can change; the
   capture cannot.
4. **Cross-source inclusion needs a relationship signal.** Start with
   object/entity links and explicit refs; add retrieval ranking next. Do not
   treat “same hour” or “same sender” alone as enough to propose.
5. **Integrations remain first-class evidence**, even when they do not call the
   suggestion LLM. Structured sync writes objects; evidence reviews should still
   be able to *cite* those events when chat/meeting/email implies the same work.

### What “good” looks like

Example: Slack says “I’ll send the Acme deck Friday.” Meeting confirms Friday
EOD. Monday item moves to Working on it. Email attaches the draft.

Timeline should:

- keep each capture as cited evidence
- relate them to the same Acme / deck work item
- propose one coherent update (task/date/status) with multi-source citations
- let a human accept once — not invent four parallel truths

## Website / landing messaging

Use language like this (adapt tone per page; keep the claim):

**Hero / brand line**

- Capture work as it happens. Timeline turns chat, meetings, email, and tools
  into one cited operating memory.

**Supporting sentence**

- When something is discussed in Slack, decided on a call, tracked in Monday,
  and confirmed by email, Timeline connects the evidence — then proposes the
  update for approval.

**Feature bullets**

- One evidence stream across Slack, Telegram, meetings, email, docs, and work
  systems
- Approval-backed memory — nothing durable becomes “true” without a review
- Answers and digests cite the sources, not vibes
- Integrations contribute structured state; conversations contribute intent;
  Timeline reconciles both

**Avoid claiming (until shipped)**

- Fully automatic CRM/project updates with no approvals
- That every suggestion already synthesizes all sources today
- That Timeline replaces every tracker on day one

**Safer present-tense framing while we build**

- “Timeline is built so every surface becomes evidence for the same memory.”
- “Ask already retrieves across sources; proposals are moving to the same
  cross-source evidence model.”

## Implementation direction

Order of work (product + eng):

1. **Evidence pack primitive** — shared builder that returns ranked, visibility-
   safe events related to an anchor (object links first, then retrieval).
2. **Conversation reviews consume the pack** — Slack/Telegram keep the same-
   thread core, but proposals may cite related meeting/email/integration events
   as supporting evidence (not only disambiguation).
3. **Event-local paths graduate** — email, meetings, and ingest webhooks use the
   same pack instead of “one event + last N by time.”
4. **Integrations as cited evidence** — continue structured `objectMap` /
   reconciliation for authority; ensure those raw events are pack-eligible when
   related work is proposed from chat/meeting/email.
5. **Eval + cost budgets** — hard pack size / token caps; live evals that score
   multi-source citation quality, not only single-thread extraction.
6. **Marketing alignment** — landing, product brief, and sales one-pagers use
   the promise above; changelog marks when pack-backed proposals ship.

Open roadmap item: expand the existing “cross-source evidence reviews” work in
[`todo.md`](../todo.md) beyond ingest webhooks to the full pack model.

## Success criteria

- A reviewer can open a proposal and see citations from **more than one surface**
  when the work truly spanned them.
- False merges stay rare: unrelated Monday noise does not ride into a Slack
  proposal without a strong link.
- Agent answers and Approvals share the same evidence-pack concept.
- Website copy matches shipped behavior within one release of each milestone.

## Non-goals for the first cut

- Semantic-only joins with no object or explicit relationship signal
- Auto-accepting cross-source state into canonical objects
- Replacing conversation reviews with unbounded “whole company context” dumps
- Per-provider special-case prompt piles instead of one pack builder
