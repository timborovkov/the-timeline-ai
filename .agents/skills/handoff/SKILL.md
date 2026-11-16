---
name: handoff
description: Prepare a saved, self-contained handoff for another session or agent. Run only when explicitly asked for a handoff or follow-up prompt, not for ordinary status or next-step questions.
disable-model-invocation: true
---

## Timeline repository contract

Read root `AGENTS.md` and path-scoped instructions first. Their Bun-only commands,
validation gates, operational exemptions, privacy rules, and authorization scope
override generic examples below. Load this skill by reading its file if the client
has no Skill tool. Never assume local-machine tools, credentials, or global skills
exist in a cloud checkout.


# Handoff

This is an explicitly invoked command, packaged as a skill for portability.
Prepare context for the next session; do not automatically merge, push, run a
release documentation sweep, or launch agents.

Inspect the current worktree, relevant diff, and available validation evidence.
Record branch/base state and unresolved upstream drift without requiring a sync.
Distinguish completed, verified, unverified, and blocked work. Do not run broad
checks merely to write a handoff; include the checks the next session needs.

Default to one concise handoff. If the user requests multiple follow-ups, split
only independently startable work and identify dependencies. Do not ask for an
agent count unless it materially affects a requested multi-agent plan.

Include the sections that help the next agent:

- Context: objective, current branch, what changed, and relevant upstream decisions.
- Read first: a few concrete paths and why they matter.
- Remaining work: deliverables, constraints, decisions still needed, and exclusions.
- Verification: commands already run and results, plus checks still needed.
- First action: the concrete next step.

Preserve the user's requested destination. Otherwise save to
`.agents/handoffs/<task>.md`, avoiding secrets and unrelated changes. Use an existing
repository handoff convention if present. Do not commit the handoff unless requested.
For a short inline handoff request, return the prompt directly instead.

Launch follow-up agents or create chats only when explicitly requested, using the
available environment's tools. Otherwise report the saved path and next action.
