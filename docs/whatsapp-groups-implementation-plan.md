# WhatsApp Groups and Conversational Capture Implementation Plan

> **For Hermes:** Use the existing conversational-surface runtime and implement this plan in small, independently reviewed commits.

**Goal:** Add an official WhatsApp Business Platform Cloud API capture surface that can ingest Timeline-managed WhatsApp Groups API groups and opt-in direct messages. Verified DMs reuse Timeline’s durable conversation-agent runtime; explicit group `/ask` requests use a separate durable, stateless group-ask ledger so shared content never becomes a private chat transcript.

**Architecture:** WhatsApp is a first-party conversational capture surface, parallel to Telegram and Slack—not a generic native-provider sync. A verified Meta webhook receives forward-only events, the WhatsApp adapter resolves the receiving business number to exactly one Timeline team, persists immutable `raw_events`, and reuses existing attachment, extraction, embedding, timeline-moment, and conversational-agent primitives. Direct WhatsApp text is agent-first only after an explicit Timeline-account identity link; group text is ingestion-first and invokes the agent only for an explicit command from a linked member. Both delivery paths pass `whatsapp` as the current surface and inherit the shared `external_chat` profile; the adapter must not add its own answer prompt or citation sanitizer.

**Tech stack:** Next.js App Router, TypeScript, Drizzle/Postgres, BullMQ, S3-compatible attachment storage, existing `@timeline/shared` capture/conversation-surface modules, Meta WhatsApp Business Platform Cloud API.

---

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

## Implementation plan

### Task 1: Freeze the Meta pilot contract and production configuration

**Objective:** Establish the external-account and operating constraints before code is enabled.

**Files:**
- Create: `docs/setup/whatsapp.html`
- Modify: `.env.example`
- Modify: `apps/web/src/app/app/sources/page.tsx`
- Modify: `apps/web/src/lib/hub-status.ts`

**Steps:**
1. Create one Meta app, configure the WhatsApp product, subscribe the app to the required WABA webhook fields, and complete OBA/Groups API eligibility validation with a real non-production business number.
2. Register the production and staging HTTPS callbacks separately. Record the exact callback URL, subscribed fields, receiving `phone_number_id`, WABA ID, app ID, supported country/participant constraints, and webhook retry behavior in deployment runbooks—not in source control.
3. Add only secret *names* to `.env.example`: `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and a pilot-only `WHATSAPP_SYSTEM_USER_TOKEN` if a temporary bootstrap path is necessary. Do not add real IDs, access tokens, phone numbers, test payloads containing people, or Meta credentials.
4. Define a server-side rollout flag such as `WHATSAPP_CAPTURE_ENABLED`; keep it disabled by default until the signed-webhook and OBA pilot pass.
5. Surface WhatsApp in Connections as “Not set up”/“Pilot”/“Connected” from team-scoped persisted state—not from whether a process environment variable happens to be set.

**Verification:** A staging admin can complete Meta’s verification challenge and see no credentials in source, rendered HTML, logs, analytics, or error messages.

### Task 2: Add a WhatsApp-owned schema and immutable source identity

**Objective:** Persist credential ownership, number-to-team routing, explicit identity links, group bindings, and event idempotency without weakening team isolation.

**Files:**
- Create: `packages/db/drizzle/00xx_whatsapp_capture.sql`
- Modify: `packages/db/src/schema/raw-events.ts`
- Create: `packages/db/src/schema/whatsapp.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/whatsapp-migration.test.ts`

**Steps:**
1. Add `whatsapp` to `event_source`, `onboarding_step`, and `visibility_default_source`, following the precedent in `packages/db/drizzle/0028_phase12_slack_capture.sql`.
2. Add a `whatsapp_business_accounts` table with a unique WABA ID and AES-GCM-encrypted system-user token fields (`token_ciphertext`, `token_iv`, `token_tag`), app metadata, and timestamps. Reuse `@timeline/shared/crypto/secrets`; never store an access token in JSON metadata.
3. Add `whatsapp_phone_numbers` keyed by Meta `phone_number_id`, belonging to a WABA. Add a team binding with a uniqueness constraint that makes a receiving number route to exactly one enabled Timeline team.
4. Add `whatsapp_contacts` keyed by WABA/number plus `wa_id`; retain only the profile fields Meta supplies and provider metadata needed for provenance. Add `whatsapp_user_teams` with explicit Timeline-user linkage, active state, linkage actor, and unique active route constraints comparable to Slack’s `slack_user_teams`.
5. Add `whatsapp_group_bindings` keyed by receiving phone number and Meta `group_id`, with `team_id`, subject/display name, `visibility_default`, enabled state, group metadata, and the admin who bound/created it. Ensure an enabled group cannot bind across teams.
6. Add a dedicated `whatsapp_group_ask_turns` table: provider event/message/group keys; team and linked requester; question/answer; lifecycle timestamps/status/error; and unique provider-event idempotency. It must not reference `chat_sessions` or create `chat_messages`.
7. Add a partial unique index on `raw_events.source_metadata ->> 'whatsapp_message_id'`, exactly like the Slack event-ID index, so a redelivery cannot create duplicate evidence.
8. Add schema/migration tests that prove enum availability, foreign-key cascade behavior, uniqueness of active number/group routes, group-ask event idempotency, and raw-event deduplication.

**Verification:** `pnpm --filter @timeline/db test` passes with a migration test that attempts cross-team enabled bindings and duplicate WhatsApp message IDs.

### Task 3: Define a strict WhatsApp protocol boundary

**Objective:** Parse only documented message/status/group webhook shapes and centralize the Cloud API client.

**Files:**
- Create: `packages/shared/src/whatsapp/types.ts`
- Create: `packages/shared/src/whatsapp/api.ts`
- Create: `packages/shared/src/whatsapp/api.test.ts`
- Create: `packages/shared/src/whatsapp/index.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

