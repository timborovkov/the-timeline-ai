# Test TODO and Coverage Plan

This document tracks the current test surface and the missing coverage needed
to trust Timeline end to end. Tests should stay coupled to behavior and product
contracts, not private implementation structure.

## Test Status Overview

Last checked in this branch: on 2026-07-19, `pnpm validate`,
`pnpm run doctor`, `pnpm test`, `pnpm test:e2e-env`, `pnpm test:eval`,
`pnpm test:reconciliation-eval`, `pnpm test:dist-imports`,
`pnpm test:task-category-eval:live`, and the
full strict local Playwright suite pass. React Doctor reported
"No issues found!" with a 100/100 score. The Playwright suite passed 63 tests,
including curated Quiet Archive Linux visual baselines (not a full surface matrix),
Home-to-Ask private prompt handoff, capture dialog, UUID suppression, one-heading
route sweep, 320px no-overflow checks, and distinct task-category/primary-project
editing and filtering. Approval regressions prove item-level
Pending and Failed counts, failed-only isolation from Work attention,
mixed-bundle filtering, and partial bulk-failure movement to the Failed filter
while keeping the failure alert visible. Calendar toolbar coverage derives Today
from the workspace timezone at date boundaries. The live task-category gate
passed 120 cases at 96.7% single-prediction accuracy, 97.5% batch accuracy, and
100% prompt-injection accuracy.

On 2026-07-08, `pnpm validate`, `pnpm run doctor`,
`pnpm test:eval`, `pnpm test:reconciliation-eval`, `pnpm test:dist-imports`, and
the full strict local Playwright suite also passed.

The 2026-07-02 verification also passed
`pnpm test:eval`, `pnpm test:reconciliation-eval`, `pnpm test:dist-imports`,
root `pnpm test`, `pnpm test:agent-eval:live`,
`pnpm test:suggestions-eval:live`, `pnpm test:transcribe-eval:live`, and
`pnpm e2e:prod-smoke` against the production build and standalone server.
The full local Playwright suite then passed 50 tests against the isolated Docker
stack, including Slack settings member/admin bind-unbind, Telegram settings
admin token/unbind, support/team-export, onboarding checklist, global search,
reconciliation dashboard drilldown/mobile layout, and document flows. The targeted
reconciliation browser suite now passes 10 tests, including failed output
visibility, worker-backed manual repair side effects, source audit and dry-run
backfill queue submissions, team and cluster manual-reconcile queue submissions,
run-history filtering/pagination, approval-to-reconciliation cluster
cross-linking, approval accept/reject button effects against durable task state,
partial bulk approval failure recovery, invalid manual-reconcile operator errors,
and private/specific-user cluster visibility filtering across the dashboard and
direct cluster URLs.
On 2026-07-07, the focused legacy-provenance cutover pass also reran
`pnpm validate`, `pnpm run doctor`, `pnpm test:eval`,
`pnpm test:reconciliation-eval`, `pnpm test:reconciliation-eval:live`,
`pnpm test:dist-imports`, and `git diff --check`. React Doctor again reported
"No issues found" with a 100/100 score.
On 2026-07-08, the DB schema contract added and verified migration
`0056_legacy_provenance_cutover_guards.sql`. On 2026-07-10, follow-up migration
`0057_legacy_provenance_editability.sql` kept append-only history rows under
`NOT VALID` constraints and replaced the mutable entity checks with a
transition-aware trigger. Tests verify that historical entities remain editable
without changing their legacy values, while inserts and updates cannot
introduce new legacy provenance.
The full strict local Playwright suite also passed on July 8 with 50/50 tests,
including the reconciliation dashboard, worker-backed manual repair, approval
projection, visibility-filtering, and mobile no-overflow flows.
The July 8 reconciliation live eval also passed 11/11 checks through the real
LLM path, writing
`/tmp/timeline-reconciliation-live-eval/2026-07-08T10-18-13-811Z/manifest.json`;
closed-beta production sampling over that run passed 7/7 samples with pass rate
1.0 and no fixture candidates at
`/tmp/timeline-reconciliation-live-eval/2026-07-08T10-18-13-811Z/production-sampling-report.json`.
The same run was persisted to the migrated and seeded local Timeline Postgres
on `localhost:55432` as reconciliation run
`a0e91444-91cf-44c2-a561-9fe63014b3aa` via
`/tmp/timeline-reconciliation-live-eval/2026-07-08T10-18-13-811Z/production-sampling-report-persisted.json`.
The July 8 live legacy-provenance audit against team
`20000000-0000-4000-8000-000000000001` returned zero rows for all four cutover
counts.
A targeted Playwright MCP run also passed the Timeline-as-MCP bearer-key page,
one-time key minting, JSON-RPC `timeline.list_events`, and private/specific-user
visibility exclusion. A targeted Playwright inbound-email run also passed a
Postmark-shaped webhook payload through `/api/email/inbound`, verified the
team-scoped `raw_events` row, rendered it in the signed-in timeline, and proved
the Team settings sender whitelist blocks non-whitelisted senders while allowing
configured senders. A targeted Playwright job-recovery run also passed the
admin dashboard retry/dismiss flow, including retry metadata clearing and
dismissal persistence. A targeted Playwright meetings run also passed saved
meeting setup with auto-join scheduling, finalized transcript detail rendering,
and the meeting summary timeline card. A targeted Playwright reconciliation run
also passed the Team -> Reconciliation dashboard, persisted artifact cluster
drilldown, and mobile no-horizontal-overflow check.
The live agent eval used the real `askAgent` OpenRouter path against seeded
durable task/calendar state, provider-backed Monday.com integration search,
Sentry resource drill-in, document chunk retrieval, meeting transcript chunk
retrieval, custom MCP customer-health tool use with evidence capture, and
cross-surface customer-launch plus renewal-risk synthesis with untrusted-content
handling.
The live suggestion eval used the real suggestion worker extraction/projection path
against seeded customer email evidence. The live transcribe eval used the real
OpenRouter transcription endpoint through the worker finalization path against a
seeded PGlite raw audio event with an embedded spoken canary phrase, then
asserted transcript semantics, raw-event metadata, reconciliation evidence, and
downstream extract/embed/suggestion enqueue intent.
Manual live reconciliation eval with real `llm.chatStructured()` calls passed
again on July 3, 2026 UTC with the source-ref allowlist planner prompt: 11/11
Vitest checks, including 7/7 planner cases across fifteen ingestion surfaces
and six scenario families, MCP-derived evidence, system events, and
sales-success renewal risk. AI judge checks passed 7/7 with average judge score
1.0. The latest artifact-producing run is
`/tmp/timeline-reconciliation-live-eval/2026-07-03T13-46-10-source-ref-allowlist-retry3/manifest.json`.
Production sampling over that fresh run reported 7/7 passed with pass rate 1.0
and zero fixture candidates or ignored files at
`/tmp/timeline-reconciliation-live-eval/2026-07-03T13-46-10-source-ref-allowlist-retry3/production-sampling-report.json`.
A July 3, 2026 non-strict live integration canary reached OpenRouter structured
chat, OpenRouter audio transcription, Postmark, Recall, and the Telegram Bot
API; verified GitHub, Monday.com, Slack, and Sentry OAuth authorize endpoints
plus configured Monday, Sentry OAuth, Slack, and Postmark webhook secrets; and
now includes optional Slack Web API `auth.test` checks for dedicated bot/user
canary tokens plus optional signed Slack, secret-protected Telegram, and
DB-polled Postmark inbound event-capture canaries.
Sentry API access still returns 403 for the configured org/project, and optional
GitHub App, Google Drive, Linear, Slack auth-test token, and provider capture
canary credentials remain unset.
The suite includes reconciliation schema contracts, fixture-backed
surface/scenario evals, source-ref and visibility-floor evals, source-payload
replay coverage, per-ref source-payload enforcement for required surfaces,
all-raw-event-source normalizer coverage, claimed-surface source-ref checks,
release-gating evidence coverage reports for missing and
non-allowlisted degraded replay rows, live-eval source-ref strictness,
production-sampling stale-pass downgrades and CLI failure gates, MCP tool-output reconciliation capture with
provider-object anchor extraction, non-browser `askAgent` MCP tool-loop
coverage, unexpected-surface rejection,
forbidden-output eval policy checks, projection-outbox status
mirroring/repair/action coverage, authority-policy checks, direct-write source refs
including missing/cross-team/replay-payload fail-closed checks, provider `objectMap` artifact coverage,
legacy `sourceEventId` stripping,
legacy `sourceEventId` payload-fallback removal, scoped manual reconciliation
evidence/association/output/projection repair, viewer-scoped reconciliation audit/backfill,
idempotent scoped repair reruns that keep evidence/association/resolver-output
repair metrics at zero when the graph is already healthy,
object/cluster scoped manual repair enqueueing raw-event planner replay through
the suggestion worker while filtering hidden raw events,
bounded team-scope manual repair planner replay with missing-only/default vs
all-visible text-event selection, source/time-window filters, and stable queue identity,
dev-seed reconciliation provenance cutover, approval projection writer-boundary
guards, exact rejected output replay
suppression, direct object-change legacy pointer retirement, timeline impact
hydration from output source refs instead of legacy object pointers, output source-ref
stability across multi-evidence raw events for integration projections,
object-summary source windows and invalidation from output source refs instead
of legacy object-change pointers,
board-history legacy `source_event_id` provenance suppression,
artifact evidence listing suppression for legacy `artifact_cluster_members` plus
timeline search/object Connected Work suppression of legacy member-only artifact
context, association-only link refresh behavior, removal of normal shared-code
imports of the legacy member table, source-contract regression coverage against
reintroducing those imports or adding raw-event writers without reconciliation
evidence normalization and replay-payload snapshots, object-facing agent/MCP omission of legacy
`agent_suggested`, object and board shared read-model suppression of stored
legacy `agent_suggested`, task/object cleanup UI suppression of legacy suggested
badges, canonical object/object-change/board-history write guards against
legacy provenance pointers, association/output writer guards requiring explicit
visibility envelopes, evidence writer guards requiring explicit source-payload
refs, payload digests, replay state, dedupe keys, and visibility fields,
output writer guards requiring source payload refs alongside source refs,
direct-write source-context builder guards requiring `sourceRawEventId` input
terminology,
dashboard legacy-provenance cutover counts for object pointers, object-change
pointers, board-history pointers, and `agent_suggested` flags,
legacy-provenance cutover CLI `--fail-on-legacy` gate coverage,
DB-level history checks plus a transition-aware entity trigger that reject new
legacy provenance writes while preserving historical rows for audit/backfill
and unrelated entity edits,
legacy private-event normalization that preserves author access when the stored
visibility owner is absent,
approval-projection audience intersection across mixed private evidence owners,
object-change preview legacy source-pointer suppression,
sales-success renewal-risk eval coverage,
object connected-work approval hydration through output source refs,
chat retrieval preservation and exact collection of object-summary source refs,
object/board direct writes with replay payload digests, and anchor-resolution replay,
timeline moment projection, focused link hydration, moment search/expansion,
outbound MCP moment access, raw-event snippet fencing, provider webhook
delivery, artifact status reopen regressions, same-object batch evidence
preservation, cross-team artifact join guards, captured-inbox
promotion/pagination fixes, provider-connection hardening, recurring meeting
capture, Saved Meeting visibility enforcement, scheduler idempotency, strict
meeting URL host matching, generated calendar cleanup,
quick-join/failure/capacity/reuse, partial-cancel finalize queue regressions,
and board/search UI regressions. Current suite shape:

