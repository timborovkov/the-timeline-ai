# WhatsApp capture proposal

> **For Hermes:** Use the existing conversational-surface runtime and implement this plan in small, independently reviewed commits.

**Goal:** Add an official WhatsApp Business Platform Cloud API capture surface that can ingest Timeline-managed WhatsApp Groups API groups and opt-in direct messages. Verified DMs reuse Timeline’s durable conversation-agent runtime; explicit group `/ask` requests use a separate durable, stateless group-ask ledger so shared content never becomes a private chat transcript.

**Architecture:** WhatsApp is a first-party conversational capture surface, parallel to Telegram and Slack—not a generic native-provider sync. A verified Meta webhook receives forward-only events, the WhatsApp adapter resolves the receiving business number to exactly one Timeline team, persists immutable `raw_events`, and reuses existing attachment, extraction, embedding, timeline-moment, and conversational-agent primitives. Direct WhatsApp text is agent-first only after an explicit Timeline-account identity link; group text is ingestion-first and invokes the agent only for an explicit command from a linked member. Both delivery paths pass `whatsapp` as the current surface and inherit the shared `external_chat` profile; the adapter must not add its own answer prompt or citation sanitizer.

**Tech stack:** Next.js App Router, TypeScript, Drizzle/Postgres, BullMQ, S3-compatible attachment storage, existing `@timeline/shared` capture/conversation-surface modules, Meta WhatsApp Business Platform Cloud API.

---

Status: proposed, not a shipped capability. Revalidate Meta eligibility and policy before implementation. [The roadmap](../todo.md) owns prioritisation.

## Product decision, scope, and non-goals

### What we will ship

1. A customer-owned WhatsApp Business Account (WABA) business number maps to one Timeline team.
2. A Timeline admin can create or bind a **Groups API-managed** WhatsApp group, choose a Timeline visibility default, and inspect/disable the binding.
3. New supported group and DM messages are captured from activation onward as immutable evidence with sender, group, business-number, and WhatsApp-message provenance.
4. An explicitly invoked group `/ask …` from a linked Timeline member queues a reply to that group. A verified direct-message user can converse with the agent through the shared conversation-surface runtime.
5. Text, supported documents/images/audio, delivery statuses, deletion/edit-style provider events where available, and media-fetch failures are observable and safe to retry.

### Explicit non-goals for v1

- Importing or backfilling WhatsApp history.
- Reading arbitrary pre-existing consumer groups. The product flow must operate on Meta Groups API groups and disclose that limitation.
- Broadcasts, campaigns, recurring proactive notices, or a template-management UI.
- Auto-linking a WhatsApp `wa_id` to a Timeline user from a phone number, profile name, or email guess.
- Replacing Timeline’s visibility model with WhatsApp’s participant model.
- Treating a shared group as a private agent transcript or allowing ordinary group chatter to invoke paid model work.

### Platform and cost facts that constrain the design

