# Test TODO and Coverage Plan

This document tracks the current test surface and the missing coverage needed
to trust Timeline end to end. Tests should stay coupled to behavior and product
contracts, not private implementation structure.

## Test Status Overview

Last checked in this branch: `pnpm validate` passes. Current suite shape:

- Web Vitest: 45 files / 249 tests.
- Shared Vitest: 51 files / 414 tests, including PGlite integration coverage.
- Worker Vitest: 7 files / 45 tests.
- Playwright: 7 local core E2E journeys plus 1 production-ish smoke journey.
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
| Timeline capture and visibility | Partial: create team event, private/team/specific-user/cross-team visibility | Strong for timeline list/search contracts and audio signing | Strong for capture and visibility actions | Strong PGlite team scope, visibility defaults, tombstones, embedding-source visibility | Missing old extract/transcribe processors | Thin timeline controls/page helpers | E2E timeline edit/delete/filtering, feed/list component states |
| Objects, notes, and boards | Partial: object create/update/detail/archive, notes, board create/list/detail/filtering | Missing object sections route | Strong for objects and boards actions | Strong PGlite object CRUD, notes, chat sessions, suggestions, board views, isolation | Suggestions worker covered | Missing object/board UI components | E2E relationships, object sections route, object/board component states |
| Documents and folders | Partial: folder create, upload/list/detail, rename/delete, team/private visibility | Strong list/search route contracts | Strong document actions | Strong PGlite document scope, object keys, folder ancestry, restore/delete semantics | Strong document-extract worker | Missing document UI components | Semantic search E2E, extracted chunk citations, worker-backed search, richer document UI states |
| Chat and agent UI | Missing E2E chat question/citation flow | Strong chat route streaming/session/tool contract | Missing chat action tests | Thin structural agent tools only; LLM wrappers tested with injected models | Missing evals | Missing chat pane components | Agent evals, citation correctness, failed tool behavior, chat UI states |
| Calendar | Partial: browser all-day create/edit/delete plus team/private visibility | Missing calendar API routes, if any are added later | Strong calendar action tests | Strong PGlite calendar scope, queue degradation, and time helpers | Embed worker calendar plan covered | Missing calendar UI states | E2E specific-user/timed calendar behavior and richer calendar UI states |
| Integrations: Drive, GitHub, Linear | Missing UI/E2E connect/manage flows | Partial: webhooks covered; OAuth/manage routes missing | Missing integration actions if/when added | Strong provider parsing and event writer coverage | Integration sync worker missing | Missing integrations UI | OAuth start/callback/manage routes, integration sync worker, UI connect/disconnect states |
| Slack | Missing Slack settings E2E | Partial: events webhook covered; commands/install/user-link missing | Missing Slack action tests | Strong dispatcher/API/security coverage | Missing provider-specific worker coverage | Missing Slack settings UI | Slash command/install/user-link routes, settings UI, action coverage |
| Telegram | Missing Telegram settings E2E | Partial: webhook covered | Missing Telegram action tests | Strong API/dispatcher coverage | Missing transcribe path for Telegram audio processor | Missing Telegram settings UI | Bind/unbind/settings actions and UI, transcribe worker |
| MCP inbound/outbound | Missing MCP settings/key E2E | Strong MCP OAuth/server/key/server/tool route contracts | Missing MCP-specific actions if/when added | Strong auth/OAuth state/tool namespace/server handler; agent tools structural only | MCP health worker missing | Missing MCP UI | MCP health worker, private-vs-team E2E, UI management states, agent evals for untrusted output |
| Email inbound/outbound | Missing E2E inbound email journey | Partial: inbound webhook covered | Invite/support email action gaps remain | Strong parser/dispatcher/outbound/IP allowlist coverage | Missing extract processor coverage for email attachments | Missing UI | Support action, inbound attachment/document path E2E or integration |
| Meeting bots and meetings | Missing E2E scheduling/finalization | Partial Recall status/transcript webhooks covered | Thin meetings action coverage | Strong meetings scope, Recall/Svix/url helpers | Strong meeting-finalize worker | Missing meeting UI states | Meeting action breadth, consent/failure E2E, meeting UI states |
| Job recovery and failed work | Missing dashboard E2E | Partial retry/dismiss route coverage; dashboard route missing | N/A | Strong job-recovery PGlite coverage | Janitor worker covered | Partial job recovery list component | Jobs dashboard route, retry/dismiss E2E flow |
| Onboarding | Missing E2E checklist/dismissal | Missing checklist route | Missing onboarding action tests | Thin onboarding shared behavior through implementation only | Missing | Missing onboarding UI components | Checklist route/action/component/E2E coverage |
| Suggestions | Missing E2E inbox flow | Missing route coverage if surfaced later | Missing suggestions action tests | Strong PGlite suggestions scope and dedupe/accept behavior | Thin suggestions worker fallback tests | Missing suggestions UI | Action tests for accept/reject/duplicates, UI inbox states |
| Support and team exports | Missing E2E | Missing direct routes if exposed | Missing support and team-export actions | Strong team-export archive integration | Team-export worker missing | Missing UI | Support validation/email failure, export enqueue/idempotency, worker failure cleanup |
| Platform contracts: DB, queue, S3, env, rate limits | N/A | Rate-limit behavior covered through routes and token bucket | Queue degradation covered in some actions | Partial: env, crypto, rate limit, Qdrant, pagination; no focused `packages/db`, queue, or S3 contract tests | Missing queue/S3 wrapper tests | N/A | DB migration/constraint tests, queue wrapper tests, S3 wrapper tests |
| Frontend components and UI states | Partial only where E2E crosses real pages | N/A | N/A | N/A | N/A | Thin: nav, job recovery list, timeline controls/page helpers, hub/status/error helpers | Capture composer, feeds, documents, chat, objects, boards, team settings, integrations, MCP, onboarding, empty/error/loading states |