- DB Vitest: 2 files / 14 tests, package-level PGlite schema contract suite now
  runs under root `pnpm test`.
- Shared Vitest: root runner covers more than 90 files, including PGlite
  artifact reconciliation, reconciliation all-source normalization/backfill/resolution,
  authority policy, planner prompt/schema, artifact-kind and forbidden-output
  eval contracts, system-event eval surface coverage, live artifact-kind eval
  artifacts, production-sampling artifact-kind miss reporting, MCP tool-output
  evidence capture, event writer,
  Sentry release and Monday item link artifact capture, project-shaped Monday
  item and Linear project provider-record separation, resolver DB-state artifact-kind assertions,
  calendar, timeline moments, MCP,
  integration/provider-connection, meeting, document, object, assistant, Slack,
  recovery, connection-attention, and onboarding coverage.
  The shared package runner executes unit tests once and PGlite integration
  tests in isolated chunks so long-lived PGlite state cannot starve later hooks
  during root `pnpm test`.
- Web Vitest: route/action/component coverage
  for search, timeline, core recovery, onboarding, object sections, board
  add-item interactions, provider-connection routes/UI, Slack events/commands/
  install/user-link routes, Slack bind/unbind actions, Telegram link-token
  actions/forms, app dialog flows, approval evidence source-ref metadata
  serialization, MCP server management/key-share states, inbound email whitelist
  states, and other high-value UI states.
- Worker Vitest: includes extract, transcribe,
  document-extract, meeting-finalize, meeting-scheduler, integration-sync
  attention, mixed partial-failure, provider document-harvest behavior with
  source payload refs/snapshots on the upload event,
  overdue-scan, embedding, cleanup, reconciliation audit/backfill,
  advisory-locked manual scoped evidence/association/output/projection repair
  with de-duped object-scope metrics, transcription retry boundary behavior,
  live speech transcription endpoint and worker-finalization canary coverage,
  webhook delivery, team export, timeline moment presentation, and janitor
  behavior.
- Playwright: 50 local core E2E tests plus 1 opt-in production-ish smoke
  journey.
- E2E CI is still manual and `continue-on-error: true`; it is not a merge
  gate yet.

Legend:

- Strong: meaningful coverage across the layer, including error/permission
  cases where relevant.
- Partial: important behavior is covered, but meaningful flows or edge cases
  remain.
- Thin: only narrow helpers, smoke checks, or structural tests exist.
- Missing: no direct coverage at that layer.

### Coverage By Feature And Test Type

