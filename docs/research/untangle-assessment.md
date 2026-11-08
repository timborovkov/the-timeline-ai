# Untangle assessment and implementation record

Assessment baseline: `1dfae8be`, pushed to `origin/feature/codebase-cleanup` on 7 November 2026.

Implementation is complete on `feature/codebase-cleanup`. Findings below are structural candidates, not blanket claims of production defects. The board after-commit issue was reproduced with nested transactions and is now fixed.

## Implementation progress

All 32 items are implemented across 21 implementation change sets, with follow-up verification fixes. All scoped validation is complete. Each item records its implementation commit and focused verification below. Tests are retained; no deployment or merge is part of this work.

- Root: C3, C5, C6, C7 and integration/review (completed).
- Domain scope: A1, A3, B5, B6.
- Agent: B1, B7, D4, E8.
- Worker/tooling: B3, D1, D2, D5, D6.
- Web: B2, E1, E2, E3, E4.
- Identity/billing: A2, B4, C4, E5, E6, E7.
- Messaging: A4, C1, C2, D3.

## Coverage and limitations

- Inventoried application, package, script, and CI files. A TypeScript-AST import scan covered 1,253 tracked non-test app/package source files and resolved 5,004 local import/re-export edges, excluding explicit type-only imports.
- Found strongly connected groups of 32, five, and four files. This is a static source graph, not a measured runtime-loading trace; dynamic imports are excluded. Cycles identify places to inspect, not automatic proof of a bug.
- Six focused inspections covered web, worker/tooling, retrieval/MCP/messaging, domain persistence, billing/identity/classification, and provider/infrastructure boundaries. They traced representative implementations and existing regression coverage; this is not a claim to have read every line of every file.
- At assessment time, no new tests or live-service operations were run. Implementation verification is recorded above and per item. No dead-code deletion was established. Existing authorization, provider retries, queue leases, source immutability, and visibility exceptions must be preserved.
- The first cleanup and all assessment implementation change sets are pushed. Feature-branch pushes do not trigger this repository's main CI workflow; it runs for main/production pushes and PRs targeting those branches.

## Original assessment sequence

1. Reproduce and fix transaction ownership of board due-date effects.
2. Extract small canonical contracts: retrieval input, chat context, recovery thresholds, billing meters, pin kinds.
3. Remove stable-contract-to-runtime dependencies: outbound Slack delivery, presentation schema/cache keys, reconciliation core helpers, billing policy predicates.
4. Make external lifecycle contracts explicit: image recipe hashing and test isolation.
5. Plan the larger permission, workspace initialization, task classification, and visibility refactors against their safety tests.

## A. Correctness-sensitive ownership

### A1. Board due-date effects must belong to the outer commit

**Implemented — `db448be1`.** Calendar dispatcher honors outer effect collector across all six board mutation paths; object best-effort callbacks avoid double deferral. Real nested transaction regressions reproduced premature effects, now commit/rollback/failing-enqueue cases pass.

Evidence: `packages/shared/src/boards/index.ts:658` duplicates `objects/index.ts:1202`'s enqueue/delete dispatcher. Board calls at `:1619`, `:1861`, `:1988`, and `:2065` execute after a local transaction without using the supplied post-commit effect context. During suggestion acceptance, that transaction may be a nested savepoint; completing it does not mean the outer transaction committed.

Proposed boundary: a calendar due-date effect dispatcher that participates in the existing explicit after-commit context. Keep SQL synchronization separate from queue/vector effects. Prove rollback emits no jobs or vector deletions, and commit emits effects once. Existing board due-date tests and suggestion transaction tests are the starting point.

### A2. Operator access policy depends on method names

**Implemented — `73e74212`.** Exhaustive operation capabilities replace method-name inference. Unknown operations fail closed. Web auth/identity entrypoints explicitly initialize context without adding an instrumentation import graph. Platform-admin and four auth initialization regressions passed.

