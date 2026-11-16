# Product brief

Timeline turns selected work evidence into cited answers and approval-backed records. Teams capture conversations, notes, meetings, files and provider activity without maintaining another status-reporting system.

## Who it serves

Teams whose work is spread across conversations and operational tools: client delivery, agencies, consultancies, product and operations. The useful unit is a project, customer, task or decision with inspectable history, not a feed of every available notification.

## Product contract

- Capture should be low-friction and intentional; connecting a provider does not authorize indiscriminate collection.
- Source attribution, time and visibility survive ingestion and retrieval.
- Answers explain what the evidence supports and cite it. Missing visible evidence is not proof that something never happened.
- Canonical proposed changes wait for authorized approval. Human-owned fields and private information keep their boundaries.
- Documents provide reference knowledge; captured events provide work history. Neither should be copied into competing sources of truth.
- Generated updates should reduce repeated reporting, not create another feed requiring attention.

## Scope and non-goals

Current feature behavior belongs in the [domain contracts](README.md); open outcomes belong in [the roadmap](../todo.md). Timeline does not promise universal integration coverage, arbitrary historical imports, collaborative document editing, or end-to-end encryption incompatible with server-side inference. External-account and rollout gates remain explicit.

## Success criteria

Pilot evidence should establish fast text/voice capture, relevant cited answers, useful current object state, correct-version document retrieval, and first-day usefulness for a new member. Targets are experiments, not achieved performance claims. The roadmap owns the pilot measurement work.

## Constraints

Capture volume, model cost, provider latency and visibility-safe retrieval constrain the experience. Claims must remain bounded by [security evidence](security-gaps.md). [The memory engine](relational-memory.md) explains processing; [design](../design.md) owns interaction rules; [setup](setup/local.md) owns developer onboarding.