| Feature / Subject | E2E | API / Route Tests | Server Action Tests | Shared / Integration Tests | Worker Tests | Component / UI Tests | Main Gaps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth, sessions, redirects | Partial: real credentials login, saved auth state, sign-out flow | Thin: Auth.js route itself untested | Thin: sign-up/sign-in actions not directly covered in this plan | Thin: env/auth redirect helpers | Missing | Thin: auth redirect helpers | Expired/invalid session flows, OAuth login E2E, sign-up action tests |
| Team switching and membership | Partial: app shell, team switcher, invite/resend/revoke, invite acceptance, role change, member removal, cross-team isolation | Covered indirectly through active-team gates on many routes | Strong for teams/invites/member role/remove | Strong PGlite team isolation and membership scope | Missing | Partial: inbound email whitelist settings states plus invite role/link/email-failure states | Deeper team settings page composition and destructive member/admin edge-state UI |
| Timeline capture and visibility | Partial: create team event, private/team/specific-user/cross-team visibility, source/author/date filtering with audit-trail mode preservation plus clear-filters recovery, inspector-driven visibility edit plus conversational-event removal, and infinite-scroll next-page fetch with Search timeline/Filters/presets chrome, no inventory chip plus oldest-end “No older activity” | Strong for timeline list/search contracts, moment/source-event mode handling, focused moment hydration, and audio signing | Strong for capture and visibility actions | Strong PGlite team scope, visibility defaults, tombstones, embedding-source visibility, and shared moment projection | Strong extract/transcribe/embed contracts for text/audio handoff and privacy skips | Partial: capture composer static/private, empty validation, queue-warning, audio/document upload, and partial-failure states plus timeline controls/page helpers, moment row rendering, source-event mode, feed infinite-scroll sentinel/bound copy, and feed pagination dedupe | Richer timeline feed/list interaction states |
| Objects, notes, and boards | Partial: object create/update/detail/archive, notes, relationship link/unlink, board create/list/detail/filtering, filtered task inventory `24 of N`, and virtualized kanban card column moves | Partial: object sections route covered | Strong for objects and boards actions | Strong PGlite object CRUD, notes, chat sessions, suggestions, board views, isolation | Suggestions worker covered | Partial: object detail static sections/approvals plus collection infinite-scroll/virtual list and `24 of 847` count chrome | Richer object/board component interaction states |
| Documents and folders | Partial: folder create, upload/list/detail, rename/delete, team/private visibility, worker-embedded semantic search result, and cited chunk deep link | Strong list/search route contracts | Strong document actions | Strong PGlite document scope, semantic chunk hydration, object keys, folder ancestry, restore/delete semantics, single-document provenance lookup | Strong document-extract worker | Partial: document drive static empty/list states plus captured inbox rows, promotion defaults, cursor loading, document search result/loading/pagination states, document search result chunk context, and document detail extracted text/description/provenance/status/chunk-anchor states | Richer document detail interaction states |
| Chat and agent UI | Partial: browser timeline question, tool activity, Event citation, session reload, degraded answer, visibility fences, and accepted task/calendar/object state | Strong chat route streaming/session/tool contract, including deterministic E2E seam coverage for durable workspace state, dashboard action/HITL tool selection, and persisted tool observability summaries | Partial: archive/unpin/load validation, scope failures, hydration, dependency errors, and revalidation behavior | Partial: deterministic agent tool evals, provider-backed integration retrieval/resource drill-in, document chunk retrieval, meeting transcript chunk retrieval, moment search/expansion coverage, shared agent eval harness for tool traces/answer synthesis/SearchHit fixtures/non-browser ask model scripts/turn-observability capture, dispatcher-level Slack/Telegram `/ask` surface evals through the real `askAgent` pipeline, worker-level background proposal evals for visibility-safe conversation reviews, shared tool-observability summaries, `askAgent` wrapper tests including provider-backed MCP tool loops, MCP safety evals, structural tools, and LLM wrappers | Fast deterministic evals for timeline citation, bundled moment retrieval, provider-filtered integration retrieval, document chunk citation, meeting transcript chunk citation, task/calendar state, dashboard action/HITL selection, Slack/Telegram ask delivery, background proposal generation, visibility fences, and tool failure honesty; opt-in live eval covers durable tools, Monday integration search, Sentry resource drill-in, document retrieval, meeting transcript retrieval, custom MCP customer-health tool use with evidence capture, cross-surface customer-launch synthesis, and email/project/incident/document renewal-risk synthesis through the real model | Partial: chat pane static empty/message/pinned states plus moment tool-step labels | Remaining: broader live-model scenario families, summary/HITL harness suites, richer Slack/Telegram ask scenarios, and chat UI states |
| Calendar | Partial: browser all-day and timed create/edit/delete, team/private/specific-user visibility, recurrence/show-as editing flows, toolbar navigation, and event-list search/scope/infinite-scroll | Missing calendar API routes, if any are added later | Strong calendar action tests | Strong PGlite calendar scope, queue degradation, and time helpers | Embed worker calendar plan covered | Partial: recurrence/tentative rendering, normalized recurrence preset mapping, optimistic create behavior, create validation, specific-user visibility defaults, save-failure recovery, redacted busy rendering, and event-list infinite-scroll counts | Broader calendar UI edge states |
| Native integrations: Drive, GitHub, Linear, Monday.com, Slack workspace, Sentry | Partial: browser covers catalog OAuth start, OAuth callback success/denial, provider-backed source listing/sharing, integrations cooldown/webhook-degraded health states, and source activation/replacement | Partial: Drive, GitHub, Linear, Monday.com, and Sentry webhooks, OAuth start/callback, provider-connection resource sharing, activation, manual sync, delete/disconnect with webhook deprovision best effort, legacy Monday missing-scope reconnect guidance, degraded webhook provisioning attention, and legacy selection guard routes covered | Missing integration actions if/when added | Strong provider parsing for Drive/GitHub/Linear/Monday.com/Slack/Sentry, event writer, provider-connection scope, attention lifecycle, source activation, duplicate-path replacement, token encryption, GitHub App installation-token handoff, installation-keyed budget pauses, GitHub repo-surface conditional GETs, provider webhook sync hints, shared provider sync-policy contract, native provider adapter contract tests, native provider template, targeted sync queue coalescing, provider-policy reconciliation coalescing, Monday board webhook provisioning, Monday item-level webhook hydration, Monday missing-scope degraded-mode detection, Monday WorkDocs daily reconciliation, Drive changes-feed pagination and page-cap resume, Linear team/resource and sync pagination, Drive channel-expiration degraded handling, Slack Web API budget pauses, Sentry issue lifecycle/release webhook normalization, Sentry issue and release provider-record artifact links, webhook-degraded enum migration coverage, webhook delivery dead-letter persistence, and email-throttle coverage | Partial: integration sync worker attention classification, mixed partial-failure classification, provider-policy reconciliation cadence, expiring webhook subscription sweep, targeted webhook sync narrowing, webhook delivery duplicate-redelivery and dead-letter attention handling, provider-specific budget-scope skipping, provider document-harvest create/version/finalize/extract handoff with upload-event source payload refs/snapshots, legacy Monday missing-scope reconnect preservation, transient-failure delay, owner-left, reconnect, and success-reset behavior covered | Partial: provider-connection source picker, provider-specific source guidance, team source actions, visible-row attention banner counts, connected-row cooldown/reconnect/webhook-degraded attention states, app dialog guard, catalog OAuth-start E2E, OAuth callback success/denial E2E, integrations health-state E2E on desktop/mobile, source listing/sharing E2E, and source activation/replacement E2E covered | Browser/scheduled coverage for provider-backed canary runs, remaining provider webhook provisioning, and richer loading/error UI states |
| Slack | Partial: seeded member settings route for workspace, bound channel, linked user, read-only controls, and admin bind/unbind via deterministic Slack Web API fixtures | Strong events webhook plus signed command, install OAuth, and user-link OAuth route coverage | Partial: bind/unbind success, validation, provider failure, audit, onboarding, and revalidation behavior | Strong dispatcher/API/security/source-capture coverage, including text/file capture, linked attribution, visibility defaults, downstream queues, idempotent edits, `/timeline join` Saved Meeting aliases, raw URL confirmation buttons, deterministic Web API fixture coverage for settings E2E, optional live Slack Web API `auth.test` canary coverage, and optional signed Slack event-capture canary coverage | Partial: native Slack provider sync runs through the worker context for selected-channel event writes, cursor persistence, and success cleanup | Partial: settings install/configuration/binding/user list states | Scheduled auth-test token coverage, provider-backed native Slack canary, and richer settings UI states |
| Telegram | Partial: browser verifies deterministic Telegram voice transcript approval acceptance plus admin settings token generation, revoke, and group unbind | Partial: webhook covered, including media env wiring | Partial: personal/group link token generation, username validation, admin-only revoke/unbind, onboarding, analytics, and revalidation behavior | Strong API/dispatcher coverage, including DM text, voice/audio, caption/photo, document routing, duplicate delivery, media skip behavior, `/join` Saved Meeting aliases, raw URL inline-button confirmation, direct-reply confirmation, passive-text non-trigger behavior, link artifacts, normalized reconciliation evidence, Telegram Bot API live canary, and optional secret-protected Telegram capture canary | Partial: transcribe processor handoff from audio transcript to normalized reconciliation evidence, extract/embed, and suggestions is covered | Partial: link-token form success/error/pending/deep-link states | Scheduled Telegram capture canary credentials and richer image/OCR-to-approval behavior |
| MCP inbound/outbound | Partial: browser verifies outbound bearer-key minting plus JSON-RPC `timeline.list_events` only exposes team-visible events, excluding private and specific-user rows | Strong MCP OAuth/server/key/server/tool route contracts, including outbound moment retrieval and team-visible evidence filtering | Missing MCP-specific actions if/when added | Strong auth/OAuth state/tool namespace/server handler, tool namespace, custom tool-output reconciliation capture, oversized replay-degraded fallback, provider-object anchors from structured MCP snapshots, non-browser `askAgent` provider-backed MCP tool loop, live-model custom MCP tool use with evidence capture, and deterministic untrusted-output/failure/reauth evals | Strong MCP health worker coverage for SSRF-safe production URL validation, cache invalidation, disabled-server skips, and persisted success/failure state | Partial: MCP server add/OAuth-start/enable/remove/test-call management states, reconnect-specific test-call failures, generic tool-call failure dialogs, plus outbound key mint/revoke and client setup snippets | Real external custom-server behavior and richer browser/chat reconnect states |
| Email inbound/outbound | Partial: browser posts a Postmark-shaped webhook payload, verifies the team-scoped email raw event, sees it render in the signed-in timeline, and checks sender-whitelist block/allow behavior through Team settings | Partial: inbound webhook covered, including Redis queue wiring and document attachment deps | Whitelist action covered; invite/support email action gaps remain | Strong parser/dispatcher/outbound/IP allowlist/source-capture coverage, including sender auth, sender whitelist filtering, visibility defaults, attachment/audio routing, captured-document handoff, downstream queues, duplicate delivery recovery, and optional DB-polled Postmark inbound capture canary coverage | Partial: worker-backed inbound attachment extraction from email-captured documents covered | Partial: inbound sender whitelist configured/unconfigured/success/error/pending states | Scheduled Postmark inbound capture canary credentials |
| Meeting bots and meetings | Partial: browser saved-meeting setup creates an auto-join schedule, scheduled captures render, finalized transcript detail shows summary/chunks, and the timeline shows the meeting summary card | Strong Recall status/transcript webhook coverage for lifecycle, no-show, failure, and finalize handoff contracts | Thin meetings action coverage | Strong meetings scope, Saved Meeting alias/schedule/materialization/confirmation/failure-counter behavior, Recall/Svix/url helpers, and live read-only Recall API list canary | Strong meeting-finalize and meeting-scheduler workers | Partial: saved-meeting form reset plus meeting detail transcript/summary/export/cancel states | Provider-backed scheduling/finalization capture canary and richer meeting list/form edge states |
| Reconciliation and work artifacts | Partial: browser covers Team -> Reconciliation with persisted evidence, clusters, outputs, failed output state, worker-backed manual repair result metrics and cluster evidence, cluster drilldown, source audit and dry-run backfill queue submissions plus completed worker-run metrics, team and cluster manual-reconcile queue submissions, run-history filtering/pagination, approval-to-reconciliation technical-detail links, approval accept/reject durable-state effects, partial bulk approval failure recovery, invalid manual-reconcile operator errors, private/specific-user cluster visibility filtering, direct cluster URL denial, and mobile no-overflow layout | Covered through team reconciliation page/action route contracts | Strong reconciliation queue action boundary tests | Strong reconciliation schema, normalization, backfill, resolver, dashboard snapshot, source-ref, visibility-floor, authority, planner, production-sampling, MCP capture, and live artifact eval coverage | Strong reconciliation worker audit/backfill/scoped repair coverage, including separate evidence, association, resolver-output, and projection repair metrics | Partial: dashboard and cluster pages render snapshot/drilldown states and output IDs/source refs; approval rows cover human-readable payload fields, current member/parent-object/board/lane/audience labels, calendar resolution schedules, bounded disclosures, evidence labels, multi-record technical-details links, and stale/partial bulk recovery states | Richer browser coverage for stale approval cross-state edge cases |
| Job recovery and failed work | Partial: admin dashboard retry/dismiss flow covers failed embedding work, retry metadata clearing, and dismissal persistence | Strong retry/dismiss/dashboard route coverage plus integration cooldown exclusion, cron reconcile auth/failure behavior, and direct finished archive route coverage | N/A | Strong job-recovery PGlite coverage, including provider cooldown exclusion and retained finished-job archive pagination | Janitor worker covered | Partial job recovery list component with filters, single retry/dismiss, bulk retry/dismiss, confirmation, retry status, and finished archive states | Richer dashboard edge states and worker-finished archive transitions |
| Onboarding | Partial: checklist renders on the dashboard, manual completion mutates through the API, dismissal persists across reload, and reopening restores the checklist | Strong checklist route coverage | Strong onboarding action coverage | Strong PGlite checklist inference, dismiss/reopen, manual completion, and team isolation | Missing | Partial checklist static, dismissed/reopen, dismiss, pending-disabled, step-link, and manual-completion states | Broader app-page checklist interaction breadth |
| Suggestions and background agent actions | Partial: capture-to-suggestion-to-acceptance creates durable task/calendar state, object-update approval updates an existing object without duplication, item-level Pending/Failed counts, failed approval filter/retry state and Work-attention exclusion, mixed bulk-accept/merge-review separation, and bulk approval failure recovery are browser-covered | Missing route coverage if surfaced later | Strong suggestions action boundary tests, including bounded bulk accept/reject payloads | Strong PGlite suggestions scope, visibility-filtered pending/failed item counts, mixed-bundle filtering, dedupe, accept/reject, task/object/calendar/decision durability, selected bulk-accept merge-review exclusion, and cross-team failure behavior | Partial: deterministic suggestion worker processor tests, deterministic background proposal eval for visibility-safe conversation reviews, plus opt-in live-model extraction/projection eval | Partial: approvals pending/failed counts and empty states, embedded failed-sibling filtering, pending/error interaction states, mixed bulk accept/reject with merge-review separation, select-all visible and bundle-header selection, stale bundle-level accept recovery, and object cleanup suggestions review/fallback/pagination | Broader browser coverage for calendar edge states |
| Embeddings and retrieval quality | Partial: global search renders semantic document/timeline results and filters in browser with deterministic route data; document drive search covers worker-backed chunk embedding through Qdrant hydration | Strong search/chat route contracts with mocked boundaries | N/A | Strong deterministic retrieval ranking, PGlite hydration, meeting transcript chunk hydration, visibility/team filtering, embedding source planning, Qdrant point IDs, raw-event rendering for every active raw-event source family including replay ref/digest aliases, chat/email/provider events across Drive/GitHub/Linear/Monday/Sentry including GitHub state/branch context, Drive owner/modified/parent context, Linear priority/parent context, Monday workspace/parent/column context, Sentry severity/status/count/error metadata, and web/meeting/document/calendar/webhook/system context, plus LLM wrapper behavior | Partial: embed worker rendered-text handoff for Slack/email/provider events plus payload/skip/stale-source coverage | Partial: global search semantic result rendering and filter contract | Remaining: broader worker-backed browser semantic retrieval and edge-case provider rendering breadth |
| Support and team exports | Partial: signed-in support form submission with persisted team context, team-export create queue/error state, and ready archive signed-download redirect | Missing direct routes if exposed | Partial: support form validation/rate-limit/verification/persistence/email-delivery plus team-export create/download authorization, enqueue, failure, signed-url, and audit behavior | Strong team-export archive integration | Strong team-export worker coverage for ready-state audit rows, terminal-job skips, and partial archive cleanup on failure | Partial: support form defaults/protection/status states plus team-export empty/action status/list/download states | Anonymous support browser path and full worker-backed export completion E2E |
| Platform contracts: DB, queue, S3, env, rate limits | N/A | Rate-limit behavior covered through routes and token bucket | Queue degradation covered in some actions | Partial: env, crypto, rate limit, Qdrant, pagination, DB schema contracts, queue wrappers, Sentry scrubbing, and S3 wrappers covered | Queue/S3 wrapper behavior covered in shared tests | N/A | Deeper DB migration-compat history, queue/S3 live-emulator canaries |
| Frontend components and UI states | Partial only where E2E crosses real pages | N/A | N/A | N/A | N/A | Partial: nav, job recovery list, capture composer, approvals, chat pane, document drive/search/detail, MCP management/key share, Slack settings, Telegram settings/forms, email whitelist, object detail, board add-item flow, onboarding checklist, timeline controls/page helpers, timeline moment rows/feed infinite-scroll, collection count chrome, hub/status/error helpers | Boards, team settings, integrations, richer empty/error/loading states |