Evidence: `packages/shared/src/platform-admin/runtime.ts:85` classifies reads by prefixes, `:88` maintains exceptions, and `:149` recognizes privileged operation paths. Web auth installs a global resolver at `apps/web/src/lib/auth.ts:63`.

Proposed boundary: explicit scoped-operation capabilities and an explicit request-context entrypoint. Preserve real actor attribution, effective-member restrictions, maintenance exceptions, re-admission, and transaction behavior. Existing platform-admin tests cover these boundaries. No authorization bypass was demonstrated by this assessment.

### A3. Pins repeat owning domains' visibility rules

**Implemented — `db448be1`.** Domain predicates and canonical calendar-series lookup unify single/batch eligibility. Review reproduced stored hidden-parent pin leaking through list/resolve; now consistently excluded. Calendar/board/document/meeting suites 141 tests passed plus final parity regressions.

Evidence: `packages/shared/src/pins/scope.ts:193–214` repeats document, meeting, saved-meeting, and calendar full-detail visibility; owning policies are in document, meeting, and calendar scopes. Single calendar resolution at `:217` delegates to the domain, while batch resolution at `:228` queries tables directly.

Proposed boundary: domain-owned predicates and batch canonicalization. Preserve calendar busy-only redaction versus full-detail pin eligibility, and recurring-parent handling. Add single/batch parity tests with hidden recurring parents; retain current privacy suites.

### A4. Telegram link-token validation is duplicated

**Implemented — `33fa0e3c`.** Transaction-bound verified link token service retains group/personal policies. Telegram dispatcher 55 plus token 5 tests passed.

Evidence: `packages/shared/src/telegram/dispatcher.ts:453–485` and `:1547–1580` repeat lock, consumption, expiry, username, and issuer-membership checks.

Proposed boundary: a transaction-bound verified-token operation; personal and group binding retain distinct authorization and mutations. Preserve group Telegram-admin checks, current team roles, active-team uniqueness, legacy-token rejection, and consume-with-bind atomicity. Establish expiry/replay/demotion regressions before extraction.

## B. Canonical contracts and duplicated policy

### B1. Retrieval input has three owners

**Implemented — `b73ddc16`.** Retrieval schema, recipes and normalized inputs now have one owner. Retrieval/tools/observation targets and nine-file agent eval passed.

Evidence: identical schemas at `packages/shared/src/agent/tools.ts:411` and `mcp-server/handler.ts:81`, recipe vocabulary in `agent/retrieval.ts:13`, and duplicated optional-argument projection in both adapters.

Proposed boundary: dependency-light retrieval request schema, inferred type, and normalization. Preserve UUID/limit validation, absent versus false, auto classification, fenced evidence and partial-failure reporting. Use retrieval, agent, MCP advertised-schema tests and agent evals.

### B2. Dashboard chat context has separate storage/API/view contracts

**Implemented — `b3ab038a`.** Pure dashboard context contract now backs strict API validation and tolerant storage parsing; view/pane consumers share it. Five targeted suites passed including view/storage/request roundtrip.

Evidence: `apps/web/src/lib/chat-handoff.ts:9,133`, `app/api/chat/route.ts:78`, and `lib/chat-view.ts:9,108` repeat fields and validation/interpretation.

Proposed boundary: one pure context contract with strict request and tolerant storage adapters. Preserve single-use, team-keyed, five-minute handoffs, invalid optional-ID stripping, and authorization independence. Add view-to-storage-to-request round-trip coverage.

### B3. Automatic recovery and UI disagree unless thresholds change together

**Implemented — `7dc92be6`.** Shared recovery durations consumed by janitor and UI policy. Date columns, incomplete-upload exclusion and paging unchanged. Janitor regressions passed; final recovery suite 31 tests passed.

Evidence: `apps/worker/src/workers/janitor.ts:42–51` and `packages/shared/src/job-recovery/index.ts:213–215` separately define stuck-document and stuck-meeting ages.

Proposed boundary: lightweight recovery eligibility policy. Preserve document createdAt versus meeting updatedAt, incomplete-upload exclusion, janitor paging and enqueue caps. Existing janitor and recovery suites cover the behavior.

