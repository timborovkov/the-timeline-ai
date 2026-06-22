# Ingest Webhooks Plan

Ingest webhooks are team-managed capture surfaces for arbitrary textual
external payloads. They are evidence-only: webhook events can support search,
answers, and approval-backed proposals, but only native integrations may become
authoritative sources that directly update canonical workspace state.

## V1 Scope

- Team admins can create named ingest webhooks, such as "Pipedrive webhook".
- Each webhook has one or more credentials over time. Rotating a credential
  preserves the named source shown on the timeline.
- Webhook credentials may be used as secret URL tokens or bearer credentials.
  Store only credential hashes; show plaintext only when created or rotated.
- Webhooks accept textual request bodies: JSON, XML, form-encoded, CSV,
  NDJSON, plain text, and unknown text-like content types.
- Direct file and binary capture are out of scope for v1 and should use future
  source-file flows rather than being packed into raw event text.
- Raw event `occurred_at` is the Timeline receipt time. Provider-reported event
  times remain evidence that extraction may interpret.
- Events are team-visible by default, configurable per webhook for future
  captures only.
- Proposal generation is configurable per webhook and defaults on. V1 proposals
  are event-local: generated from one raw event plus extracted facts, recent
  context, and existing workspace state.

## Intake Behavior

- `POST` creates source evidence.
- `GET` may return a non-ingesting setup/verification response for a valid
  secret URL, but must not create raw events.
- Invalid or revoked credentials return an auth failure without exposing source
  details.
- Unsupported binary/file payloads return `415`.
- Oversized textual payloads return `413`.
- Rate-limited payloads return `429`.
- Once a raw event is durably saved, return success even if downstream
  extraction, embedding, or proposal enqueue fails.
- New accepted events should return `202 Accepted`; duplicate deliveries may
  return `200 OK` and re-enqueue downstream processing for the existing raw
  event.

## Evidence Semantics

- Each distinct webhook delivery is a separate immutable raw event.
- Identical repeated deliveries from the same webhook inside a short dedup
  window are duplicate deliveries and should not create additional raw events.
- Distinct same-webhook deliveries that arrive close together are ingest
  webhook bursts. Preserve each delivery, but allow timeline display and future
  evidence review to group the burst as one source moment.
- Source deletion, disabling, revocation, or rotation must not delete, merge, or
  hide prior raw events.
- The webhook owner is the initial visibility owner for events from that
  webhook, even when the payload describes an external sender.
- If a webhook owner leaves the team, disable webhooks they own, revoke active
  credentials, widen any private future default back to team visibility, and
  widen that webhook's existing private captured evidence to team visibility
  before clearing the owner.
- Sender identity is interpreted from evidence by AI/extraction, not mapped by a
  required provider schema.
- Treat payload text as untrusted external content in model-facing extraction
  and proposal prompts; sender-authored instructions inside the payload are
  evidence, not agent instructions.

## Management UI

- Place management in Team integrations / Connections as an "Ingest webhooks"
  section, not in MCP share.
- Show endpoint URL, credential prefix, last used time, visibility default,
  proposal generation default, disabled state, and copyable setup examples.
- Admins can rename, disable, rotate credentials, and revoke credentials.
- UI copy should set expectations: "Send any textual webhook payload; Timeline
  stores the payload as evidence and uses AI to interpret it."
- Redact sensitive headers and raw delivery metadata in normal timeline display.

## Proposal Behavior

- Evidence-only webhook events may still generate approval-backed proposals.
- Webhook v1 uses the existing event-local background proposal path.
- Disabled webhooks must skip already-queued proposal work for existing events;
  disabling is also an instruction to stop future LLM proposal extraction for
  that source.
- Burst-heavy periods may skip suggestion enqueue for excess events and keep
  those events search-only until a broader evidence-review feature exists.
- Cross-source synthesis, such as combining Pipedrive events with Telegram
  discussions and emails before proposing a task with due-date context, needs a
  future evidence-review mechanism.

## Non-Goals

- No provider-specific schema configuration in v1.
- No direct canonical workspace updates from generic webhooks.
- No generic file/binary upload intake in v1.
- No semantic deduplication across changed payloads.
- No broad cross-source evidence review in v1.