## High-Level Read

- Strongest coverage today: shared domain isolation with PGlite, core server
  action contracts, high-value API route contracts, document extraction,
  Saved Meeting scheduling/quick-join contracts, meeting finalization, and core
  MCP route contracts.
- Most bug-finding coverage today: Playwright E2E and PGlite/worker
  integration tests, because they cross real boundaries.
- Most contract-freezing coverage today: mocked server-action and API route
  tests. These are valuable for auth/status/validation/side-effect intent, but
  they are less likely to discover deep product bugs on their own.
- Timeline moment coverage now checks the server-built
  `timeline_moments_page.v1` DTO contract, bounded page scanning, moment-agent
  retrieval, exact metadata moment lookup for stable source identities, outbound
  MCP moment tools, feed hydration into the renderer, and missing provider
  grouping-metadata diagnostics. Component tests now also pin
  focused moment visibility, selected row semantics, and inspector auto-open;
  shared tests pin the AI presentation cache-key inputs, optional eligibility,
  fenced prompt construction, injected structured-generation boundary,
  persisted cache provenance lookup, stale-cache rejection, queue dedupe, and
  worker-driven generation/storage through the shared LLM boundary;
  daily digest tests now prove digest prompts consume bundled moments instead
  of raw event rows while preserving source-event counts, and prove quiet
  windows skip summarization and delivery unless fresh activity, actionable
  approvals, or upcoming calendar context makes the digest useful; retry-race
  coverage preserves concurrently generated/sent rows, configured-hour
  spring-gap and fall-back cases pin daylight-saving-safe fresh-cycle
  boundaries, post-boundary ingests are deferred to the next cycle, and
  PGlite coverage proves fresh archive and merge transitions remain useful;
  timeline observability tests now pin privacy-safe page/API dogfooding counters
  for row-count reduction, scan pressure, missing grouping metadata, AI
  presentation cache status, and visibility cache partitioning;
  an opt-in live OpenRouter smoke test
  (`OPENROUTER_LIVE_TESTS=1` with `OPENROUTER_API_KEY`) now verifies the
  timeline moment presentation prompt/schema can produce a concrete
  non-provider title and source-event preview IDs through the real structured
  LLM boundary;
  `pnpm test:agent-eval:live` now runs an opt-in real-model `askAgent` eval
  against seeded durable task/calendar state, provider/document/meeting
  retrieval, launch synthesis, and email/project/incident/document renewal-risk
  synthesis through the same non-browser bot entrypoint used by Slack and
  Telegram;
  `pnpm test:suggestions-eval:live` now runs an opt-in real-model suggestion
  worker eval against seeded customer email evidence and asserts approval
  projection plus source-ref provenance;
  shared moment projection tests now include persisted live-adapter metadata
  shapes for current provider writers, including nested Linear metadata,
  Monday.com content-derived labels, and Sentry release versions;
  worker script tests pin the dry-run-first policy for bounded timeline moment
  presentation cache prewarming;
  a manual live seeded-browser pass has covered owner login, timeline load,
  desktop and mobile screenshots, and horizontal overflow checks; checked-in
  browser coverage still needs to absorb more of that visual QA. Remaining risk
  sits in
  future handoff/update DTO design, future provider-adapter payload breadth, and
  broader E2E flows.
- Biggest remaining product-risk gaps: broader live-model chat breadth beyond
  the durable-state, Monday/Sentry provider-backed retrieval, document and
  meeting retrieval, custom MCP, launch synthesis, and renewal-risk smoke cases,
  broader document/provider-backed source-capture contracts, remaining E2E browser
  approval edge states, broader document extraction/search UI, integration
  OAuth/share/activate flows, richer calendar, real external MCP custom-server
  behavior, and richer onboarding/job-recovery edge states.

## Current Test Surface

### Root Commands

- `pnpm test` runs package Vitest suites through Turbo with package-level
  concurrency set to `1`.
- `pnpm --filter @timeline/db test` runs DB/PGlite schema contract tests.
- `pnpm test:eval` runs the fast deterministic shared agent/retrieval eval
  slice, including dashboard chat route action/HITL selection and persisted
  observability, dispatcher-level Slack/Telegram `/ask` delivery through the
  real non-browser `askAgent` wrapper, web-rich versus external-chat presentation
  (including a broad weekly-plan comparison), object-summary source-ref/visibility
  coverage, and a worker-level background proposal eval for visibility-safe
  conversation reviews.
- `pnpm test:agent-eval:live` runs an opt-in live OpenRouter `askAgent` eval
  against seeded durable workspace state, Monday integration search, Sentry
  resource drill-in, document retrieval, meeting transcript retrieval, custom
  MCP customer-health tool use with evidence capture, cross-surface
  customer-launch synthesis, and
  email/project/incident/document renewal-risk synthesis. Set
  `AGENT_LIVE_ENV_FILE=/path/to/.env` when the current shell has not already
  loaded the live LLM env. Deterministic agent evals use an internal harness for
  tool-trace execution, answer synthesis, non-browser ask model scripts,
  dashboard chat action/HITL selection, Slack/Telegram ask-surface delivery,
  background proposal generation, and turn-observability capture, and
  deterministic/live agent evals share Qdrant `SearchHit` fixture builders.
- `pnpm test:suggestions-eval:live` runs an opt-in real-model suggestion worker
  eval against seeded customer email evidence.
- `pnpm test:proposal-engine:live` runs an opt-in messy proposal-engine eval
  with real models and, when Qdrant is configured, real embeddings. Isolated
  PGlite team, ~90% noisy fixtures (Sentry spikes, GitHub Actions pulses,
  Bugbot findings, buried `repo#n` / Linear keys, typo fragments, mention soup,
  truncated paste, silent calendar-linked meetings, branding outcome evidence
  without "this is complete"). Safe name-maps are the minority. Cleanup of any
  Qdrant points afterwards. Not CI. Covers implicit `done`, two-task refuse
  (qualify strips a guessed `done`), pending-create prompt listing,
  applyable proposal payloads (assignment names, calendar aliases,
  relationship endpoints, exact-name duplicate hub rewrite), and
  empty-model / timeout / invalid-JSON fallback mint (event-local always;
  conversation review only when the window names exactly one tracked id). Set
  `PROPOSAL_ENGINE_LIVE_ENV_FILE=/path/to/.env` when the shell has not already
  loaded live credentials.
- `pnpm test:transcribe-eval:live` runs an opt-in live OpenRouter speech
  transcription eval through the worker finalization path. Set
  `TRANSCRIBE_LIVE_ENV_FILE=/path/to/.env` when the current shell has not
  already loaded the live LLM env.
- `pnpm test:reconciliation-eval` runs deterministic reconciliation schema,
  surface/scenario matrix, source-ref, visibility-floor, authority-policy,
  planner prompt/schema, normalization, backfill, and resolver evals.
- `pnpm test:e2e-env` runs the deterministic E2E environment and isolated
  Docker-port contract check.
- `pnpm test:dist-imports` builds `@timeline/db` and `@timeline/shared`, then
  imports selected compiled runtime modules with Node.
- `pnpm validate` runs format, typecheck, lint, and knip. Tests run through
  `pnpm test`, `pnpm test:eval`, `pnpm test:reconciliation-eval`,
  `pnpm test:e2e-env`, `pnpm test:dist-imports`, package-filtered Vitest
  commands, or E2E commands depending on the change.
