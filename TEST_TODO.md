# Test TODO and Coverage Plan

This document tracks the current test surface and the missing coverage needed
to trust Timeline end to end. Tests should stay coupled to behavior and product
contracts, not private implementation structure.

## Test Status Overview

Last checked in this branch: full `pnpm validate`, `pnpm test:eval`,
`pnpm test:reconciliation-eval`, `pnpm test:dist-imports`, root `pnpm test`,
React Doctor, and `pnpm test:agent-eval:live` pass. React Doctor reported
"No issues found" with a 100/100 score when the score endpoint was available.
The live agent eval used the real `askAgent` OpenRouter path against seeded
durable task/calendar state. Manual live reconciliation eval with real
`llm.chatStructured()` calls also passed 5/5 cases across fourteen ingestion
surfaces, including system events, with AI judge 5/5, average judge score 1.0,
and redacted artifacts in
`/tmp/timeline-reconciliation-live-eval/2026-06-30T23-00-19-939Z/manifest.json`.
Production-sampling over that live run accepted schema-v2 artifacts with
artifact-kind expectations/results and reported 5/5 passed with no ignored
files; the schema-v2 report exposes required artifact-kind miss counts for
closed-beta regression dashboards at
`/tmp/timeline-reconciliation-live-eval/2026-06-30T23-00-19-939Z/production-sampling-report.json`.
The live integration canary reached OpenRouter successfully with the provided
env; GitHub/Monday/Slack/Sentry OAuth or webhook credentials that are present
validated structurally, while the Sentry API token returned a 403 for the
configured org/project and several optional provider credentials remain unset.
The suite includes reconciliation schema contracts, fixture-backed
surface/scenario evals, source-ref and visibility-floor evals, source-payload
replay coverage, forbidden-output eval policy checks, projection-outbox status
mirroring and repair, authority-policy checks, direct-write source refs,
provider `objectMap` artifact coverage, legacy `sourceEventId` stripping,
timeline moment projection, focused link hydration, moment search/expansion,
outbound MCP moment access, raw-event snippet fencing, provider webhook
delivery, artifact status reopen regressions, same-object batch evidence
preservation, cross-team artifact join guards, captured-inbox
promotion/pagination fixes, provider-connection hardening, recurring meeting
capture, Saved Meeting visibility enforcement, scheduler idempotency, strict
meeting URL host matching, generated calendar cleanup,
quick-join/failure/capacity/reuse, partial-cancel finalize queue regressions,
and board/search UI regressions. Current suite shape:

- DB Vitest: 2 files / 13 tests, package-level PGlite schema contract suite now
  runs under root `pnpm test`.
- Shared Vitest: root runner covers more than 90 files, including PGlite
  artifact reconciliation, reconciliation normalization/backfill/resolution,
  authority policy, planner prompt/schema, artifact-kind and forbidden-output
  eval contracts, system-event eval surface coverage, live artifact-kind eval
  artifacts, production-sampling artifact-kind miss reporting, event writer,
  Sentry release and Monday item link artifact capture, resolver DB-state
  artifact-kind assertions, calendar, timeline moments, MCP,
  integration/provider-connection, meeting, document, object, assistant, Slack,
  recovery, connection-attention, and onboarding coverage.
  The shared package runner executes unit tests once and PGlite integration
  tests in isolated chunks so long-lived PGlite state cannot starve later hooks
  during root `pnpm test`.
- Web Vitest: route/action/component coverage
  for search, timeline, core recovery, onboarding, object sections, board
  add-item interactions, provider-connection routes/UI, Slack events/commands/
  install/user-link routes, app dialog flows, approval evidence source-ref
  metadata serialization, and other high-value UI states.
- Worker Vitest: includes extract, transcribe,
  document-extract, meeting-finalize, meeting-scheduler, integration-sync
  attention, mixed partial-failure, and provider document-harvest behavior, overdue-scan, embedding,
  cleanup, reconciliation audit/backfill, advisory-locked manual scoped run
  recording, webhook delivery, team export, timeline moment presentation, and
  janitor behavior.
