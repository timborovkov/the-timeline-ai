# Object memory is approval-backed workspace state

Canonical engine narrative:
[`docs/relational-memory.md`](../relational-memory.md). This ADR records the
decision, not the living workflow.

The agent's durable memory lives in visible workspace state, not in a hidden
agent notebook. When the agent learns durable information about people,
companies, tasks, deals, calendar commitments, projects, or other first-class
workspace items, it records an approval-backed proposal against the relevant
object or surface; the change becomes canonical only after a teammate accepts
it. Sender identity is resolved as a derived association from preserved source
metadata and approved person-object identity facets, so raw events remain
immutable while retrieval can improve as the team approves better object memory.