- `pnpm e2e` runs local Playwright E2E through `scripts/run-e2e-strict.ts`.
- `pnpm e2e:prod-smoke` runs the production-ish Playwright smoke suite.

### Playwright E2E

Current local coverage includes core product journeys:

- Deterministic seed fixtures for owner, admin, member, non-member, and two
  teams.
- Deterministic cleanup for seeded E2E users and teams by known IDs/prefix.
- Auth helpers that exercise the real credentials sign-in flow and save
  per-role storage-state files for repeated journeys.
- Seeded owner can sign in, load the app shell, switch teams, and sign out.
- Seeded owner can create a team-visible timeline text event and a seeded
  member can see it.
- Timeline visibility checks for team, private, specific-user, and cross-team
  isolation.
- Timeline browser filtering checks for source, author, date range, clear-filters
  recovery, and preserving audit-trail mode while applying filters.
- Timeline inspector lifecycle checks for event visibility edits and
  Slack/Telegram-style conversational-event removal.
- Team reconciliation dashboard, persisted cluster drilldown, failed output
  state, invalid manual-reconcile operator errors, private/specific-user
  cluster visibility filtering, direct cluster URL denial, and mobile
  no-overflow layout.
- Object create/detail/update/archive behavior.
- Object note creation.
- Object relationship link/unlink behavior, including bidirectional detail-page
  visibility.
- Board create/list/detail behavior with matching object visibility.
- Calendar all-day and timed create/edit/delete behavior, team/private/
  specific-user visibility, recurrence/show-as editing flows, and toolbar
  navigation assertions.
- Document folder creation, RustFS-backed upload, list/detail/version-history,
  rename/delete behavior, and team/private visibility assertions.
- Team admin visibility, member invite/resend/revoke, signed-out invite
  acceptance, role change, admin removal limits, owner removal, and removed-user
  access loss.
- Postmark-shaped inbound email webhook journey: the route accepts an
  authenticated payload, creates a team-scoped `email` raw event, and the owner
  sees the captured customer note on the timeline. Team settings sender
  whitelist E2E verifies blocked senders do not create raw events and allowed
  senders still render in the timeline.
- Agentic core capture-to-approval journey: owner captures a natural-language
  commitment, deterministic background suggestion processing creates task and
  calendar suggestions, owner accepts the approval bundle, and the durable task
  is visible to another team member.
- Browser chat journey: owner asks about a seeded team-visible timeline event,
  sees deterministic `search_timeline` tool activity, an Event citation, and
  the persisted answer after session reload.
- Browser chat visibility journey: member cannot retrieve owner-private
  evidence, can retrieve specific-user evidence when allowed, owner cannot
  retrieve that member-only specific-user evidence, and degraded chat returns an
  honest unverified answer without invented citations.
- Agentic object-update journey: deterministic model output creates an approval
  targeting an existing object, owner accepts it, the object detail updates, no
  duplicate object is created, and a team member sees the team-visible result.
- Browser chat durable-state journey: after accepted task/calendar/object
  suggestions, deterministic chat uses workspace-state tool output, answers
  from durable state, persists/reloads the session, and respects team-visible
  member access.
- Telegram voice approval journey: deterministic Telegram voice capture creates
  an audio raw event, transcription backfills text, suggestion processing
  creates an approval, owner accepts it, and durable task state appears.
- Integrations health-state journey: webhook-degraded attention remains
  non-blocking, provider budget cooldowns disable manual sync, and the mobile
  management layout stays usable without horizontal overflow.
- Integrations source-management journey: an admin activates shared provider
  sources and replaces an active source with another shared connection.
- Integrations catalog journey: a configured native GitHub card starts OAuth
  and redirects to GitHub with the expected client id, redirect URI, scopes, and
  signed state.
- Job recovery dashboard journey: an admin sees seeded failed embedding work,
  retries one item through the real API/queue path, verifies failure metadata is
  cleared, dismisses another item, and confirms dismissal persists after reload.
- Meeting notetaker journey: owner saves an auto-join recurring meeting, sees a
  scheduled capture, opens a finalized transcript with summary and speaker
  chunks, and verifies the meeting summary appears on the timeline with an open
  transcript link.
- Production-ish smoke verifies seeded owner login and timeline load.

Current CI E2E workflow is manual and `continue-on-error: true`, so E2E does
not yet gate merges.

### Web Server Actions

Covered action files:

- `documents.test.ts`: document action auth, validation, IO orchestration, and
  revalidation behavior.
- `meetings.test.ts`: meeting action behavior around scheduling/finalization
  contracts.
- `visibility.test.ts`: event/team visibility update behavior.
- `events.test.ts`: text event capture, visibility parsing, audio upload
  validation, user-scoped object keys, and queue degradation behavior.
- `teams.test.ts`: create/rename team behavior, invite permissions,
  resend/revoke invite behavior, owner-only admin invites,
  already-member/open-invite errors, member role/remove behavior, last-owner
  protection, delivery status, cookies, redirects, cleanup side effects, and
  revalidation behavior.
- `invites.test.ts`: invite token validation, unauthenticated signup redirect,
  accept/decline behavior, expired/used/wrong-account/already-member behavior,
  fallback solo-team recovery, recipient invite handling, active-team cookie,
  and revalidation behavior.
- `objects.test.ts`: validation, scope failure, create/update/archive,
  relationships, notes, notification actions, suggestions, friendly DB error
  mapping, and revalidation behavior.
- `boards.test.ts`: validation, create/update/delete board views, bad filters,
  missing-board behavior, scope failure, and revalidation behavior.
- `calendar.test.ts`: auth/no-team handling, invalid IDs/dates,
  create/update/delete, visibility payloads, not-found behavior, dependency
  failures, and revalidation behavior.
- `suggestions.test.ts`: validation, scope failure, accept/reject item,
  accept-all/reject-visible success and partial failure, no-longer-pending
  behavior, error mapping, and approval-surface revalidation behavior.
- `onboarding.test.ts`: checklist dismissal/reopen/step-open behavior,
  redirect handling, scope failures, and revalidation behavior.
- `slack.test.ts`: bind/unbind validation, provider failures, audit records,
  onboarding completion, analytics, and revalidation behavior.
- `telegram.test.ts`: personal/group link-token generation, username
  validation, admin-only revoke/unbind behavior, onboarding completion,
  analytics, and revalidation behavior.
- `support.test.ts`: validation, IP and identity rate limits, Turnstile
  verification, authenticated/anonymous persistence context, missing support
  email handling, delivery failure handling, and sent-state updates.
- `team-exports.test.ts`: create authorization, queued export/audit/enqueue
  behavior, enqueue failure state, download authorization redirects,
  ready/expired handling, signed URL generation, and download audit behavior.
- `chat.test.ts`: archive/unpin/load validation, scope failures, session
  hydration, not-found behavior, dependency failure reporting, and chat
  revalidation behavior.

Important uncovered action files:

- Auth/sign-up/sign-in and legal acceptance actions remain thin; no
  high-priority product action file is fully uncovered in this section.

### Web API Routes

Covered route tests include:

- Email inbound webhook.
- Telegram webhook.
- Slack events webhook, signed slash commands, install OAuth, and user-link OAuth.
- Google Drive, Linear, Recall, and other provider webhooks where exposed.
- Per-job and bulk job recovery retry/dismiss routes.
- Search route auth/config/rate-limit/schema/scope behavior.
- Timeline route auth, active-team, query parsing, cache, response shaping,
  author hydration, and audio signing behavior.
- Chat route auth/config/rate-limit/schema/session/streaming behavior, scoped
  tool construction, MCP fallback, and persistence callback behavior.
- Documents list/search route auth/config/rate-limit/schema/cache/scope
  behavior, folder filters, defaults, pagination, and response serialization.
- MCP OAuth/server/keys/servers/tools routes auth/team/role gates, request
  parsing, CORS, OAuth state and redirect behavior, server management,
  discovery/test-call behavior, key mint/revoke, and audit intent.
- Onboarding checklist route auth, active-team, scoped serialization,
  dismiss/reopen/complete, cache invalidation, analytics, and malformed patch
  handling.
- Object sections route auth, active-team, section validation, scoped page
  serialization, cache inputs, and missing object behavior.
- Cron reconcile route disabled/forbidden states, POST/GET execution, count
  serialization, and dependency failure mapping.
- Jobs dashboard route admin gate, summary serialization, retry dispatch for
  document/transcribe/extract/embed, invalid input, not-found, and non-audio
  retry behavior.
- Native integration OAuth start/callback, provider-connection resource sharing,
  activation, manual sync budget-paused/enqueue behavior, delete/disconnect
  webhook deprovision behavior, and legacy selection guard behavior.

Important uncovered route files:

- No native integration or Slack route files called out by this plan remain fully uncovered.

### Shared Packages

Covered shared areas include:

- Team scope and team isolation.
- Documents scope and object key behavior.
- Meetings scope and meeting-bot helpers.
- Calendar scope.
- Suggestions scope: create/merge, visibility, accept/reject, duplicate
  acceptance, task/object/calendar mutations, rejection no-op behavior, and
  cross-team target failure behavior.
- Objects domain behavior: CRUD/update changes, notes, chat sessions, board
  views, suggested changes, archived filtering, and cross-team isolation.
- Job recovery, including finished-job archive pagination.
- Team exports.
- Integrations provider parsing and event writer behavior, including
  project-shaped Monday item links staying provider-record artifacts instead of
  customer-project clusters.
- Slack and Telegram API/dispatcher/security behavior, including source-capture
  raw events with replay payload refs/snapshots, linked attribution, visibility
  defaults, text queue handoff, media/document routing, and idempotent
  retries/edits.