### B4. Billing meter identity is repeated in four places

**Implemented — `8e178103`.** Canonical meter descriptors and pure allowance/state/recommendation modules replace repeated maps and orchestration cycles. Six focused billing suites passed; scoped ESLint passed; independent review found no additional regression.

Evidence: `packages/shared/src/billing/catalog.ts:355`, `charge.ts:502`, `polar-setup.ts:38,85`, and `provider.ts:83` separately map meter/event identities.

Proposed boundary: typed meter descriptors with derived forward/reverse maps. Preserve units, cumulative rounding, allowance floors, member-day prices, unknown-event handling and fake overrides. Retain independent monetary expectations in tests.

### B5. Pin kinds still have two vocabularies

**Implemented — `db448be1`.** Pin kinds derive from DB enum with exhaustive target resolver registry. UUID/text key distinction preserved; pin/domain tests passed.

Evidence: `packages/db/src/schema/pins.ts:17` and `packages/shared/src/pins/scope.ts:26` enumerate the same seven kinds.

Proposed boundary: derive validation/types from the existing enum, with exhaustive per-kind adapters. Preserve textual timeline-moment keys versus other UUID targets. Follow the event-source pattern from the first cleanup.

### B6. Direct-write provenance is copied between objects and boards

**Implemented — `db448be1`.** Shared reconciliation source context/envelope retains team filtering, latest-evidence order, replay refs and privacy floor. Original builders AST-equivalent; domain privacy tests passed. Final reconciliation evaluation stages passed after structural guards were updated to follow the canonical helper.

Evidence: `objects/index.ts:518` and `boards/index.ts:688` repeat source queries, replay fallback, visibility and refs; envelope builders at `:224` and `:83` repeat visibility floors.

Proposed boundary: reconciliation-owned source-context/envelope policy. Keep output payloads, run versions, fingerprints and authority targets domain-owned. Preserve evidence ordering/dedupe semantics; run object/board privacy tests and reconciliation evals.

### B7. Proposal observation still has a separate tool-name list

**Implemented — `b73ddc16`.** Proposal extraction derives from preserved tool policy metadata; privacy and failed-output rules retained. Observation and agent eval regressions passed.

Evidence: `packages/shared/src/agent/observability.ts:182–195` maintains five proposal names independently of the tool definitions.

Proposed boundary: colocated observation/extraction metadata, preserved through instrumentation like approval metadata. Preserve `ok:false`, both ID result conventions, and privacy-safe telemetry. New proposal tools should not silently disappear from observations.

## C. Dependency direction and cycle cuts

### C1. Outbound messaging imports inbound Slack orchestration

**Implemented — `ca6cf6cb`.** Outbound Slack adapter no longer imports inbound dispatch; digest orchestration depends on generic delivery. Delivery 24, Slack 34, outbound 2 and bot-ledger 4 tests passed.

Evidence: `packages/shared/src/messaging/delivery.ts:39` imports send helpers from `slack/dispatcher.ts`, which also imports agent, billing, conversation, meeting and scope orchestration. This is a concrete edge in the 32-file cycle group.

Proposed boundary: a focused outbound Slack delivery adapter used by the dispatcher and general messaging. The send helpers at `slack/dispatcher.ts:907–934` need install lookup, decryption and SlackApi, not inbound agent orchestration. Also move digest orchestration from `messaging/delivery.ts:550–987` into a digest-delivery module depending on generic sendMessage; avoid reexporting it from generic delivery and restoring the edge. Preserve team-bound enabled-install lookup, encrypted tokens, direct-message fallback, upstream member authorization, delivery principal, preferences, expiration and provider retry behavior.

### C2. Presentation persistence imports inference through its contract

**Implemented — `3cababcf`.** Pure presentation contract/cache calculations now support generation, persistence, agent/MCP and web consumers without importing inference. Presentation 7 tests passed; one opt-in live test skipped.