**Steps:**
1. Define Zod schemas for the outer `whatsapp_business_account` envelope, entries/changes, message payloads, contacts, statuses, errors, group lifecycle events, and unknown-field-tolerant provider metadata. Reject malformed required IDs/types rather than coercing them.
2. Model a stable provider event key and a stable event/message/group/user key. Use Meta message IDs for capture idempotency and use a namespaced opaque key such as `number:<phone_number_id>:dm:<wa_id>` for direct conversation-session links.
3. Implement `WhatsAppApi` with narrow methods: send text with reply context, send an approved template, download media metadata/bytes, and create/manage a Groups API group only where the Meta endpoint supports it. Inject `fetch` for deterministic tests; redact response bodies and authorization headers in thrown errors.
4. Make billable/template dispatch an explicit method requiring category/template name and an audited caller. Normal agent replies must use the non-template path and first verify the customer-service-window policy from persisted message state.
5. Encode media size/type/count limits before download and preserve Meta media IDs/mime/sha metadata in immutable source metadata.

**Verification:** Fixture tests prove request URLs, authorization headers, message context, status parsing, redaction, malformed webhook rejection, and that a free-form send cannot be used after the window closes.

### Task 4: Build a verified, fast, idempotent webhook ingress route

**Objective:** Accept only authentic Meta callbacks and enqueue/dispatch bounded work without exceeding provider acknowledgement time.

**Files:**
- Create: `apps/web/src/app/api/whatsapp/webhook/route.ts`
- Create: `apps/web/src/app/api/whatsapp/webhook/route.test.ts`
- Modify: `apps/web/src/lib/sentry-report.ts` only if a reusable redaction helper is necessary

**Steps:**
1. Implement the GET verification endpoint: validate `hub.mode`, compare the verify token with timing-safe equality, return exactly `hub.challenge` on success, and return a non-revealing failure otherwise.
2. For POST, read the raw body once; validate `X-Hub-Signature-256` using `WHATSAPP_APP_SECRET` and timing-safe comparison before JSON parsing/dispatch. Enforce bounded request size and content type.
3. Require `object === 'whatsapp_business_account'`; parse entries one by one so an unsupported change does not crash the batch. Return a fast success acknowledgement only after the durable, idempotent capture/queue handoff has succeeded.
4. Resolve the receiving `phone_number_id` before any team lookup. Ignore unknown/disabled numbers and groups without exposing route existence to the sender.
5. Make webhook redelivery safe at every boundary: provider message ID for raw evidence; provider event ID for agent turns; provider media ID for media fetch jobs; provider status ID/message ID for outbound state.
6. Emit structured, content-free operational counters for valid, invalid-signature, malformed, unbound, duplicate, captured, queued, media-failed, and delivery-status events. Never log raw payloads, message text, access tokens, or phone numbers.