- Telegram DM text and media capture now have regressions proving captured
  conversations enqueue the right downstream work: text/captions enqueue
  extract/embed plus debounced conversation-review suggestions, voice/audio
  enqueues transcription, and the transcribed media path records durable audio
  payload refs, preserves pre-existing snake_case/camelCase payload refs,
  normalizes reconciliation evidence, and hands off to extract/embed plus
  conversation-review suggestions.
- MCP auth, OAuth state, tool namespace, server handler behavior, and outbound
  moment list/expand privacy boundaries.
- Agent tools structural behavior plus fast deterministic evals for timeline
  citations, bundled moment retrieval/expansion, durable task/calendar state,
  visibility fences, and failed-tool honesty.
- MCP tool safety evals for fenced custom-server output, nested
  `<external_content>` neutralization, call failures, and `needs_reauth`
  reconnect contracts.
- LLM wrappers for chat, embed, transcribe, memory, and vision using injected
  models.
- Qdrant client/point-id behavior, deterministic timeline retrieval ranking,
  and raw-event embedding source planning.
- Email parser/dispatcher/outbound behavior, including inbound source-capture
  raw events, sender-auth handling, sender whitelist filtering, visibility
  defaults, attachment/audio routing, direct text queue handoff, and duplicate
  delivery recovery.
- Crypto secrets, rate limiting, citations, pagination, chunking, env reset,
  and embedding source planning.

Important uncovered shared/package areas:

- Live S3/RustFS emulator canaries beyond the mocked wrapper contract tests.
- Broader live-model agent eval scenario families beyond the current
  cross-surface launch, renewal-risk, and custom MCP customer-health behavior.

### Worker Processors

Covered worker areas include:

- Extract worker.
- Embed worker.
- Document extract worker.
- Transcribe worker.
- Calendar recurrence worker.
- Meeting finalize worker.
- Meeting scheduler worker.
- Object summary worker.
- Suggestions worker.
- Janitor worker.
- Overdue scan worker.
- Daily digest worker.
- Integration sync worker.
- Reconciliation worker.
- Railway config checks.

No named worker processor remains in the "important uncovered" bucket; the
remaining integration risks are provider-backed E2E/canary and UI breadth.

### Frontend Components and UI Logic

Covered frontend pieces are still narrow:

- Navigation items.
- Job recovery list filtering, single/bulk retry and dismiss behavior, retry
  status, confirmation, and finished archive display/pagination/error states.
- Support form and team forms for inbound email whitelist, invite
  role/link/email-failure, and team-export panel states.
- Calendar recurrence edit/delete, event-list URL controls for `eventQ` and
  `eventScope`, infinite-scroll list paging, filtered result/empty states for
  query/scope,
  create validation, normalized recurrence preset mapping, specific-user
  defaults, save failure recovery, optimistic state, and redacted busy
  rendering.
- Capture composer static/private states, empty validation, durable queue
  warnings, audio/document upload routing, recorded-clip text preservation, and
  partial attachment failure retry state.
- Timeline controls, timeline page helpers, moment/source-event mode rendering,
  and timeline feed pagination dedupe.
- Hub status, timeline moments, safe redirects, auth redirects, site URL,
  Turnstile, and UX error helpers.
- Meeting saved-form reset and meeting detail summary/transcript/export/cancel
  states.

Important uncovered UI areas:

- Capture composer richer interaction states.
- Timeline list cards and richer timeline feed states.
- Document detail interactions and edge states.
- Chat pane.
- Object forms/detail pages.
- Board view edge states.
- Team settings/admin destructive member controls and page composition.
- Integrations UI.
- Broader provider-backed MCP live/custom-server behavior and richer browser/chat
  reconnect/error states.
- Onboarding page-level UI beyond checklist controls.
- Loading, empty, permission-denied, and error states.

## Coverage Plan

### Phase 1: Make E2E A Real Product Safety Net

Goal: cover the critical user journeys with deterministic seed data and make
the local E2E command reliable enough to gate CI.

- Completed:
  - Dedicated E2E seed fixtures for owner, admin, member, non-member, and two
    teams.
  - Login/session helpers that cover the real login flow and reuse
    authenticated storage state for repeated journeys.
  - Cleanup that removes E2E-owned users and teams by deterministic IDs/prefix.
  - Sign in, app shell, team switcher, and sign out.
  - Capture text event plus private/team/specific-user/cross-team visibility
    assertions.
  - Object create/update/detail, notes, archive state, relationship link/unlink
    from both object detail pages, board placement, and board filtering.

- Remaining:
  - Richer timeline feed/list interaction states.
  - Broader document extraction/search behavior beyond the worker-backed
    semantic-search journey.
  - Broader calendar edge states beyond the core all-day/timed
    create/edit/delete, visibility, recurrence/show-as, toolbar, and component
    event-list filtering coverage.
  - Slack settings and richer Telegram settings error states with provider calls
    stubbed at the boundary.
  - Provider-backed MCP behavior and richer browser/chat reconnect/error states.
  - Job recovery finished-archive transitions and richer dashboard edge states.
- Keep external provider flows deterministic by using test doubles, local route
  interception, or explicit skip messages when required secrets are unavailable.
- Convert `.github/workflows/e2e.yml` from manual/non-gating to a staged CI
  gate once the suite is stable:
  - PR gate for core local E2E.
  - Scheduled/manual job for slower provider or production-ish smoke checks.
  - Remove `continue-on-error: true` for the core E2E job.

### Phase 2: P1 Agentic Core, Suggestions, Chat, And Embeddings

Goal: prove the core product loop works end to end: captured source data becomes
timeline events, background agents propose useful work, accepted suggestions
create or update durable task/object/calendar state, chat can reason over that
state, and embeddings/retrieval preserve source context and visibility.

This phase is P1 because it protects the main Timeline promise. Browser E2E
should cover one or two representative user loops, while worker/integration
tests and evals carry the branch coverage and model/tool behavior.

- Completed:
  - Web capture to approval E2E for a team-visible commitment that becomes
    durable task/calendar state after owner acceptance.
  - Web capture handoff tests prove captured source events can enqueue approval
    suggestions directly. Telegram text capture now schedules debounced
    conversation-review suggestions, so conversational approvals are based on
    the bounded evidence window rather than a single source event.
  - Telegram voice/audio capture has deterministic coverage from webhook-style
    media ingest through transcription handoff, suggestion creation, browser
    approval acceptance, and durable task state.
  - Suggestion worker processor seam with deterministic PGlite coverage for
    fallback task/calendar suggestions, model-backed object update suggestions,
    conversation-review planner result projection, private/specific-user
    visibility, output-owned cleanup rejection suppression, object-memory repair
    replay classification, skip stamping, and idempotent reruns.
  - Suggestion action tests for accept/reject/accept-all/reject-visible
    validation, scope failures, no-longer-pending behavior, partial failures,
    errors, and revalidation paths.
  - Shared suggestion durability tests for task metadata, object update
    isolation, calendar cancellation, rejection no-op behavior, and duplicate
    acceptance safety.
  - Embed worker processor seam with deterministic tests for rendered text,
    Qdrant point payloads, stable point IDs, success stamping, and non-team
    skip behavior.
  - Deterministic retrieval ranking tests for query embedding, Qdrant option
    forwarding, score ordering, duplicate hit merging, stale payload filtering,
    cross-team fact dropping, and DB-backed visibility filtering.
  - Fast deterministic chat-agent evals for seeded timeline citations,
    durable task/calendar state after suggestion acceptance, private and
    specific-user visibility fences, cross-team filtering, and honest failed
    tool behavior.
  - Focused `askAgent` wrapper tests for env/member gates, prompt/user/tool
    wiring through an injected model, empty output, model failure, and Telegram
    truncation.
  - Dispatcher-level Slack and Telegram `/ask` surface evals that route through
    the real non-browser `askAgent` wrapper, execute `search_timeline`, deliver
    plain bot text, and capture turn observability.
  - Worker-level background proposal evals that run conversation review through
    the real suggestion worker path, create grounded task proposals, and verify
    private conversation rows stay out of prompts and evidence.
  - Browser chat E2E for seeded timeline retrieval, visible `search_timeline`
    tool activity, Event citation chips, citation links, persisted session
    reload, private/specific-user visibility, and degraded no-citation answers.
  - Browser object-update approval E2E proving an accepted object update targets
    the existing object, changes the detail page, and does not create a
    duplicate object.
  - Browser chat E2E over accepted durable task/calendar/object state using a
    deterministic workspace-state tool step, persisted session reload, and
    team-visible member access.
  - Browser global search E2E for semantic document/timeline result rendering,
    source/type filter forwarding, and result links using deterministic route
    data.
  - Deterministic MCP safety evals for fenced untrusted output, nested
    external-content tag neutralization, failed calls, `needs_reauth` output
    shape, and non-browser `askAgent` provider-backed MCP tool loops.

- Remaining:
  - Broader live-model chat scenario breadth beyond the current durable-state,
    provider-backed retrieval, document/meeting retrieval, custom MCP,
    launch-synthesis, and renewal-risk smoke cases.
  - Real external MCP custom-server behavior and richer chat reconnect states.
  - Broader source-capture contracts for documents and integrations.
  - Scheduled Slack auth-test token coverage, provider-backed native Slack
    canary, scheduled Postmark capture canary credentials, and settings UI flows.
  - Scheduled Telegram capture canary credentials and richer image/OCR to
    approval behavior.