## High-Level Read

- Strongest coverage today: shared domain isolation with PGlite, core server
  action contracts, high-value API route contracts, document extraction,
  meeting finalization, and core MCP route contracts.
- Most bug-finding coverage today: Playwright E2E and PGlite/worker
  integration tests, because they cross real boundaries.
- Most contract-freezing coverage today: mocked server-action and API route
  tests. These are valuable for auth/status/validation/side-effect intent, but
  they are less likely to discover deep product bugs on their own.
- Biggest remaining product-risk gaps: E2E browser flows for document
  search/extraction, chat, calendar, integrations, MCP settings, onboarding,
  and job recovery; worker coverage for extract/transcribe/integration sync/
  MCP health/team export; DB/queue/S3 contract tests; agent evals; component
  state tests.

## Current Test Surface

### Root Commands

- `pnpm test` runs package Vitest suites through Turbo with package-level
  concurrency set to `1`.
- `pnpm validate` runs format, typecheck, lint, tests, and knip.
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

Important uncovered action files:

- `chat.ts`
- `onboarding.ts`
- `slack.ts`
- `suggestions.ts`
- `support.ts`
- `team-exports.ts`
- `telegram.ts`

### Web API Routes

Covered route tests include:

- Email inbound webhook.
- Telegram webhook.
- Slack events webhook.
- GitHub, Google Drive, Linear, and Recall webhooks.
- Job recovery retry/dismiss routes.
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

Important uncovered route files:

- Integration OAuth start/callback/manage routes.
- Slack commands/install/user-link routes.
- `api/onboarding/checklist/route.ts`
- `api/objects/[id]/sections/route.ts`
- `api/cron/reconcile/route.ts`
- `api/jobs/dashboard/route.ts`

### Shared Packages

Covered shared areas include:

- Team scope and team isolation.
- Documents scope and object key behavior.
- Meetings scope and meeting-bot helpers.
- Calendar scope.
- Objects domain behavior: CRUD/update changes, notes, chat sessions, board
  views, suggested changes, archived filtering, and cross-team isolation.
- Job recovery.
- Team exports.
- Integrations provider parsing and event writer behavior.
- Slack and Telegram API/dispatcher/security behavior.
- MCP auth, OAuth state, tool namespace, server handler behavior.
- Agent tools structural behavior.
- LLM wrappers for chat, embed, transcribe, memory, and vision using injected
  models.
- Qdrant client/point-id behavior.
- Email parser/dispatcher/outbound behavior.
- Crypto secrets, rate limiting, citations, pagination, chunking, env reset,
  and embedding source planning.

Important uncovered shared/package areas:

- Focused `packages/db` schema and migration assertions.
- Queue wrappers and job option/dedupe behavior.
- S3 wrapper env/bucket/presigned URL/object-size behavior.
- Agent behavior/evals beyond structural tool tests.

### Worker Processors

Covered worker areas include:

- Embed worker.
- Document extract worker.
- Meeting finalize worker.
- Suggestions worker.
- Janitor worker.
- Overdue scan worker.
- Railway config checks.

Important uncovered worker processors:

- `extract`
- `transcribe`
- `integrationSync`
- `mcpHealth`
- `teamExport`

### Frontend Components and UI Logic

Covered frontend pieces are still narrow:

- Navigation items.
- Job recovery list copy/behavior.
- Timeline controls and timeline page helpers.
- Hub status, timeline moments, safe redirects, auth redirects, site URL,
  Turnstile, and UX error helpers.

Important uncovered UI areas:

- Capture composer.
- Timeline feed/list cards.
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
  - Chat question against seeded timeline facts with visible citation behavior.
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