Evidence: `timeline-moments/presentation-cache.ts` imports schema/key helpers from `presentation.ts`; `presentation.ts:6` imports LLM chat alongside those pure definitions.

Proposed boundary: pure presentation contract and cache-key module used by persistence and generation. Preserve fingerprint bytes, prompt/model versioning, schema defaults and provenance validation. Existing presentation/cache tests and dist-import checks protect this.

### C3. Reconciliation core helpers share a barrel with dashboard orchestration

**Implemented — `1558f8d5`, completed internal caller routing in `0e643a33`.** Core contracts, dedupe and deterministic evaluation primitives now live below runtime orchestration; internal callers use the leaf, public reexports remain compatible. Full offline reconciliation evaluation command passed; scoped ESLint passed. Shared build and compiled-import check passed.

Evidence: `artifacts/index.ts:12` and `reconciliation/normalization.ts:9` import dedupe helpers from `reconciliation/index.ts`, which reexports dashboard runtime at `:22`. The dashboard imports artifacts/backfill, forming the five-file group.

Proposed boundary: core contracts/dedupe helpers separate from the runtime entrypoint. Internal callers import the leaf module; public reexports can remain compatible. Preserve hash bytes and authority/source-ref semantics; run reconciliation evals and compiled imports.

### C4. Billing status, preview, charge and operator form a cycle

**Implemented — `8e178103`.** Canonical meter descriptors and pure allowance/state/recommendation modules replace repeated maps and orchestration cycles. Six focused billing suites passed; scoped ESLint passed; independent review found no additional regression.

Evidence: `billing/status.ts:10` imports recommendation logic from preview, while preview imports status/charge/operator and charge/operator import status.

Proposed boundary: pure allowance/state/recommendation predicates below both status rendering and preview orchestration. Preserve pricing behavior; do not mix this with a commercial-policy change. Existing billing tests provide independent price expectations.

### C5. Generic LLM transport knows domain output repair

**Implemented — `db448be1`.** Generic inference applies domain normalizers in structured and JSON fallback paths. Extraction/entity choice, meeting and task categories own aliases. Chat tests and 17 meeting-finalization tests passed; independent review found no additional regression.

Evidence: `llm/chat.ts:42,303–336` repairs extraction facts, meeting action items, entity choice and task categories.

Proposed boundary: domain-owned normalization contract applied within all existing structured-output fallback paths. Generic inference owns transport, JSON recovery, schema validation and metering. Preserve privacy/fallback behavior; task-category schema/prompt changes trigger applicable live-eval requirements.

### C6. Provider transport construction is repeated

**Implemented — `a0ac6d72`.** Shared provider factory owns credentials, URL, privacy headers, fetch adaptation and optional modality flags. Embedding retains private-body transport. Chat/vision/embed suites passed (3 files); scoped ESLint passed.

Evidence: `llm/chat.ts:340–359`, `vision.ts:83–103`, and `embed.ts:150–174` separately assemble OpenRouter connection policy.

Proposed boundary: shared provider construction with explicit modality hooks. Preserve private embedding body injection, structured-output support, injected fetch and distinct transcription behavior. Existing transport/privacy tests inspect actual outgoing requests.

### C7. General request infrastructure depends on BullMQ's Redis singleton

**Implemented — `72907ef0`, standalone shutdown completion in `80c8308f`.** Infrastructure now owns separate queue/request connections with unchanged transport settings. Queue shutdown closes only its role; process entrypoints close all roles. A lifecycle regression proves request clients survive queue teardown. Queue, token bucket, Telegram API and email processor suites passed. Shared build and compiled-import checks passed; changed application lint and web/worker typechecks passed.

Evidence: `queue/connection.ts:13–28` owns BullMQ-specific settings, but cache, token buckets, Telegram, email admission and provider budgets use it.

Proposed boundary: infrastructure-owned Redis lifecycle with explicit consumer roles. Preserve current settings during extraction; request deadline/retry changes need separate outage evidence. Queue shutdown must not implicitly own unrelated request resources.

## D. Runtime lifecycle and execution contracts