- Playwright: 17 local core E2E journeys plus 1 production-ish smoke journey.
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
| Team switching and membership | Partial: app shell, team switcher, invite/resend/revoke, invite acceptance, role change, member removal, cross-team isolation | Covered indirectly through active-team gates on many routes | Strong for teams/invites/member role/remove | Strong PGlite team isolation and membership scope | Missing | Missing team admin component tests | Deeper team settings component states and edge-case invite UI |
| Timeline capture and visibility | Partial: create team event, private/team/specific-user/cross-team visibility | Strong for timeline list/search contracts, moment/source-event mode handling, focused moment hydration, and audio signing | Strong for capture and visibility actions | Strong PGlite team scope, visibility defaults, tombstones, embedding-source visibility, and shared moment projection | Strong extract/transcribe/embed contracts for text/audio handoff and privacy skips | Partial: capture composer static states plus timeline controls/page helpers, moment row rendering, source-event mode, and feed pagination dedupe | E2E timeline edit/delete/filtering and richer feed/list interaction states |
| Objects, notes, and boards | Partial: object create/update/detail/archive, notes, board create/list/detail/filtering | Partial: object sections route covered | Strong for objects and boards actions | Strong PGlite object CRUD, notes, chat sessions, suggestions, board views, isolation | Suggestions worker covered | Partial: object detail static sections/approvals | E2E relationships and richer object/board component interaction states |
| Documents and folders | Partial: folder create, upload/list/detail, rename/delete, team/private visibility | Strong list/search route contracts | Strong document actions | Strong PGlite document scope, object keys, folder ancestry, restore/delete semantics, single-document provenance lookup | Strong document-extract worker | Partial: document drive static empty/list states plus captured inbox rows, promotion defaults, and cursor loading | Semantic search E2E, extracted chunk citations, worker-backed search, richer document UI states |
| Chat and agent UI | Partial: browser timeline question, tool activity, Event citation, session reload, degraded answer, visibility fences, and accepted task/calendar/object state | Strong chat route streaming/session/tool contract, including deterministic E2E seam coverage for durable workspace state | Missing chat action tests | Partial: deterministic agent tool evals, moment search/expansion coverage, `askAgent` wrapper tests, MCP safety evals, structural tools, and LLM wrappers | Fast deterministic evals for timeline citation, bundled moment retrieval, task/calendar state, visibility fences, and tool failure honesty | Partial: chat pane static empty/message/pinned states plus moment tool-step labels | Remaining: live-model evals, broader chat UI states, and provider-backed retrieval |
| Calendar | Partial: browser all-day create/edit/delete plus team/private visibility | Missing calendar API routes, if any are added later | Strong calendar action tests | Strong PGlite calendar scope, queue degradation, and time helpers | Embed worker calendar plan covered | Missing calendar UI states | E2E specific-user/timed calendar behavior and richer calendar UI states |
| Native integrations: Drive, GitHub, Linear, Monday.com, Slack workspace, Sentry | Partial: browser covers catalog OAuth start, integrations cooldown/webhook-degraded health states, and source activation/replacement; provider OAuth callback and provider-backed source listing still need E2E | Partial: Drive, GitHub, Linear, Monday.com, and Sentry webhooks, OAuth start/callback, provider-connection resource sharing, activation, manual sync, delete/disconnect with webhook deprovision best effort, legacy Monday missing-scope reconnect guidance, degraded webhook provisioning attention, and legacy selection guard routes covered | Missing integration actions if/when added | Strong provider parsing for Drive/GitHub/Linear/Monday.com/Slack/Sentry, event writer, provider-connection scope, attention lifecycle, source activation, duplicate-path replacement, token encryption, GitHub App installation-token handoff, installation-keyed budget pauses, GitHub repo-surface conditional GETs, provider webhook sync hints, shared provider sync-policy contract, native provider adapter contract tests, native provider template, targeted sync queue coalescing, provider-policy reconciliation coalescing, Monday board webhook provisioning, Monday item-level webhook hydration, Monday missing-scope degraded-mode detection, Monday WorkDocs daily reconciliation, Drive channel-expiration degraded handling, Slack Web API budget pauses, Sentry issue lifecycle/release webhook normalization, webhook-degraded enum migration coverage, webhook delivery dead-letter persistence, and email-throttle coverage | Partial: integration sync worker attention classification, mixed partial-failure classification, provider-policy reconciliation cadence, expiring webhook subscription sweep, targeted webhook sync narrowing, webhook delivery duplicate-redelivery and dead-letter attention handling, provider-specific budget-scope skipping, provider document-harvest create/version/finalize/extract handoff, legacy Monday missing-scope reconnect preservation, transient-failure delay, owner-left, reconnect, and success-reset behavior covered | Partial: provider-connection source picker, provider-specific source guidance, team source actions, visible-row attention banner counts, connected-row cooldown/reconnect/webhook-degraded attention states, app dialog guard, catalog OAuth-start E2E, integrations health-state E2E on desktop/mobile, and source activation/replacement E2E covered | Browser E2E for provider OAuth callback and provider-backed source listing, provider-backed canaries, remaining provider webhook provisioning, and richer loading/error UI states |
| Slack | Missing Slack settings E2E | Strong events webhook plus signed command, install OAuth, and user-link OAuth route coverage | Missing Slack action tests | Strong dispatcher/API/security/source-capture coverage, including text/file capture, linked attribution, visibility defaults, downstream queues, idempotent edits, `/timeline join` Saved Meeting aliases, and raw URL confirmation buttons | Missing provider-specific worker coverage | Missing Slack settings UI | Settings UI, provider-backed canary coverage |
| Telegram | Partial: browser verifies deterministic Telegram voice transcript approval acceptance | Partial: webhook covered, including media env wiring | Missing Telegram action tests | Strong API/dispatcher coverage, including DM text, voice/audio, caption/photo, document routing, duplicate delivery, media skip behavior, `/join` Saved Meeting aliases, raw URL inline-button confirmation, direct-reply confirmation, passive-text non-trigger behavior, link artifacts, and normalized reconciliation evidence | Partial: transcribe processor handoff from audio transcript to normalized reconciliation evidence, extract/embed, and suggestions is covered | Missing Telegram settings UI | Bind/unbind/settings actions and UI, provider-backed Telegram/OpenRouter canary, richer image/OCR-to-approval behavior |
| MCP inbound/outbound | Missing MCP settings/key E2E | Strong MCP OAuth/server/key/server/tool route contracts, including outbound moment retrieval and team-visible evidence filtering | Missing MCP-specific actions if/when added | Strong auth/OAuth state/tool namespace/server handler, tool namespace, and deterministic untrusted-output/failure/reauth evals | Strong MCP health worker coverage for SSRF-safe production URL validation, cache invalidation, disabled-server skips, and persisted success/failure state | Missing MCP UI | Private-vs-team E2E, UI management states, provider-backed MCP behavior |
| Email inbound/outbound | Missing E2E inbound email journey | Partial: inbound webhook covered, including Redis queue wiring | Whitelist action covered; invite/support email action gaps remain | Strong parser/dispatcher/outbound/IP allowlist/source-capture coverage, including sender auth, sender whitelist filtering, visibility defaults, attachment/audio routing, downstream queues, and duplicate delivery recovery | Missing extract processor coverage for email attachments | Missing UI | Support action, sender whitelist UI component/E2E, inbound attachment extraction E2E/integration, provider-backed Postmark canary |
| Meeting bots and meetings | Missing E2E scheduling/finalization | Strong Recall status/transcript webhook coverage for lifecycle, no-show, failure, and finalize handoff contracts | Thin meetings action coverage | Strong meetings scope, Saved Meeting alias/schedule/materialization/confirmation/failure-counter behavior, Recall/Svix/url helpers | Strong meeting-finalize and meeting-scheduler workers | Missing meeting UI states | Browser E2E for saved-meeting setup/auto-join and richer meeting UI states |
| Job recovery and failed work | Missing dashboard E2E | Strong retry/dismiss/dashboard route coverage plus integration cooldown exclusion, cron reconcile auth/failure behavior, and direct finished archive route coverage | N/A | Strong job-recovery PGlite coverage, including provider cooldown exclusion and retained finished-job archive pagination | Janitor worker covered | Partial job recovery list component with retry status and finished archive states | Retry/dismiss E2E flow |
| Onboarding | Missing E2E checklist/dismissal | Strong checklist route coverage | Strong onboarding action coverage | Strong PGlite checklist inference, dismiss/reopen, manual completion, and team isolation | Missing | Partial checklist static states | Checklist E2E and richer interaction states |
| Suggestions and background agent actions | Partial: capture-to-suggestion-to-acceptance creates durable task/calendar state, and object-update approval updates an existing object without duplication | Missing route coverage if surfaced later | Strong suggestions action boundary tests | Strong PGlite suggestions scope, dedupe, accept/reject, task/object/calendar/decision durability, and cross-team failure behavior | Partial: deterministic suggestion worker processor tests | Partial: object cleanup suggestions review/fallback/pagination | Remaining P1: richer suggestions UI states and live-model evals |
| Embeddings and retrieval quality | Missing E2E semantic retrieval flow | Strong search/chat route contracts with mocked boundaries | N/A | Strong deterministic retrieval ranking, PGlite hydration, visibility/team filtering, embedding source planning, Qdrant point IDs, raw-event rendering, and LLM wrapper behavior | Partial: embed worker text/payload/skip/stale-source coverage | Missing retrieval UI assertions | Remaining: source rendering breadth for more providers and browser semantic retrieval assertions |
| Support and team exports | Missing E2E | Missing direct routes if exposed | Missing support and team-export actions | Strong team-export archive integration | Strong team-export worker coverage for ready-state audit rows, terminal-job skips, and partial archive cleanup on failure | Missing UI | Support validation/email failure, export enqueue/idempotency, and UI |
| Platform contracts: DB, queue, S3, env, rate limits | N/A | Rate-limit behavior covered through routes and token bucket | Queue degradation covered in some actions | Partial: env, crypto, rate limit, Qdrant, pagination, DB schema contracts, queue wrappers, Sentry scrubbing, and S3 wrappers covered | Queue/S3 wrapper behavior covered in shared tests | N/A | Deeper DB migration-compat history, queue/S3 live-emulator canaries |
| Frontend components and UI states | Partial only where E2E crosses real pages | N/A | N/A | N/A | N/A | Partial: nav, job recovery list, capture composer, approvals, chat pane, document drive, object detail, board add-item flow, onboarding checklist, timeline controls/page helpers, timeline moment rows/feed dedupe, hub/status/error helpers | Document detail/search, boards, team settings, integrations, MCP, richer empty/error/loading states |

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
  of raw event rows while preserving source-event counts;
  timeline observability tests now pin privacy-safe page/API dogfooding counters
  for row-count reduction, scan pressure, missing grouping metadata, AI
  presentation cache status, and visibility cache partitioning;
  an opt-in live OpenRouter smoke test
  (`OPENROUTER_LIVE_TESTS=1` with `OPENROUTER_API_KEY`) now verifies the
  timeline moment presentation prompt/schema can produce a concrete
  non-provider title and source-event preview IDs through the real structured
  LLM boundary;
  `pnpm test:agent-eval:live` now runs an opt-in real-model `askAgent` eval
  against seeded durable task/calendar state through the same non-browser bot
  entrypoint used by Slack and Telegram;
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
- Biggest remaining product-risk gaps: broader live-model chat/provider-backed
  retrieval coverage, broader document/provider-backed source-capture
  contracts, E2E browser flows for document search/extraction and integration
  OAuth/share/activate flows, richer calendar, MCP settings, onboarding, and
  job recovery and deeper component interaction states.

