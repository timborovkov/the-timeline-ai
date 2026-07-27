# Direct chat surfaces share one agent runtime

## Status

Accepted.

## Context

Telegram and Slack started as capture surfaces. Their direct-message behavior
diverged from web chat and from each other: a plain DM was captured as evidence,
agent questions needed provider-specific commands, Telegram team discovery
depended on routing rows, and agent execution happened too close to webhook
lifetimes. That made slow or lost replies difficult to recover and encouraged
future providers to add provider-specific session state.

Direct conversations and shared group contexts have different intent. A person
who opens a private conversation with Timeline expects an agent. A channel or
group is shared evidence unless someone explicitly invokes the agent. Files and
media remain captured source material in either context.

## Decision

All direct conversational providers use the shared conversation-surface
runtime.

- Plain text in a verified direct message is an agent turn.
- An explicit note command captures text without invoking the agent.
- Voice, images, documents, and other attachments always enter ingestion.
- Group and channel text remains ingestion-first; `/ask` or the provider's
  mention mechanism invokes a stateless agent answer.
- `/ask` remains a backward-compatible alias in direct messages.

The shared runtime owns session links, the durable turn ledger, idempotency,
per-conversation concurrency, rate limits, bounded private history, agent
execution, timeout behavior, transcript persistence, and cached-answer
delivery. Provider adapters own authentication, identity proof, eligible-team
discovery, direct-versus-group classification, commands, attachment ingestion,
reactions, progress, and replies.

`chat_sessions.surface` is text, and
`chat_surface_session_links.external_conversation_key` is opaque. A provider
chooses a stable non-secret key without requiring a schema migration. Telegram
uses `dm:<chat-id>`; Slack uses
`workspace:<workspace-id>:dm:<channel-id>`.

Agent turns execute on the `conversation-agent` BullMQ queue. The webhook
authenticates, resolves identity/team, inserts a queued turn idempotently,
enqueues its UUID as the deterministic job id, acknowledges progress, and
returns. Slack does not wait for profile refreshes or reaction delivery after
the durable enqueue, so slow Slack API calls cannot consume its webhook
acknowledgement budget. Telegram's request-side typing heartbeat remains active
while the turn is queued, then hands progress ownership to the worker when it
claims the turn. The worker's 90-second deadline includes provider progress
startup, history loading, and model execution.

Duplicate detection, per-user rate enforcement, session selection, and turn
insertion use coordinated transaction locks. Provider redelivery is checked
before session mutation, while reset, team-switch, membership-removal, and web
archive paths use the same conversation lock and cancel undelivered work. The
worker persists successful or canonical failure answer text and the web-visible
transcript before provider delivery. A delivery retry uses the cached answer,
and retained failed BullMQ jobs are replaced on provider redelivery without
bypassing the turn ledger. A turn found in an ambiguous stale `processing`
state fails closed rather than repeating a potentially paid model call.

History is private to the session creator and team, limited to 20 text messages
and 30,000 characters, excludes tool payloads, and replays through a durable
message sequence rather than timestamp ties. The sequence migration explicitly
backfills existing messages by session, creation time, and id before enabling
the insert default. Switching teams archives and unlinks the active provider
session in the same transaction as the routing change. Membership removal and
web archival perform the same cancellation and cleanup, so a provider's next
DM starts cleanly rather than remaining busy on stale work.

Conversation failures cross logging and Sentry boundaries only after error
redaction. Database errors can contain bound parameters, so raw exceptions
from question, transcript, or answer persistence are never emitted as
operational telemetry.

Telegram eligible teams are all current Timeline memberships for the verified
Timeline user. Slack eligible teams are current memberships intersected with
teams enabled for that Slack workspace. Provider routing rows record the
selection; they do not define eligibility. Slack team discovery uses the
verified identity even when its old active route has become ineligible, so the
user can recover by choosing another eligible team.

## Adding another provider

A new provider supplies:

1. verified identity and eligible-team resolution;
2. active-team routing;
3. direct-versus-group classification and command parsing;
4. attachment ingestion;
5. stable external conversation, event, message, and user keys; and
6. a delivery adapter for acknowledgement, progress, answer, and failure.

It reuses the existing session-link and turn tables, queue, history limits,
timeout, idempotency, transcript persistence, and web chat history.

## Consequences

Direct text changes from implicit capture to agent-first behavior on Telegram
and Slack. Users who want a note use `/note` on Telegram or
`/timeline note` on Slack. Provider-created conversations appear in web chat
history with a provider marker and can continue there.

The worker needs Telegram's bot token because Telegram replies and typing
heartbeats now outlive the webhook request. Slack worker delivery reconstructs
the adapter from the encrypted installed-workspace token. Classic Slack DMs use
the thinking reaction as their durable progress signal; optional Slack
Assistant status remains an adapter capability and does not change the shared
runtime.