### D1. Snapshot identity depends on a manual image revision

**Implemented — `f0985bfe`.** Serialized recipe drives both Image construction and hash, including resources. Fourteen snapshot tests passed. Auto snapshot name intentionally changes once; normal next-deployment ensure is required, pins/retention unchanged, no remote action taken.

Evidence: `apps/worker/src/document-ingestion/document-extract-snapshot.ts:11–15,66` hashes a manual image marker and files; actual recipe and resources live separately at `:104–112,186`.

Proposed boundary: one serializable image recipe used to build and hash the snapshot. Prove image command/resource changes change snapshot identity. Preserve pins, protected retention, rollback window and fail-closed deletion safeguards.

### D2. Test isolation depends on source regex conventions

**Implemented — `45b11822`.** Manifest explicitly declares file/registration/batch policy; AST discovery handles aliases, parameterized rows and templates, rejects unsupported escaped registration aliases. Runner fixtures and all 17 isolation policies pass. Real queue run now executes four previously omitted parameterized cases; 46 queue and 5 test-support tests passed.

Evidence: `scripts/testing/run.ts:95–127` infers chunking/isolation from literal `it` syntax, single-quoted names and `vi.resetModules()` text.

Proposed boundary: explicit manifest isolation policy plus framework-aware discovery or a clear failure for unsupported isolated syntax. Preserve full test execution, offline env allowlist, live opt-in, web/DOM preloads and memory limits. Add mixed/parameterized-name and module-cache regressions; do not delete tests.

### D3. Delivery claim state transitions are duplicated

**Implemented — `ca6cf6cb`.** Shared claim operation preserves atomic sent/pending/failed/stale transitions and email billing reconciliation. Bot parity regressions passed.

Evidence: `messaging/delivery.ts:375–424` and `:905–943` repeat sent/failed/pending claim handling for email and bot digests.

Proposed boundary: delivery-ledger claim operation returning explicit states. Preserve atomic claims, stale threshold, provider idempotency, already-sent email billing reconciliation, encrypted payload replay and chat principal. Add bot parity to existing email ledger tests.

### D4. Agent retrieval has two clock owners

**Implemented — `b73ddc16`.** Native tools capture one trusted instant; MCP dispatches forward trusted dependencies. Full MCP run exposed one missing SDK-forwarding path, fixed; six focused clock/calendar cases then passed, all other full-run cases passed.

Evidence: `agent/ask.ts:345` supplies a trusted date; direct calendar tools honor it, composite retrieval does not pass it, and `agent/retrieval.ts:180–181` reads Date.now independently.

Proposed boundary: one trusted execution context passed through all retrieval paths. Preserve 14-day lookback/30-day forward window; do not expose model-controlled clock overrides. Add an injected-clock composite retrieval test.

### D5. Delayed-job translation is repeated across workers

**Implemented — `64fb8020`.** Worker-local delay primitive preserves token/time/DelayedError and rejects failed transitions; ingest and billing remain distinct adapters. Delay 4 and billing-context 2 tests passed; extract 23/embed 26 passed, full suggestion regression passed; combined worker/recovery run 240 tests passed.

Evidence: `extract.ts:562–564`, `embed.ts:580–582`, `suggestions.ts:4556–4558` translate delayed outcomes into BullMQ transitions; `billing-context.ts:18–32` has another bridge.

Proposed boundary: worker-local delay adapter. Preserve lock token, timestamp and DelayedError semantics, and keep billing admission distinct from ingest rate limits. Test failed transitions as errors.

### D6. Re-embedding repeats the same candidate query

**Implemented — `f3293f21`.** Shared candidate reader/page walker retains exact team/merged query, cursor ordering, phase order and global budget. Two focused pagination/budget tests passed; independent review found no regression.

Evidence: `apps/worker/src/scripts/reembed.ts:246–282,284–320` duplicates entity selection, merged filtering and cursor pagination for object/entity index passes.