## Current Test Surface

### Root Commands

- `pnpm test` runs package Vitest suites through Turbo with package-level
  concurrency set to `1`.
- `pnpm --filter @timeline/db test` runs DB/PGlite schema contract tests.
- `pnpm test:eval` runs the fast deterministic shared agent/retrieval eval
  slice.
- `pnpm test:agent-eval:live` runs an opt-in live OpenRouter `askAgent` eval
  against seeded durable workspace state. Set
  `AGENT_LIVE_ENV_FILE=/path/to/.env` when the current shell has not already
  loaded the live LLM env.
- `pnpm test:reconciliation-eval` runs deterministic reconciliation schema,
  surface/scenario matrix, source-ref, visibility-floor, authority-policy,
  planner prompt/schema, normalization, backfill, and resolver evals.
- `pnpm test:dist-imports` builds `@timeline/db` and `@timeline/shared`, then
  imports selected compiled runtime modules with Node.
- `pnpm validate` runs format, typecheck, lint, and knip. Tests run through
  `pnpm test`, `pnpm test:eval`, `pnpm test:reconciliation-eval`,
  `pnpm test:dist-imports`, package-filtered Vitest commands, or E2E commands
  depending on the change.
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
- Object create/detail/update/archive behavior.
- Object note creation.
- Board create/list/detail behavior with matching object visibility.
- Calendar create/edit/delete behavior with team/private visibility assertions.
- Document folder creation, RustFS-backed upload, list/detail/version-history,
  rename/delete behavior, and team/private visibility assertions.
