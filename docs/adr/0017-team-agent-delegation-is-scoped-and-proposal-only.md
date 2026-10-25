# ADR 0017 — Team-agent delegation is scoped and proposal-only

## Status

Accepted; amended 2026-08-26 for member-authorized OAuth and scope-upgrade discovery.

## Context

Timeline exposes retrieval through static team bearer keys and member-authorized
OAuth, and runs the agent for verified web, Telegram, and Slack members.
External agents also need a way to ask Timeline to reason over its connected
workspace, including team-shared custom MCP tools, without granting the
delegated agent a human identity or direct mutation authority.

Bound Telegram groups and Slack channels have the same identity problem. An
unlinked sender may be trusted to invoke the team bot because the shared
conversation is explicitly bound to a Timeline team, but that sender is not a
verified member and must not inherit a binding owner's private data or personal
tools.

Custom MCP calls create another visibility boundary. A result from a
team-shared server should be reusable team evidence, while a result from a
personal server must remain private. A future policy change must not broaden a
historical private capture by reusing its dedupe identity.

## Decision

Timeline has three explicit agent tool modes:

- `full` for verified members;
- `proposal_only` for trusted synthetic team actors; and
- `read_only` for team actors that must not create proposals.

`proposal_only` can read team-visible workspace state, call enabled team-shared
custom MCP tools, and create new task, object-memory, object-change,
calendar-create, and calendar-update/cancellation proposals. Those proposals
are forced to team visibility and record the invocation surface, synthetic
actor kind, and outbound MCP key when present. The mode excludes proposal
revision, personal pins, approval-required `execute_*` tools, and every
canonical mutation. A proposal never implies acceptance; a verified teammate
must review it.

Outbound MCP read principals can list `timeline.ask_agent` so clients can
discover its `read agent:ask` security metadata. Call-time enforcement remains
independent: a current-protocol read-only OAuth grant receives HTTP `403` with
an `insufficient_scope` `WWW-Authenticate` challenge, while supported 2025
clients receive equivalent in-band compatibility metadata and a read-only
static key receives a stable forbidden result. A static key needs explicit
admin-enabled `agent:ask`; an OAuth grant needs approval from a current owner or
admin, and role demotion invalidates that scope. Authorized agent calls are
stateless and return a bounded cited answer, parsed artifact references,
proposal IDs, and a truncation flag. They execute as the zero-UUID team actor,
which cannot match private authors or specific-user visibility lists. OAuth
retrieval tools outside that delegated call execute as the consenting member and
retain the member's normal visibility boundary.

Unlinked senders in bound Telegram groups and Slack channels use the same
`proposal_only` identity. Linked members retain `full` behavior. Unlinked
direct messages remain rejected.

Successful team-shared MCP tool results are captured as immutable team-visible
raw-event evidence with a nullable synthetic author. Personal-server results
remain private to their owner. The v2 dedupe identity includes server scope and
owner, so it cannot collide with or update legacy private captures. Tool output
returns the captured event ID and citation for the current answer.

Timeline propagates `x-timeline-agent-depth` through its MCP client. The initial
agent and one nested Timeline-agent delegation are allowed; deeper direct
recursion fails with `delegation_limit`. Request cancellation propagates through
the agent and custom MCP calls, every turn has a 180-second deadline, and a
separate per-credential bucket limits agent calls to 10 per minute.

## Consequences

External agents can delegate workspace reasoning and proposal drafting to
Timeline without persistent MCP conversations or direct proposal-specific MCP
tools. The caller owns conversation context and includes it in later questions.

Administrators and consenting owners must understand that agent-enabled
credentials can consume model budget and that enabled custom MCP tools may have
their own external side effects. Timeline continues to honor each server's
enabled/disabled tool configuration; proposal-only authority governs Timeline
state, not third-party server design.

The synthetic identity is deliberately less capable than a verified member.
Future surfaces should reuse this mode instead of inventing provider-specific
prompts, visibility shortcuts, or mutation allowlists.