Proposed boundary: shared page reader with separate scope-specific enqueuers. Preserve global budget, phase order, dry-run and collection semantics. Add equal-timestamp/page-boundary tests; no dedicated reembed test was found.

## E. Web state and identity workflows

### E1. Inbox uses a global boolean event protocol

**Implemented — `211e119e`.** Inbox provider binds bulk optimism to the server snapshot; refreshed unread rows and independent scopes are preserved. Eleven focused inbox tests passed, including late mount and rollback interleavings.

Evidence: `components/inbox/mark-all-read-button.tsx:19,34`, `notification-row.tsx:53`, and `inbox-list.tsx:47` coordinate optimistic reads through a string event and separate state owners.

Proposed boundary: inbox-scoped mutation controller. Preserve bulk/individual rollback interleavings and badge refresh; add pagination/mount-during-pending coverage.

### E2. HTTP errors have several incompatible decoders

**Implemented — `a25e2e38`, safe JSON-error display in `b7b3a767`.** One structured response decoder preserves safe messages, support refs and approved legal redirects. Malformed/empty/transport cases and ten action/consumer suites passed.

Evidence: `lib/paginated-api.ts:21`, `lib/client-api-error.ts:16`, `components/integrations/provider-connections.tsx:89`, and `components/job-recovery/jobs-page-toast.ts:9` differ on references, legal redirects and malformed bodies.

Proposed boundary: structured response decoder; domains choose safe user-facing messages. Preserve approved redirects and avoid displaying arbitrary server text. Cover malformed/empty responses, references, 428 and transport errors.

### E3. Actions maintain independent refresh route inventories

**Implemented — `cf61f7fb`.** Typed domain-change surface mapping and shared best-effort execution replace route inventories. Committed acceptance remains successful when refresh fails; remaining surfaces still run. Action/consumer and focused refresh tests passed.

Evidence: object, board, pin and suggestion actions each enumerate affected routes; document actions duplicate best-effort revalidation helpers.

Proposed boundary: domain changes map to explicit affected surfaces through one execution policy. Preserve page/layout distinctions, detail IDs, legacy routes, and successful commits despite refresh failures. Avoid blanket app invalidation.

### E4. Public session/runtime stores repeat lifecycle mechanics

**Implemented — `787c21d4`.** Public stores share subscription/generation/deduplication lifecycle while adapters preserve distinct failure policies. Stale completion after reset/newer snapshot regression passed.

Evidence: `lib/public-session.ts:14–20,51,70,83` and `lib/public-runtime.ts:29–35,89,109,122` duplicate subscriptions, request generations, inflight dedupe and focus/navigation refresh.

Proposed boundary: small lifecycle primitive with separate session/runtime policies. Preserve SSR unknown state, disabled consumers, auth refresh and successful Turnstile-key retention. Test stale completion after reset/newer state.

### E5. Workspace initialization is repeated across signup paths

**Implemented — `e274a8d5`.** Transactional initialization primitive preserves distinct credentials/OAuth/delegated defaults, grants and audit policies. Four suites passed including OAuth fallback parity and DB rollback.

Evidence: `agent-provisioning/workspace.ts:12`, `apps/web/src/lib/default-team.ts:38`, and `app/actions/auth.ts:223` independently create overlapping workspace defaults.

Proposed boundary: transactional initialization primitive with explicit policy inputs. Keep invites, verified-owner grants, OAuth membership checks and slug/idempotency differences separate. Do not silently add missing side effects under a refactor label; establish OAuth fallback parity tests first.

### E6. Task classification state is split across inference and objects

**Implemented — `db448be1`.** Pure packet/hash contract and category-state service behind guarded object APIs. AST comparison confirms moved helper bodies unchanged. Objects 91, state 41, worker 10 and classifier/proposal suites passed. No prompt/model/hash change.

Evidence: `objects/index.ts:139` imports packet/hash helpers from inference-owning `task-categories/classifier.ts`; state workflow lives at `objects/index.ts:6750–7356`.

