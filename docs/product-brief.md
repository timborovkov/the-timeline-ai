# Product brief

Timeline turns selected work evidence into cited answers and approval-backed records. Teams capture conversations, notes, meetings, files and provider activity without maintaining another status-reporting system.

## Who it serves

Teams of people and AI agents whose work spans conversations and tools. A project, customer, task or decision gives people a useful place to inspect the history.

The first outreach hypothesis is the customer-facing cofounder whose partner leads engineering. Before a customer conversation they need to find what changed in delivery and what still needs following up. A product lead with the same responsibility is a secondary hypothesis. These are starting points for direct pilots. The product serves teams across roles and workflows.

## Product contract

- Capture should be low-friction and intentional; connecting a provider does not authorize indiscriminate collection.
- Source attribution, time and visibility survive ingestion and retrieval.
- Answers explain what the evidence supports and cite it. Missing visible evidence is not proof that something never happened.
- A concrete problem reported in the team’s work can produce a task proposal before anyone commits to fixing it. Eligible routine changes can apply automatically through workspace policy. Other changes wait for authorized review. Human-owned fields and private information keep their boundaries.
- Documents provide reference knowledge; captured events provide work history. Neither should be copied into competing sources of truth.
- Generated updates should reduce repeated reporting, not create another feed requiring attention.

## Scope and non-goals

Current feature behavior belongs in the [domain contracts](README.md); open outcomes belong in [the roadmap](../todo.md). Timeline does not promise universal integration coverage, arbitrary historical imports, collaborative document editing, or end-to-end encryption incompatible with server-side inference. External-account and rollout gates remain explicit.

## Success criteria

Start pilot learning with real questions about ongoing work. Observe where a team gets useful cited context, which sources it can connect, and what still requires searching or asking a colleague. Define formal measures after pilot learning. The roadmap owns recruitment and open work.

## Constraints

Capture volume, model cost, provider latency and visibility-safe retrieval constrain the experience. Claims must remain bounded by [security evidence](security-gaps.md). [The memory engine](relational-memory.md) explains processing; [design](../design.md) owns interaction rules; [setup](setup/local.md) owns developer onboarding.