- Team admin visibility, member invite/resend/revoke, signed-out invite
  acceptance, role change, admin removal limits, owner removal, and removed-user
  access loss.
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
  accept-all success and partial failure, no-longer-pending behavior, error
  mapping, and approval-surface revalidation behavior.
- `onboarding.test.ts`: checklist dismissal/reopen/step-open behavior,
  redirect handling, scope failures, and revalidation behavior.

Important uncovered action files:

- `chat.ts`
- `slack.ts`
- `support.ts`
- `team-exports.ts`
- `telegram.ts`

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
- Integrations provider parsing and event writer behavior.
- Slack and Telegram API/dispatcher/security behavior, including source-capture
  raw events, linked attribution, visibility defaults, text queue handoff,
  media/document routing, and idempotent retries/edits.
- Telegram DM text and media capture now have regressions proving captured
  conversations enqueue the right downstream work: text/captions enqueue
  extract/embed plus debounced conversation-review suggestions, voice/audio
  enqueues transcription, and the transcribed media path records durable audio
  payload refs, normalizes reconciliation evidence, and hands off to
  extract/embed plus conversation-review suggestions.
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

- Focused `packages/db` schema and migration assertions.
- Queue wrappers and job option/dedupe behavior.
- Live S3/RustFS emulator canaries beyond the mocked wrapper contract tests.
- Live-model agent evals and provider-backed MCP behavior.

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