- P1 source capture contracts:
  - Web capture creates a raw timeline event with the expected author, source,
    visibility, inline source payload ref/digest/snapshot, full-replay
    reconciliation evidence, object links where applicable, and follow-up jobs.
  - Telegram DM text capture creates a raw event and enqueues extract, embed,
    and debounced conversation-review suggestion work for the source
    conversation, while stamping an inline source payload ref/digest/snapshot
    that normalizes to full-replay reconciliation evidence.
  - Telegram voice/audio capture creates an audio raw event, enqueues
    transcription, backfills transcript text, records a durable audio payload
    ref/digest and transcript snapshot, preserves existing payload refs across
    metadata key spellings, normalizes reconciliation evidence, and enqueues
    extract/embed plus conversation-review suggestion work from the transcript.
    Telegram document-picker audio child rows also stamp
    attachment-level inline source refs, digests, and snapshots before
    transcription so reconciliation evidence is full replay from capture time.
  - Telegram image/document messages route attachments to document extraction;
    captions enqueue direct text follow-up work, while image-only messages do
    not invent approvals before extraction/OCR.
  - Slack captures have deterministic dispatcher/route tests proving source
    payloads become team-scoped raw events with inline payload refs, digests,
    snapshots, and full-replay reconciliation evidence, including audio
    attachment child rows before transcription. Slack suggestion work now runs
    through debounced conversation reviews. Email has dispatcher/route
    coverage proving Postmark parent events stamp inline payload refs, digests,
    compact snapshots, and full-replay reconciliation evidence, plus browser
    E2E from a Postmark-shaped webhook payload to a team-scoped timeline row and
    sender-whitelist block/allow E2E, while email proposal work remains
    raw-event anchored.
  - Email attachment capture now promotes non-audio attachments into captured
    document/version rows linked to the parent raw event and queues document
    extraction when document S3 plus Redis are configured.
  - Worker-backed extraction now covers the Postmark attachment path from
    inbound email payload to captured document chunking and doc-chunk embed
    enqueue with parent raw-event provenance.
  - Generic ingest webhooks stamp signed textual payloads with inline source
    payload refs, body digests, and compact redacted snapshots before link
    extraction and reconciliation evidence normalization; duplicate deliveries
    keep one raw event and one stable full-replay evidence row while repairing
    link artifacts and queue handoff.
  - Provider document harvest now stamps the upload raw event with provider
    identity, `source_payload_ref`, `payload_digest`, and a compact
    `integration_harvest_document` snapshot before extraction is queued, while
    provider-supplied source-payload ref/digest aliases are canonicalized
    without losing the original provider metadata in the source snapshot.
  - Ordinary document uploads now stamp the upload raw event with an
    `s3://documents/<objectKey>` `source_payload_ref`, optional checksum digest,
    and compact `document_upload` snapshot that normalizes to full replay
    evidence; caller-supplied replay ref/digest aliases are canonicalized before
    the raw event and evidence row are written.
  - Document and folder lifecycle rows such as rename, move, delete, restore,
    and visibility changes now stamp inline source refs, payload digests,
    compact `document_lifecycle_event` snapshots, and full replay reconciliation
    evidence; folder-only events also emit `document_folder` anchors.
  - Calendar scheduled/event/update/cancelled raw-event mirrors stamp inline
    source payload refs, payload digests, and compact snapshots, refresh those
    snapshots when mutable calendar rows change, and normalize current evidence
    to full replay.
  - Object and board direct-write raw events stamp inline source refs, payload
    digests, and compact system snapshots; invalid, cross-team, or replay-ref
    missing source events fail closed instead of synthesizing source refs, and
    their reconciliation evidence preserves the digest for replay-safe fixture
    generation.
  - Meeting finalization stamps the consolidated transcript raw event with an
    inline meeting payload ref/digest/snapshot, reuses the calendar replay
    envelope for generated meeting-calendar mirrors, and normalizes meeting plus
    calendar evidence to full replay.
  - Native integration event writes stamp canonical source payload refs/digests,
    normalize evidence/artifacts, enqueue extraction plus embedding for newly
    inserted raw events, stamp queue-handoff failures without blocking
    evidence normalization, and skip duplicate queue handoff on replay.
    The extract worker remains the source of follow-on suggestion enqueueing
    after provider raw-event fact extraction.
  - Reconciliation evidence audits return a release-gate summary that fails on
    missing evidence and non-allowlisted degraded replay rows. Release commands
    should use `--fail-on-release-gate`; historical degraded sources must be
    explicitly named with `--allow-degraded-source=<event_source>`. The worker
    script parser/runner has direct unit coverage for those flags and the
    non-zero release-gate exit path.
  - Queue-backed reconciliation audit/backfill jobs persist completed
    `reconciliation_runs` metrics. Audit rows include release-gate pass/fail
    and bounded failure rows; backfill rows include scanned/candidate/normalized
    counts. The Team → Reconciliation recent-run list renders those persisted
    audit/backfill summaries so operators can read the result after queue
    payloads expire.
  - Production-sampling release commands support `--fail-on-failures`, with
    direct script parser/runner tests proving closed-beta/post-deploy gates can
    stop on failed samples. The same script coverage proves repeatable
    `--confirm-fixture=<caseName>:<packetFingerprint>` options flow into the
    release report so reviewed misses can be promoted to deterministic fixtures,
    and `--team=<uuid>` persists the redacted report as a dashboard-visible
    reconciliation eval run.
  - Capture tests must assert private/team/specific-user visibility at the raw
    event boundary, not only in later list views.
- P1 suggestion worker contracts:
  - Raw event text such as "I'll send the proposal next Tuesday" produces task
    and calendar-event suggestion items with evidence linked to the source
    event.
  - Raw event text with explicit decision language can produce approval-backed
    decision object suggestions without creating durable state before
    acceptance.
  - Slack/Telegram raw events schedule conversation-review jobs, and the review
    worker handles contradiction, pending proposal revision, accepted-proposal
    correction proposals, and minimal visible evidence citations.
  - Slack/Telegram conversation reviews can propose reusable Q&A as
    `object_note` create/update items, including existing-note prompt context
    for clear corrections.
  - Raw event text about an existing account/project produces an object update
    suggestion instead of a duplicate object where the fixture makes the target
    unambiguous.
  - Model-backed suggestion output and deterministic fallback output are both
    covered with injected LLM fakes.
  - Private and specific-user events are stamped as skipped before the
    suggestion LLM boundary, matching extract/embed privacy behavior.
  - Capture-time suggestion jobs use a pre-extraction model stamp so an
    extract-triggered rerun can enrich approvals with same-event facts.
  - Cross-team events and target IDs are rejected or ignored.
  - Worker retries are idempotent and do not create duplicate bundles/items.
  - Skipped events are stamped with a bounded reason instead of silently
    disappearing.
- P1 suggestion acceptance contracts:
  - Accepting a task suggestion creates or updates durable task/object state.
  - Accepting a calendar suggestion creates, updates, or cancels the calendar
    event requested by the suggestion payload.
  - Accepting an object suggestion creates, updates, archives, or links only
    team-scoped objects.
  - Accepting an `object_note` suggestion creates notes idempotently and can
    update an existing Q&A note through the agent audit/change path.
  - Rejection leaves durable task/object/calendar/decision state unchanged.
  - Duplicate acceptance is safe.
  - Acceptance writes the expected evidence/audit/change intent and revalidates
    the relevant app surfaces.
- P1 browser E2E journey:
  - Owner captures a natural-language commitment in the timeline.
  - The deterministic suggestion processor runs or is triggered by the test
    fixture.
  - The suggestion appears in the product UI with source evidence.
  - Owner accepts the suggestion.
  - The resulting task/object/calendar state appears in the relevant product
    surface.
  - A member can or cannot see the result according to the original event
    visibility.
- P1 chat agent evals:
  - Asking about seeded timeline facts returns the correct answer with source
    attribution/citations.
  - Asking about task/object/calendar state uses the relevant native tools or
    scoped context, not only free-text retrieval.
  - Failed tools are reported honestly without hallucinated success.
  - Private, specific-user, and cross-team facts stay hidden.
  - Untrusted MCP/tool output is fenced before it can influence the answer.
  - Session persistence records the user and assistant turns when persistence is
    enabled.
- P1 embedding and retrieval contracts:
  - Raw event rendering includes source context such as Slack channel/thread,
    Telegram sender/chat/caption, email sender/subject/forwarding/attachments,
    document metadata, and Drive/GitHub/Linear/Monday/Sentry integration
    origin, URLs, and external ids.
  - Embed worker sends the expected rendered Slack, email, and provider event
    text to `llm.embed`.
  - Qdrant point payloads include team ID, source kind, occurred-at timestamp,
    author, visibility metadata, and stable point IDs.
  - Re-embedding updates the same point instead of creating duplicates.
  - Deterministic vector fixtures prove semantic retrieval returns the expected
    event, preserves ranking, merges duplicate hits, drops stale payloads, and
    filters by team/visibility.
  - Chat eval fixtures include timeline retrieval/citation, provider-filtered
    integration retrieval, document chunk retrieval/citation, meeting transcript
    chunk retrieval/citation, dashboard action/HITL selection, Slack/Telegram
    ask-surface delivery, web-rich versus ID-free concise external presentation,
    background proposal generation, durable
    task/calendar state, failed-tool honesty, and private/specific-user/team
    fences.
- Test command target:
  - `pnpm test:eval` runs the fast deterministic shared agent/retrieval eval
    slice, including dashboard chat action/HITL selection, Slack/Telegram
    `/ask` delivery through the real non-browser `askAgent` wrapper,
    object-summary source-ref/visibility checks, and background proposal
    generation through the worker suggestion path.
  - Keep broader provider-backed/live-model evals manual or scheduled until
    they are stable, budgeted, and clearly reported.

### Phase 3: Server Actions

Goal: every action file has direct tests for auth, active-team checks,
validation, permission behavior, durable side effects, queued side effects, and
revalidation paths.