**Verification:** Route tests cover challenge success/failure, invalid HMAC, malformed payload, multiple-entry batches, unbound number/group, duplicate delivery, and acknowledgement-time behavior.

### Task 5: Implement the WhatsApp dispatcher and evidence capture path

**Objective:** Convert verified inbound events into source-provenanced, team-scoped Timeline evidence.

**Files:**
- Create: `packages/shared/src/whatsapp/dispatcher.ts`
- Create: `packages/shared/src/whatsapp/dispatcher.test.ts`
- Modify: `packages/shared/src/team-scope.ts`
- Modify: `packages/shared/src/timeline-moments/index.ts`
- Modify: `packages/shared/src/timeline-moments/index.test.ts`
- Modify: `apps/web/src/lib/timeline-controls.ts`
- Modify: `apps/web/src/lib/timeline-controls.test.ts`
- Modify: `apps/worker/src/index.ts` and queue registration as needed

**Steps:**
1. Resolve `phone_number_id → enabled WhatsApp team route → optional group binding` using `withTeam`; never issue unscoped team queries based only on a `wa_id` or group ID.
2. Capture raw evidence with `source: 'whatsapp'`, canonical timeline text, sender display data, `whatsapp_message_id`, `wa_id`, `phone_number_id`, WABA ID, group ID, reply context, content type, and a provider-versioned metadata shape.
3. Preserve source immutability. If Meta supplies a supported correction/deletion event, tombstone/supersede the active derived event in the same manner as the current Slack/Telegram contracts; never overwrite captured source content.
4. Map an inbound group to a deterministic moment key using `group_id`; map a DM to a deterministic conversation key using number and `wa_id`. Add source labels, grouping metadata, and display-safe provider labels without rendering raw provider IDs by default.
5. Add WhatsApp as a concrete timeline source in `apps/web/src/lib/timeline-controls.ts`; include it in the Chat source expansion only if the product intentionally treats all three conversation providers as one facet. Extend `TimelineOriginFilter`, `parseTimelineOrigins`, `timelineOriginValue`, `timelineOriginOptions`, source-facet SQL, and `timelineOriginFilterCondition` in `packages/shared/src/team-scope.ts` with a `whatsapp_group` origin keyed by `group_id` (and, where required for uniqueness, receiving `phone_number_id`). Add tests for URL parsing, visible facets, and source/origin filtering.
6. For supported media, persist a capture row before scheduling download/extraction; use the shared attachment/document/audio paths and leave a bounded, retryable failure state when media retrieval fails or expires.
7. Persist outbound delivery/read/failure statuses separately from inbound source evidence so observability does not alter the original message.

**Verification:** Dispatcher tests prove exact-once capture under redelivery, strict group/team isolation, group/DM metadata, source immutability, attachment job enqueueing, and moment grouping.

### Task 6: Reuse the shared runtime for DMs and add a durable stateless group-ask runner

**Objective:** Keep WhatsApp agent execution durable, private where appropriate, and policy-safe instead of inventing a third bespoke chat session system.