Important uncovered worker processors:

- Integration sync still needs broader provider-pagination breadth across providers.

### Frontend Components and UI Logic

Covered frontend pieces are still narrow:

- Navigation items.
- Job recovery list copy/behavior, retry status, and finished archive display.
- Timeline controls, timeline page helpers, moment/source-event mode rendering,
  and timeline feed pagination dedupe.
- Hub status, timeline moments, safe redirects, auth redirects, site URL,
  Turnstile, and UX error helpers.

Important uncovered UI areas:

- Capture composer.
- Timeline list cards and richer timeline feed states.
- Document drive/search/detail views.
- Chat pane.
- Object forms/detail pages.
- Board views.
- Team settings/admin.
- Integrations UI.
- MCP UI.
- Onboarding UI.
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
  - Object create/update/detail, notes, archive state, board placement, and
    board filtering.

- Remaining:
  - Timeline edit/delete or equivalent lifecycle coverage and timeline
    filtering.
  - Object relationships in a real browser flow.
  - Document semantic search, extracted chunk citations, and worker-backed
    extraction/search behavior.
  - Calendar specific-user visibility and timed event behavior.
  - Onboarding checklist completion and dismissal.
  - Slack/Telegram settings screens for connect/disconnect/error states with
    provider calls stubbed at the boundary.
  - MCP server/key management and private-vs-team visibility behavior.
  - Job recovery dashboard retry/dismiss flows.
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
  - Suggestion action tests for accept/reject/accept-all validation, scope
    failures, no-longer-pending behavior, partial failures, errors, and
    revalidation paths.
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
  - Browser chat E2E for seeded timeline retrieval, visible `search_timeline`
    tool activity, Event citation chips, citation links, persisted session
    reload, private/specific-user visibility, and degraded no-citation answers.
  - Browser object-update approval E2E proving an accepted object update targets
    the existing object, changes the detail page, and does not create a
    duplicate object.
  - Browser chat E2E over accepted durable task/calendar/object state using a
    deterministic workspace-state tool step, persisted session reload, and
    team-visible member access.
  - Deterministic MCP safety evals for fenced untrusted output, nested
    external-content tag neutralization, failed calls, and `needs_reauth`
    output shape.

- Remaining:
  - Live-model chat evals.
  - Provider-backed MCP behavior and richer MCP/chat UI reconnect states.
  - Broader source-capture contracts for documents and integrations.
  - Provider-backed Slack/Postmark capture canaries and settings UI flows.
  - Provider-backed Telegram/OpenRouter canary coverage and richer image/OCR
    to approval behavior.

