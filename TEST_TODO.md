# Test TODO and Coverage Plan

This document tracks the current test surface and the missing coverage needed
to trust Timeline end to end. Tests should stay coupled to behavior and product
contracts, not private implementation structure.

## Current Test Surface

### Root Commands

- `pnpm test` runs package Vitest suites through Turbo with package-level
  concurrency set to `1`.
- `pnpm validate` runs format, typecheck, lint, tests, and knip.
- `pnpm e2e` runs local Playwright E2E through `scripts/run-e2e-strict.ts`.
- `pnpm e2e:prod-smoke` runs the production-ish Playwright smoke suite.

### Playwright E2E

Current coverage is smoke-level:

- Seeded owner can sign in and load the app shell.
- Seeded owner can create a team-visible timeline text event and a seeded
  member can see it.
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

Important uncovered action files:

- `teams.ts`
- `invites.ts`
- `objects.ts`
- `boards.ts`
- `calendar.ts`
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

Important uncovered route files:

- `api/timeline/route.ts`
- `api/chat/route.ts`
- `api/documents/list/route.ts`
- `api/documents/search/route.ts`
- Integration OAuth start/callback/manage routes.
- MCP OAuth, MCP server, MCP keys, MCP servers, and MCP tools routes.
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

- Add dedicated E2E seed fixtures for owner, admin, member, non-member, and at
  least two teams.
- Add login/session helpers that cover the real login flow once and reuse
  authenticated storage state for repeated journeys.
- Add cleanup that removes all E2E-owned data by run prefix.
- Add E2E tests for:
  - Sign in, app shell, team switcher, and sign out.
  - Capture text event, private/team/specific-user visibility, edit/delete or
    equivalent lifecycle, and timeline filtering.
  - Object create/update/detail, notes, relationships, board placement, and
    board filtering.
  - Chat question against seeded timeline facts with visible citation behavior.
  - Documents upload/list/search/detail with stubbed extraction where needed.
  - Calendar event create/update/delete and visibility behavior.
  - Team admin invite/member role/remove flows.
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

- `teams.ts`: create/switch/update team, invite/member role/remove behavior,
  owner/admin/member authorization, and last-owner protection.
- `invites.ts`: token validation, accept/decline behavior, expired/used invite
  handling, and cross-team isolation.
- `objects.ts`: create/update/archive/restore, relationships, notes, suggested
  changes, board revalidation, and permission failures.
- `boards.ts`: create/update/delete board views, invalid filters, and
  team-scoped persistence.
- `calendar.ts`: CRUD, visibility user validation, private/team visibility,
  revalidation, and queue behavior.
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

- Timeline route: auth, filters, pagination, visibility, and malformed query
  handling.
- Chat route: streaming/non-streaming contracts, failed tool handling, scoped
  citations, and request validation.
- Documents list/search routes: auth, folder filters, semantic search fallback,
  visibility, and pagination.
- Integrations OAuth/start/callback/manage: state validation, provider
  failures, encrypted token storage, selection changes, sync enqueue, and
  disconnect behavior.
- MCP OAuth/server/keys/servers/tools: SSRF guard usage, bearer-key visibility
  limits, tool output fencing, owner/admin permissions, and failed server calls.
- Slack commands/install/user-link: signature/state validation, response URL
  behavior, token encryption, and replay/invalid payload handling.
- Onboarding checklist: auth, active team, malformed body, and persistence.
- Object sections: auth, object ownership/team checks, section payload shape,
  and missing object behavior.
- Cron reconcile: authorization, idempotency, and enqueue behavior.
- Jobs dashboard: admin permissions, filters, retry/dismiss shape, and failure
  statuses.

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
2. Add server action suites for `teams.ts`, `objects.ts`, `boards.ts`, and
   `calendar.ts`.
3. Add route suites for chat, timeline, documents, integrations, MCP, and Slack
   command/OAuth flows.
4. Finish worker processor coverage for extract, transcribe, integration sync,
   MCP health, and team export.
5. Add database, queue, and S3 contract tests.
6. Add fast agent evals and tool-failure/citation checks.
7. Add component tests for high-value UI states.