Proposed boundary: pure packet/fingerprint contract and cohesive category-state service behind guarded scope. Preserve manual overrides, compare-and-set hashes, project versions, ambiguous projects, undo provenance and kill switches. Existing state/worker tests protect these.

### E7. Production extraction lookup carries legacy mutation capability

**Implemented — `db448be1`.** Production lookupMentions is read-only; resolve retains legacy mutation compatibility. Six resolver tests include no creation/no alias mutation; extract worker regressions passed.

Evidence: `extract/resolve.ts:180,214,231` mixes lookup with creation/alias mutation and queue effects; the production caller `apps/worker/src/workers/extract.ts:318–324` disables both mutations.

Proposed boundary: explicitly read-only production resolver; isolate compatibility mutation behavior until its consumers are established. Preserve aliases, type separation, archived/merged filtering and ambiguity handling. Repository search alone does not justify removing an exported legacy API.

### E8. Explicit-retrieval parsing repeats vocabulary and clause segmentation

**Implemented — `b73ddc16`.** Dedicated parser derives enum vocabulary and owns clause slicing while retaining six supported tools. Agent eval and explicit-tool regressions passed.

Evidence: `agent/ask.ts:115,132,164,201` repeats provider/source sets; helpers at `:134,152,177` repeat slicing until the next named tool.

Proposed boundary: dedicated parser with shared segmentation and canonical vocabulary validation. Keep the intentionally supported six-tool subset explicit. Preserve the required instruction wording and clause-local identifiers; use existing multi-tool/provider tests.

## What should remain deliberate

Team and visibility restrictions, source immutability, calendar busy redaction, provider quota retries, durable checkpoints, OAuth pinning, delivery principals, snapshot retention safeguards, and provider-specific acknowledgment behavior are requirements. Do not remove them to reduce the number of branches. No test-cleanup/removal is authorized; structural and redundant-comment cleanup remain the selected scope.

## Final verification

- Independent reviews resolved hidden-parent stored-pin parity, nested after-commit scheduling, browser-clock optimistic-state leakage, missed MCP trusted-clock forwarding, and indirect isolated-test aliases.
- Static graph recheck (including new files): 1,288 non-test sources, 5,113 edges; the prior 32/5/4-file strongly connected groups became one 12-file orchestration group. The concrete cycle cuts in this assessment are complete; this is not a claim of a cycle-free repository.
- Shared/database builds, compiled imports, web/worker typechecks, changed application lint, formatting, agent evaluations, reconciliation evaluations, and focused domain/web/worker suites passed. No live provider evaluation, deployment, merge, or remote snapshot mutation is claimed.

### Static-check integration notes

The first final reconciliation run exposed source-contract guards that still assumed provenance helpers were declared inside objects/boards. These guards were updated to inspect the new canonical helper and its callers, preserving visibility and replay-ref enforcement. No runtime reconciliation failure was observed.

Mixed-package ESLint under direct Bun grew beyond practical memory use; one earlier concurrent lint exited137. Checks are serialized by package. Canonical `bun run test:dist-imports` invokes installed TypeScript shims under Node internally; this is an analysis/build exception only. Applications and tests remain on Bun 1.4.4.

### Verification coverage and remaining scope

All 32 assessment items are addressed; there are no remaining implementation items. Existing tests were retained. Worker verification included 313 tests plus runner contracts; domain verification included 141 tests plus final regression cases. Messaging verification included 131 tests with one opt-in live test skipped. Object/category state, web, agent/MCP and reconciliation verification is recorded per item above.

Root scripts and worker standalone scripts sit outside the repository ESLint project-service configuration; their targeted runner contracts and Bun syntax checks passed. No lint configuration was weakened to include them. The expanded lint invocation initially reported that scope mismatch, and application lint was checked within the configured projects.

Documentation review inventoried246 maintained Markdown/MDX/HTML surfaces and checked affected paths, operational contracts and cross-references. Updated agent instructions, snapshot ADR, platform-admin guidance and cleanup decision log; local links passed. Feature-only pushes do not trigger the repository main CI workflow. No PR, merge, deployment, or production verification is claimed.