- Meta’s Groups API supports group creation/management plus group text, media, and template messaging; group-message payloads carry a `group_id` and sender identity. [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/) · [Group messaging](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/) · [Group message webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/group/)
- Meta’s Groups API requires an Official Business Account (OBA) on the specific Cloud API business number. An OBA is not merely a WABA or a verified Meta portfolio: before applying, the business must comply with policy, be registered on the WhatsApp Business Platform for at least 30 days, have a verified owning business portfolio, enable two-step verification on the number, and have an approved display name. The application is made in WhatsApp Manager: **Overview → select business number → Phone numbers → Profile → Official business account → Submit Request**. If rejected, Meta permits a new request after 30 days; if the UI does not offer an application despite eligibility, escalate through Meta/solution-provider support. Groups are invite-only and limited to eight participants. [Official Business Accounts](https://developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts/) · [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/)
- Groups are unavailable for WhatsApp Business app phone numbers and Multi-solution Conversations numbers. The group pilot therefore needs a dedicated Cloud API business number, not a number already operating through the consumer/business app. [Groups API limitations](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/)
- Meta prices Cloud API on delivered template messages. Inbound messages and non-template replies within the 24-hour customer-service window are not charged; outside-window template pricing varies by category and recipient country. Group template sends are charged per delivered recipient. [WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/) · [Groups pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/pricing/)
- Inbound capture is forward-looking. Do not advertise a history import, because the webhook model cannot enumerate prior conversations. [Create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/)
- Opt-in, template policy, opt-out handling, and human escalation requirements apply. The initial reactive scope avoids proactive/template work by design. [User opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in/) · [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)

---

## Acceptance criteria

- A signed, duplicate Meta webhook for a bound Groups API group yields exactly one immutable WhatsApp `raw_events` row and never leaks it to another team.
- A message from an unbound group, unknown business number, malformed payload, invalid signature, or disabled binding produces no team-visible capture and safe operational telemetry only.
- A plain bound-group message is captured but never invokes the LLM. A linked member’s `/ask` message produces one durable group-ask ledger row and at most one provider reply under redelivery.
- A linked direct-message user receives a durable, private Timeline chat session through `conversation-surfaces`; an unlinked direct sender receives a safe linking instruction and no team data.
- Media bytes are fetched promptly, stored through the existing attachment pipeline, and failures remain retryable without mutating source evidence.
- The product never sends a free-form response outside the applicable customer-service window and never silently sends a billable template.
- The new source participates in timeline filtering, moment grouping, evidence labels, exports, retention/deletion behavior, source status, onboarding, audit logs, and support documentation.

---



## Required test matrix

| Area | Tests |
| --- | --- |
| Database | migration, enum, uniqueness, FK/cascade, idempotent source index |
| Webhook | GET challenge, valid/invalid HMAC, raw-body integrity, batch handling, malformed/unbound callbacks, redelivery |
| API | request shape, auth redaction, text vs template policy gate, media metadata/download failures |
| Dispatcher | number/group/team resolution, immutable raw events, metadata, status updates, attachments, group/DM moment keys |
| Conversation | account link/unlink, direct turns, group `/ask` ledger claim/lease/redelivery, no agent on ordinary group text, no private-session write for group content, queue retry/order/rate limit |
| UI/actions | admin authorization, audit logs, connection/bind/disable/revoke state, visibility selection, secrets absent from render |
| End-to-end | real Meta staging webhook through public TLS, Group API creation/invite, group and DM capture, media retrieval, one successful explicit reply, one service-window refusal |
| Regression | Telegram and Slack conversational capture/runtime behavior remains unchanged |

Follow the [validation policy and change-specific checks](testing/README.md#validation-policy).
Use narrow package/route tests while iterating on the matrix above. Verify the
provider-backed end-to-end scenarios in the approved Meta staging environment;
GitHub offline checks do not establish live provider behavior. Repo-wide checks
and production merge gates are defined only in `AGENTS.md`.

---

## Risks and decisions that must not be deferred

1. **Groups API eligibility is a launch blocker.** Confirm OBA access and actual group behavior in Meta staging before implementation is represented as committed product availability.
2. **Group capability is constrained.** Keep the participant limit and API-created-group boundary in UI, sales, and setup copy; do not call it “WhatsApp channel sync.”
3. **Identity is the privacy boundary.** A WhatsApp sender is an external contact until an explicit authenticated Timeline link exists. Never use a number/profile match to grant agent access.
4. **Source evidence is not an agent session.** Only an explicit request creates an agent turn; shared group history never becomes a private chat transcript.
5. **Costs must remain deliberate.** Reactive non-template replies in an open window are normally free; any template/proactive send needs an explicit audited product path and a live rate-card review.
6. **Policy/privacy review is required before public beta.** WhatsApp opt-in, user notice, opt-out, support escalation, data retention, DPA, and country-specific requirements need an accountable owner and approval record.

---