### Phase 2: Server Actions

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
- `onboarding.ts`: checklist completion, dismissal, and per-user/team scoping.
- `slack.ts`: binding/unbinding, provider failure handling, revalidation, and
  team isolation.
- `suggestions.ts`: accept/reject behavior, unsupported fields, duplicate
  submission, and inbox revalidation.
- `support.ts`: validation, auth behavior, and email/queue failure handling.
- `team-exports.ts`: authorization, queue enqueue behavior, idempotency, and
  failure paths.
- `telegram.ts`: bind/unbind/update settings, username validation, and
  cross-user/team protection.

### Phase 3: API Routes

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

- Remaining:
  - Integrations OAuth/start/callback/manage: state validation, provider
    failures, encrypted token storage, selection changes, sync enqueue, and
    disconnect behavior.
  - Slack commands/install/user-link: signature/state validation, response URL
    behavior, token encryption, and replay/invalid payload handling.
  - Onboarding checklist: auth, active team, malformed body, and persistence.
  - Object sections: auth, object ownership/team checks, section payload shape,
    and missing object behavior.
  - Cron reconcile: authorization, idempotency, and enqueue behavior.
  - Jobs dashboard: admin permissions, filters, retry/dismiss shape, and
    failure statuses.

### Phase 4: Workers

Goal: every processor has integration tests for retry/idempotency/privacy
contracts and unit tests for pure branching.

- Extract: media/text extraction privacy, immutable raw events, idempotency,
  failure recovery, and queue handoff.
- Transcribe: transcript-only persistence, no raw audio copy, handoff markers,
  failure states, and retry behavior.
- Integration sync: provider pagination, dedupe keys, visibility defaults,
  encrypted credential usage, and partial failures.
- MCP health: SSRF-safe URLs, cache invalidation, failed server status, and
  team/user overlay behavior.
- Team export: permission assumptions, private/team visibility limits, signed
  URL generation, and failure cleanup.
- Keep PGlite tests for database semantics and injected fakes for external
  providers, queues, S3, and LLM calls.

### Phase 5: Database, Queue, And Storage Contracts

Goal: protect low-level invariants that application tests rely on.

- Add `packages/db` tests for:
  - Migration compatibility from empty database.
  - Critical foreign keys and cascade behavior.
  - Partial unique indexes.
  - Visibility defaults and valid enum behavior.
  - Invite/member invariants.
  - Object/relationship uniqueness and soft-delete interactions.
- Add queue wrapper tests for:
  - Job names, queues, dedupe IDs, retry/backoff options, and repeatable job
    registration.
  - Missing Redis/env behavior and graceful test-mode behavior.
- Add S3 wrapper tests for:
  - Bucket/env validation.
  - Object key constraints.
  - Presigned upload/download URL behavior.
  - Size/content-type failure paths.

### Phase 6: Agent And Eval Coverage

Goal: prove agent workflows behave correctly with realistic tasks, not just
that tool schemas are shaped correctly.

- Add fast deterministic evals for:
  - Asking about seeded timeline facts with correct citations.
  - Refusing or fencing untrusted MCP/tool content.
  - Handling failed tools without hallucinating success.
  - Respecting team/private/specific-user visibility.
  - Summarizing document/meeting/integration facts with source attribution.
- Store eval fixtures and expected success criteria in-repo.
- Split eval commands into fast CI-safe evals and slower/manual/provider-backed
  evals.

### Phase 7: Component And UI Tests

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
  - Board views and filter controls.
  - Team settings/admin role controls and destructive confirmations.
  - Integrations and MCP settings forms.
  - Onboarding checklist and dismissals.
- Prefer user-facing role/text assertions over snapshots and CSS-class checks.

## Suggested Command Shape

Once the suite is mature, split commands by layer:

- `pnpm test`: fast unit and integration tests that should always pass.
- `pnpm test:e2e`: local core Playwright E2E.
- `pnpm test:e2e:prod-smoke`: production-ish smoke.
- `pnpm test:eval`: fast deterministic agent evals.
- `pnpm validate`: format, typecheck, lint, `pnpm test`, and knip.
- CI PR gate: validate plus core E2E when stable.
- CI scheduled/manual gate: provider-backed E2E, production-ish smoke, and
  slower evals.

## Priority Order

1. Build deterministic E2E fixtures and expand Playwright coverage for core app
   flows.
2. Add server action suites for `teams.ts`, `invites.ts`, `objects.ts`,
   `boards.ts`, and `calendar.ts`.
3. Add remaining route suites for integrations, Slack command/OAuth,
   onboarding, object sections, cron reconcile, and jobs dashboard flows.
4. Finish worker processor coverage for extract, transcribe, integration sync,
   MCP health, and team export.
5. Add database, queue, and S3 contract tests.
6. Add fast agent evals and tool-failure/citation checks.
7. Add component tests for high-value UI states.