**Files:**
- Create: `packages/shared/src/whatsapp/conversation-adapter.ts`
- Create: `packages/shared/src/whatsapp/conversation-adapter.test.ts`
- Create: `packages/shared/src/whatsapp/group-ask.ts`
- Create: `packages/shared/src/whatsapp/group-ask.test.ts`
- Modify: `packages/shared/src/whatsapp/dispatcher.ts`
- Modify: `packages/shared/src/conversation-surfaces/types.ts` only if a generic capability is genuinely missing
- Create: `apps/worker/src/workers/whatsappGroupAsk.ts`
- Create: `apps/worker/src/workers/whatsappGroupAsk.test.ts`
- Modify: `packages/shared/src/queue/queues.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `docs/adr/0012-direct-chat-surfaces-share-one-agent-runtime.md`

**Steps:**
1. Follow ADR 0012: direct verified WhatsApp text is a `conversation-surfaces` turn; `/note` captures without invoking the agent; media always enters ingestion; group messages remain ingestion-first.
2. Require an explicit, expiring account-link flow before a DM sender can access Timeline agent context. The server action must bind a verified `wa_id` to the signed-in Timeline user/team; never infer the link from display name or number.
3. For group `/ask`, require both an enabled group binding and a linked sender. Claim/create `whatsapp_group_ask_turns` transactionally before enqueueing a dedicated `whatsapp-group-ask` worker; use the original provider event ID as the idempotency key, a bounded in-flight lease/heartbeat, cached-answer redelivery, and a completed TTL. This follows the safety properties of Telegram’s stateless `runAsk` path without creating a `chat_session` or `chat_messages` row.
4. Build a group answer with the requestor’s team/user scope and reply with the original message as context. Persist only the minimum request/answer/audit data in the group-ask ledger; never place shared group content in the requester’s direct-message session or web-chat history.
5. Construct WhatsApp delivery adapters for direct conversation acknowledgements (no-op if the platform lacks a safe equivalent), progress (no-op/allowed status only), answers, and failures. The dedicated group worker must reconstruct the API from the encrypted WABA credential and revalidate the active number/group/user route before delivery.
6. Parse commands conservatively and document the exact grammar. Plain group text, unknown commands, bot’s own messages, and messages from unlinked participants only capture evidence.
7. Before delivery, enforce the customer-service-window rule. If a free-form delivery is prohibited, cache the group answer for a safe admin/web recovery path and record a non-contentful reason; do not silently substitute a paid template.

**Verification:** Conversation-surface tests cover account linking and DM route changes. Dedicated group-ask tests cover transactional claim/lease/heartbeat, duplicate `/ask`, private-history isolation, no `chat_sessions`/`chat_messages` write, no LLM call for ordinary group text, expired service window, and worker retry/cached-answer delivery.

### Task 7: Build the admin connection and group lifecycle UI

**Objective:** Give team admins explicit, auditable control of WhatsApp routing and group capture.

**Files:**
- Create: `apps/web/src/app/app/team/whatsapp/page.tsx`
- Create: `apps/web/src/app/actions/whatsapp.ts`
- Create: `apps/web/src/components/whatsapp-forms.tsx`
- Create: matching `*.test.tsx` / `*.test.ts` files
- Modify: `apps/web/src/app/app/sources/page.tsx`
- Modify: `apps/web/src/lib/hub-status.ts`
- Modify: `apps/web/src/lib/onboarding.ts`

**Steps:**
1. Restrict connection, number assignment, group create/bind, disable, disconnect, and template-configuration actions to team admins through `withTeam(...).requireMembership('admin')`.
2. Provide a staged flow: verify prerequisites → connect/persist WABA and business number → create/bind a Groups API group → invite participants through the approved Meta flow → choose Timeline visibility → confirm the forward-only/no-history boundary.
3. Display connection status, enabled groups, capture start time, visibility, delivery health, OBA/pilot status, and external IDs only inside `TechnicalDetails`; never show credentials.
4. Create audit events for every credential/number/group/visibility lifecycle mutation. Revoking a binding must stop future capture/agent replies while preserving immutable prior evidence under its existing visibility/retention policy.
5. Add an explicit user account-link flow for direct DM/agent usage and a clear unlink/revoke action that resets the associated shared conversation session.
6. Update the Sources hub and onboarding state only from persisted, team-scoped state.

**Verification:** Server-action and page tests prove admin enforcement, CSRF/auth behavior already used by server actions, audit emission, disabled-route behavior, explicit visibility choices, and revoke cleanup.

### Task 8: Add policy, support, and operations documentation

**Objective:** Ensure the external integration can be deployed and supported without undocumented credentials, hidden charges, or misleading product claims.

**Files:**
- Create: `docs/setup/whatsapp.html`
- Modify: `README.md`
- Modify: `docs/index.html`
- Modify: `docs/product-brief.html`
- Modify: `docs/railway.html`
- Modify: `AGENTS.md` only if a new validation/deployment command is introduced

**Steps:**
1. Document direct Cloud API configuration, webhook URL/verification, secret rotation, encrypted-token handling, subscribed events, OBA/Groups API preconditions, test-number setup, rollback, and media storage lifecycle.
2. State the actual product boundary prominently: Timeline-managed Groups API groups and opt-in forward capture; no historical import or arbitrary existing-group ingestion.
3. Document customer-service windows, opt-in, templates, per-recipient template costs, no automatic paid-template fallback, opt-out/escalation support obligations, and the owner responsible for policy review.
4. Add runbooks for invalid signature spikes, duplicate webhook bursts, queue backlog, expired media retrieval URLs, 401/credential rotation, quality/template blocks, and Meta delivery failures.
5. Add data-processing/retention disclosure updates if legal review determines WhatsApp source data changes the public policy or DPA contract.

**Verification:** A fresh operator can configure staging using only the docs and `.env.example`; a reviewer can find every required secret by name but no secret value in the repository.

### Task 9: Execute staged rollout with hard kill switches

**Objective:** Validate platform eligibility, costs, privacy, and operational reliability before broad availability.

**Files:**
- Modify: feature-flag configuration/seed paths discovered during implementation
- Modify: `todo.md`
- Create: pilot fixture/runbook location outside the public repository if it contains account identifiers, contact data, or real message content

**Steps:**
1. **Stage 0 — Meta sandbox/OBA proof:** use a disposable internal group. Verify group creation, invite flow, text/media inbound webhooks, explicit `/ask`, status events, and observed billing.
2. **Stage 1 — single-team pilot:** enable one team and one group with capture-only default. Validate team routing, redelivery dedupe, source inspection, attachment extraction, and group visibility.
3. **Stage 2 — agent pilot:** enable linked-member `/ask` only after the capture audit is clean. Monitor queue latency, agent failures, billed template count (expected zero), rate limits, and accidental bot replies to normal messages.
4. **Stage 3 — controlled expansion:** require explicit product/legal sign-off for any template, proactive notification, additional country, or larger operational scope.
5. Define kill switches for webhook ingestion, outbound replies, group agent turns, media download, and the whole source. A kill switch must prevent future side effects but preserve existing evidence and allow support inspection.
6. Keep real WABA IDs, phone numbers, signed payload fixtures, test participants, and billing records in the private operations/docs repository; commit only fully synthetic fixtures.

**Verification:** Each stage has named owner, entry/exit criteria, rollback test, and measured results. Do not mark the roadmap item complete until the pilot proves no cross-team capture, no duplicate agent replies, no unplanned Meta charges, and acceptable webhook/worker error rates.

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

Run, at minimum, after implementation:

```bash
pnpm validate
pnpm run doctor
pnpm test
pnpm test:dist-imports
pnpm test:eval
pnpm e2e
```

Add the narrow package/route tests while iterating and run `pnpm test:reconciliation-eval` if source references, evidence associations, visibility floors, or reconciliation planning are touched. The final web check must show `React Doctor score: 100` and `No issues found!`.

---

## Risks and decisions that must not be deferred

1. **Groups API eligibility is a launch blocker.** Confirm OBA access and actual group behavior in Meta staging before implementation is represented as committed product availability.
2. **Group capability is constrained.** Keep the participant limit and API-created-group boundary in UI, sales, and setup copy; do not call it “WhatsApp channel sync.”
3. **Identity is the privacy boundary.** A WhatsApp sender is an external contact until an explicit authenticated Timeline link exists. Never use a number/profile match to grant agent access.
4. **Source evidence is not an agent session.** Only an explicit request creates an agent turn; shared group history never becomes a private chat transcript.
5. **Costs must remain deliberate.** Reactive non-template replies in an open window are normally free; any template/proactive send needs an explicit audited product path and a live rate-card review.
6. **Policy/privacy review is required before public beta.** WhatsApp opt-in, user notice, opt-out, support escalation, data retention, DPA, and country-specific requirements need an accountable owner and approval record.

---

## Sequencing and commits

1. `docs: define WhatsApp Groups API product contract and rollout plan` — this document and roadmap pointer.
2. `feat(db): add WhatsApp capture ownership and binding schema`.
3. `feat(whatsapp): add typed Cloud API client and verified webhook ingress`.
4. `feat(whatsapp): capture WhatsApp groups and media as timeline evidence`.
5. `feat(whatsapp): add direct and explicit group agent turns`.
6. `feat(whatsapp): add admin connection and group management`.
7. `docs: publish WhatsApp setup and operations guide`.
8. `feat(whatsapp): enable guarded staging pilot`.

No implementation commit should enable production capture or outbound replies by default.