- P1 source capture contracts:
  - Web capture creates a raw timeline event with the expected author, source,
    visibility, object links where applicable, and follow-up jobs.
  - Telegram DM text capture creates a raw event and enqueues extract, embed,
    and debounced conversation-review suggestion work for the source
    conversation.
  - Telegram voice/audio capture creates an audio raw event, enqueues
    transcription, backfills transcript text, records a durable audio payload
    ref/digest and transcript snapshot, normalizes reconciliation evidence, and
    enqueues extract/embed plus conversation-review suggestion work from the
    transcript.
  - Telegram image/document messages route attachments to document extraction;
    captions enqueue direct text follow-up work, while image-only messages do
    not invent approvals before extraction/OCR.
  - Slack and email captures have deterministic dispatcher/route tests proving
    source payloads become team-scoped raw events. Slack suggestion work now
    runs through debounced conversation reviews, while email remains
    raw-event anchored.
  - Document and integration captures should each have deterministic route/
    integration tests proving source payloads become team-scoped raw events and
    enqueue extract/suggestion/embed work.
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
    Telegram sender/chat/caption, document metadata, and integration origin.
  - Embed worker sends the expected rendered text to `llm.embed`.
  - Qdrant point payloads include team ID, source kind, occurred-at timestamp,
    author, visibility metadata, and stable point IDs.
  - Re-embedding updates the same point instead of creating duplicates.
  - Deterministic vector fixtures prove semantic retrieval returns the expected
    event, preserves ranking, merges duplicate hits, drops stale payloads, and
    filters by team/visibility.
  - Chat eval fixtures include timeline retrieval/citation, durable
    task/calendar state, failed-tool honesty, and private/specific-user/team
    fences.
- Test command target:
  - `pnpm test:eval` runs the fast deterministic shared agent/retrieval eval
    slice.
  - Keep provider-backed/live-model evals manual or scheduled until they are
    stable, budgeted, and clearly reported.

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
- `chat.ts`: session create/archive/pin behavior and object pinning isolation.
- `slack.ts`: binding/unbinding, provider failure handling, revalidation, and
  team isolation.
- `support.ts`: validation, auth behavior, and email/queue failure handling.
- `team-exports.ts`: authorization, queue enqueue behavior, idempotency, and
  failure paths.
- `telegram.ts`: bind/unbind/update settings, username validation, and
  cross-user/team protection.

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
  - Slack settings UI and provider-backed canary coverage.
  - Onboarding/job recovery/object-section browser E2E flows.

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
- Transcribe: retry behavior and provider-backed transcription canary.
- Integration sync: attention classification, provider-policy cadence, targeted
  narrowing, provider budget pauses, missing-scope degradation, and provider
  document-harvest create/version/finalize/extract handoff.
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
  - Semantic retrieval of timeline events with deterministic embeddings and
    team/visibility filters.
- Add additional deterministic evals for:
  - Refusing or fencing untrusted MCP/tool content.
  - Summarizing document/meeting/integration facts with source attribution.
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
  - Integrations and MCP settings forms.
  - Onboarding checklist and dismissals.
- Prefer user-facing role/text assertions over snapshots and CSS-class checks.

## Suggested Command Shape

Once the suite is mature, split commands by layer:

- `pnpm test`: fast unit and integration tests that should always pass.
- `pnpm e2e`: local core Playwright E2E.
- `pnpm e2e:prod-smoke`: production-ish smoke.
- `pnpm test:eval`: fast deterministic agent evals.
- `pnpm test:agent-eval:live`: opt-in live `askAgent` durable-state eval.
- `pnpm test:reconciliation-eval`: deterministic reconciliation eval matrix,
  replay coverage, reconciliation dashboard snapshot contracts, and
  production-sampling artifact loading/report aggregation, including
  artifact-kind miss reporting.
- `pnpm test:dist-imports`: compiled-package import smoke.
- `pnpm validate`: format, typecheck, lint, and knip.
- `pnpm canary:integrations`: manual secret-safe live OpenRouter, GitHub App,
  Sentry, native OAuth credential, and webhook-secret canary.
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