- Completed:
  - `teams.ts`: create/rename team, invite permissions, admin invite owner-only
    rules, resend/revoke invite behavior, already-member/open-invite behavior,
    member role/remove behavior, last-owner protection, delivery status,
    cleanup side effects, cookie, redirect, and revalidation behavior.
  - `invites.ts`: token validation, accept/decline behavior, expired/used
    invite handling, wrong-account/already-member paths, fallback solo-team
    recovery, recipient invite handling, active-team cookie, and revalidation
    behavior.
  - `objects.ts`: validation, scope failure, create/update/archive, notes,
    relationships, suggestions, notification actions, friendly DB error
    mapping, and revalidation paths.
  - `boards.ts`: validation, create/update/delete board views, bad filters,
    missing-board result, scope failure, and revalidation paths.
  - `calendar.ts`: auth/no-team, invalid dates/IDs, create/update/delete,
    visibility payloads, not-found behavior, dependency failures, and
    revalidation paths.

- Remaining:
  - `objects.ts`: restore behavior, deeper permission failures, and
    team-scoped persistence covered through PGlite/shared integration.
  - `boards.ts`: team-scoped persistence covered through PGlite/shared
    integration.
  - `calendar.ts`: deeper action-level visibility user validation; private/team
    visibility and queue behavior are covered through action plus shared
    integration coverage.
- `chat.ts`: deeper PGlite-backed session create/pin and object-isolation
  behavior beyond the mocked server-action boundary.
- `slack.ts`: deeper team-isolation coverage beyond the mocked server-action
  boundary.
- `team-exports.ts`: browser UI/E2E coverage for create/download flows.
- `telegram.ts`: deeper PGlite-backed cross-user/team protection beyond the
  mocked server-action boundary.

### Phase 4: API Routes

Goal: route tests cover HTTP contracts directly: status, response body,
headers, auth, rate limit, validation, team isolation, dependency failure, and
idempotency.

- Completed:
  - Timeline route: auth, active team, membership failure, filters, cache key,
    author hydration, response shaping, audio signing, and malformed query
    handling.
  - Chat route: auth, config, invalid JSON/schema/UI messages, active team,
    membership failure, rate limit, session lookup/create, MCP fallback, scoped
    tools, stream response, and persistence callback behavior.
  - Documents list/search routes: auth, config, rate limit, malformed input,
    active team, membership failure, folder filters, cache keys, defaults,
    pagination, and response serialization.
  - MCP routes: outbound server CORS/rate-limit/JSON-RPC forwarding, OAuth
    start/callback state and redirect behavior, team MCP server management,
    tool discovery/test calls, and outbound key mint/revoke/audit intent.
  - Onboarding checklist route: auth, active-team, scoped checklist
    serialization, dismiss/reopen/complete, cache invalidation, analytics, and
    malformed patch handling.
  - Object sections route: auth, active-team, section validation, scoped page
    serialization, cache inputs, and missing object behavior.
  - Cron reconcile route: disabled/forbidden states, POST/GET execution, count
    serialization, and dependency failure mapping.
  - Jobs dashboard route: admin gate, summary serialization, retry dispatch for
    document/transcribe/extract/embed, invalid input, not-found, and non-audio
    retry behavior.

- Remaining:
  - Richer provider failure surfaces beyond the current OAuth/share/activate/
    manual-sync/disconnect route contracts.
  - Slack provider-backed capture canary coverage; optional Web API
    `auth.test` canary is wired but needs scheduled credentials.
  - Object-section browser E2E flows plus richer onboarding/job-recovery edge
    states.

### Phase 5: Workers

Goal: every processor has integration tests for retry/idempotency/privacy
contracts and unit tests for pure branching.

- P1 suggestions worker: timeline event to task/object/calendar/decision suggestion,
  fallback behavior, visibility scoping, skipped-event stamping, and idempotent
  reruns.
- P1 embed worker: source rendering, embedding calls, Qdrant payloads, stable
  point IDs, visibility filters, stale-source skips, failure stamping, and
  deterministic retrieval smoke coverage.
- Extract worker: team-visible extraction to facts with existing-object links,
  private and specific-user skip stamping, missing row/team mismatch/no-text
  failures, zero-fact idempotency, recent-context privacy filtering, suggestion
  enqueue, embed fanout, and embed enqueue failure stamping.
- Transcribe: broader user-recording/provider attachment transcription canaries
  beyond the current embedded speech fixture.
- Integration sync: attention classification, provider-policy cadence, targeted
  narrowing, provider budget pauses, missing-scope degradation, and provider
  document-harvest create/version/finalize/extract handoff with source payload
  provenance.
- MCP health: covered for production SSRF URL validation, cache invalidation,
  disabled-server skips, failed server status, and team/user overlay behavior.
- Team export: covered for archive permission assumptions, private/team
  visibility limits, and signed URL generation in shared archive tests; covered
  for worker ready-state audit rows, terminal-job skips, and partial archive
  cleanup on failure in worker tests.
- Keep PGlite tests for database semantics and injected fakes for external
  providers, queues, S3, and LLM calls.

### Phase 6: Database, Queue, And Storage Contracts

Goal: protect low-level invariants that application tests rely on.

- Completed `packages/db` tests for:
  - Migration compatibility from empty database.
  - Critical foreign keys and cascade behavior.
  - Partial unique indexes.
  - Visibility defaults and valid enum behavior.
  - Invite/member invariants.
  - Object/relationship uniqueness and soft-delete interactions.
- Completed queue wrapper tests for:
  - Job names, queues, dedupe IDs, retry/backoff options, and repeatable job
    registration.
  - Missing Redis/env behavior and graceful test-mode behavior.
- Completed S3 wrapper tests for:
  - Bucket/env validation.
  - Presigned upload/download URL behavior.
  - Size/content-type failure paths.
  - Delete command-shape behavior for cleanup callers.

### Phase 7: Agent And Eval Coverage

Goal: prove agent workflows behave correctly with realistic tasks, not just
that tool schemas are shaped correctly.

- Completed fast deterministic evals for:
  - Chat answering seeded timeline questions using retrieval/tool context and
    correct citations, including bundled timeline moment retrieval for noisy
    integration bursts.
  - Chat answering seeded object/task/calendar questions using the relevant
    scoped product tools or context.
  - Chat discovering that a background suggestion was accepted and reflecting
    the resulting durable product state.
  - Summarizing document, meeting, and integration facts with source
    attribution.
  - Semantic retrieval of timeline events with deterministic embeddings and
    team/visibility filters.
  - Refusing or fencing untrusted MCP/tool content.
- Store eval fixtures and expected success criteria in-repo.
- Split eval commands into fast CI-safe evals and slower/manual/provider-backed
  evals.

### Phase 8: Component And UI Tests

Goal: cover user-visible states that are too small for E2E but too important
to leave untested.

- Add component tests for:
  - Capture composer validation, submit states, and queue warnings.
  - Timeline feed/list rendering, empty states, filters, and permission
    messaging.
  - Document drive/search/detail loading, error, and empty states.
  - Chat pane message states, citations, failed response, and pinned object
    context.
  - Object forms/detail, notes, relationship editing, and archive states.
  - Board views, add-item flow, and filter controls.
  - Team settings/admin role controls and destructive confirmations.
  - Integrations forms and richer MCP management/key-share settings.
  - Onboarding checklist and dismissals.
- Prefer user-facing role/text assertions over snapshots and CSS-class checks.

## Suggested Command Shape

Once the suite is mature, split commands by layer:

- `pnpm test`: fast unit and integration tests that should always pass.
- `pnpm e2e`: local core Playwright E2E.
- `pnpm e2e:prod-smoke`: production-ish smoke.
- `pnpm test:eval`: fast deterministic agent evals, including dashboard chat
  action/HITL selection, Slack/Telegram `/ask` delivery through the real
  non-browser `askAgent` wrapper, object-summary source-ref/visibility checks,
  and background proposal generation through the worker suggestion path.
- `pnpm test:agent-eval:live`: opt-in live `askAgent` durable-state,
  Monday/Sentry provider-backed retrieval, document retrieval, meeting
  transcript retrieval, custom MCP customer-health tool use, and cross-surface
  launch and renewal-risk synthesis evals.
- `pnpm test:transcribe-eval:live`: opt-in live speech transcription worker
  finalization eval.
- `pnpm test:reconciliation-eval`: deterministic reconciliation eval matrix,
  replay coverage, reconciliation dashboard snapshot contracts, and
  production-sampling artifact loading/report aggregation, including
  committed redacted live-case fixture replay, artifact-kind miss reporting,
  duplicate source-ref stale-pass downgrades, operator CLI failure-gate
  coverage, legacy-provenance cutover CLI gating, and per-ref source-payload
  enforcement.
- `pnpm test:e2e-env`: E2E environment and isolated Docker-port contract smoke.
- `pnpm test:dist-imports`: compiled-package import smoke.
- `pnpm validate`: format, typecheck, lint, and knip.
- `pnpm canary:integrations`: manual secret-safe live OpenRouter structured
  chat, OpenRouter audio transcription, GitHub App, Sentry, Postmark, Telegram,
  Recall, optional Slack Web API `auth.test`, optional signed Slack event
  capture, optional secret-protected Telegram capture, optional DB-polled
  Postmark inbound capture, native OAuth authorize endpoint, and webhook-secret
  canary.
- `pnpm canary:integrations:strict`: same canary, failing unless every row is
  `OK`.
- CI PR gate: validate, reconciliation evals, and compiled-package import
  smoke, with core E2E when stable.
- CI scheduled/manual gate: provider-backed E2E, production-ish smoke, and
  slower evals.

## Priority Order

1. Build deterministic E2E fixtures and expand Playwright coverage for core app
   flows.
2. P1 agentic core: source capture contracts, suggestion worker integration,
   suggestion acceptance into durable task/object/calendar/decision state, chat agent
   evals, and embedding/retrieval correctness.
3. Add server action suites for `teams.ts`, `invites.ts`, `objects.ts`,
   `boards.ts`, and `calendar.ts`.
4. Add remaining route suites for integrations, Slack command/OAuth,
   onboarding, object sections, cron reconcile, and jobs dashboard flows.
5. Finish worker processor coverage for integration sync.
6. Add database, queue, and S3 contract tests.
7. Add component tests for high-value UI states.
