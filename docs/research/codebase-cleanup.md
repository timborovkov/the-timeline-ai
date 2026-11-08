# Codebase cleanup decision log

Baseline: `2bfd5da1` on `feature/codebase-cleanup`.

Goal: a typical feature change has one clear home, and dependencies and safety
rules are explicit. Scope includes structural refactoring and removing comments
that restate implementation. Existing tests remain the regression safety net;
test deletion and unrelated product changes are outside this cleanup.

## Decisions and evidence

1. Separate digest scheduling policy from digest generation.
   `queue/queues.ts` imports the AI/DB-backed digest generator solely for
   `defaultDigestWindow`. A dependency-light scheduling module should own the
   cutoff, timezone handling, 25-hour overlap, and expiration rule together.
2. Give document list transport one serializer and contract.
   The documents SSR page, list API, and paginated query repeat the response
   shape. Keep pin enrichment outside the cached document response and retain
   all team/visibility checks at their current boundary.
3. Give timeline transport types a home outside client hooks.
   Server timeline presentation imports types owned by a multi-domain client
   hook. Pure contracts should be shared by server and client consumers without
   depending on either implementation. Preserve snapshot/cache reconciliation.
4. Keep feature action results out of authentication infrastructure.
   `action-scope.ts` contains proposal revision and task undo payloads. Domain
   actions should own these results; shared success/error fields can stay common.
5. Put capability classification beside agent tool definitions.
   Distant mutation/proposal/pin lists must currently change with tool additions.
   Preserve read-only, proposal-only, pin, approval, and content-fencing behavior.
6. Reuse the database event-source vocabulary in agent and MCP validation.
   Three copies currently require lockstep updates. Narrower write-source
   subsets remain intentional and must not be broadened.
7. Register worker lifecycle responsibilities together.
   Startup, scheduling, consumer draining, and producer cleanup repeat worker
   inventories. Preserve optional workers and drain consumers before closing
   their queues, Redis, or the database.
8. Separate timeline domain implementation from scope composition.
   `withTeam` combines authorization/composition with timeline query and
   presentation implementation. Keep it as the only public guarded entry;
   preserve membership caching, ZERO_UUID visibility, operator attribution,
   and audit behavior while extracting cohesive services.
9. Give suggestion acceptance explicit transaction ownership.
   Generic scope dependencies carry evidence-lock state, transaction callbacks,
   and mutable after-commit effects. Acceptance should own the unit of work;
   preserve races, rollback records, evidence locks, and commit-before-effects.
10. Put resource selection and cursor policy behind integration providers.
    The generic sync worker knows provider hierarchies and shared collection
    cursors. Providers should own these policies while durable checkpoint,
    retry, lease, and handoff execution stay in the orchestrator.

## Required special cases

Provider quotas, durable retries, private actor boundaries, consent checks,
deployment isolation, and transaction ordering encode requirements. They are
not surplus merely because they introduce branches or exceptions. Large files
alone are not evidence that a module needs splitting.

## Validation and completion

Run targeted behavior suites for each boundary, agent evals for tool changes,
and dist-import checks for compiled loader boundaries. Follow `AGENTS.md` for
CI and merge policy; no deployment is part of this work. Review the final diff
independently for regressions and remaining coupling before claiming completion.

## Implemented boundaries

- `messaging/digest-window.ts` owns timing policy; queue code no longer loads
  digest generation to calculate a window. Existing messaging exports remain.
- Web `document-list.ts`, `timeline-types.ts`, and domain action-result modules
  own transport contracts separately from client hooks and authentication.
- Agent tools declare required capability and mutation approval metadata beside
  their definitions. Instrumentation preserves approval metadata; neither tool
  eligibility nor approval needs a separate name list. Source schemas and web
  source types reuse the database vocabulary.
- `worker-lifecycle.ts` derives draining and producer cleanup from registrations.
- Timeline reads, paging, facets, and moment lookup live in `timeline/read-scope.ts`;
  presentation persistence lives in `timeline-moments/presentation-cache.ts`.
  These internal factories are composed only through `withTeam`.
- `suggestions/acceptance-transaction.ts` owns transaction execution and effect
  buffering. Guarded transaction-scope construction and domain rollback handling
  remain at their respective boundaries.
- Integration adapters own `syncSelectionPolicy`; the sync worker owns durable
  orchestration rather than provider resource hierarchy rules.

Capture writes and semantic search remain in their existing modules: file size
alone did not establish another useful extraction. Provider retries, private
actor rules, and team-wide pin maintenance are retained requirements.

## Verification evidence

Targeted checks passed for web actions, document responses and pin-cache behavior,
timeline rendering/contracts, onboarding state, digest timing/delivery, queue
wrappers, worker gates/lifecycle, integration sync/provider contracts, agent tools,
MCP handling, and suggestion acceptance. The full suggestion suite passed 206
cases, the new acceptance boundary passed three, and scope/search passed 76.
The required `test:eval` passed 102 cases across nine files. `test:dist-imports`
passed, including the database/shared builds and compiled export loading.

Independent reviews covered web, worker/digest/provider boundaries, agent approval
metadata, suggestion transactions, and timeline guard wiring. No actionable
introduced defects remained. All 20 extracted timeline function bodies were also
compared against the baseline using a comment-free TypeScript AST printer.

Application tests ran on Bun 1.4.4. Some prescribed `bun x` analyzer commands
launched installed Node shims; direct Bun analyzer entrypoints were used for
coordinated reruns. Earlier concurrent analyzers exhausted memory; those failed
runs are not passes. Final shared, worker, and web typechecks passed. Changed-file
ESLint passed after targeted corrections; formatting, local Markdown links, and
diff whitespace were checked. Repository-wide CI was not run locally.

This is local validation, not a CI, merge, deployment, or live-provider claim.

## Assessment follow-through

The follow-up assessment starts at `1dfae8be`. Its 32 items cover transaction
ownership, canonical contracts, dependency cycles, worker lifecycle policy and
web state. The implementation retains domain behavior and existing tests, with
focused regressions for the newly exposed ownership mistakes.

- Calendar due-date indexing and vector deletion share a dispatcher that honors
  the owning transaction's after-commit collector. Pins reuse owning-domain
  visibility predicates and calendar-series canonicalization. Direct-write
  provenance has one reconciliation-owned source-context policy.
- Operator scope operations declare exhaustive capabilities; method spelling no
  longer determines authorization. Request-context initialization is explicit.
  Workspace initialization shares a transaction primitive while signup paths
  retain their distinct verified-owner, calendar, slug and audit policies.
- Retrieval inputs, trusted clocks and explicit-tool parsing have canonical
  contracts. Proposal observations use colocated tool metadata. Dashboard chat
  context shares strict request and tolerant storage adapters.
- Billing meter identities, allowance predicates and recommendation policy live
  below billing orchestration. Reconciliation core contracts and presentation
  cache contracts no longer load dashboard or inference orchestration.
- Slack outbound delivery is independent of inbound dispatch. Digest delivery
  depends on generic delivery, with a common atomic delivery-claim operation.
  Telegram link-token verification remains transaction-bound; group and personal
  binding retain their separate authorization policies.
- Structured inference accepts domain-owned output normalization in every repair
  path. Provider construction shares privacy and transport configuration while
  embeddings retain their body-level routing policy. Task-category packet hashes
  are pure; category state lives behind guarded object-scope operations. Production
  mention lookup is explicitly read-only; legacy mutation compatibility remains.
- Redis infrastructure owns separate queue and request lifecycles. Process
  entrypoints close all roles after work drains; queue teardown alone cannot close
  request caching or admission connections. Retry and protocol settings are unchanged.
- Recovery thresholds, delayed-job translation and re-embedding page selection
  have single owners. Daytona snapshot identity hashes the actual serialized
  recipe/resources rather than a manual revision marker. Test isolation is explicit
  in the manifest and registration parsing preserves parameterized test rows.
- Inbox optimistic state is scoped to its server snapshot. HTTP response decoding,
  mutation refresh surfaces and public-store request generations share focused
  owners while their domain policies remain separate.

The automatic Daytona snapshot name changes once under the recipe-hash migration;
normal snapshot publication/ensure must run on the next deployment. Explicit pins
and deployed-hash cleanup protections are unchanged. No remote snapshots, production
services, deployments or merges are part of this cleanup.


The [completed follow-up assessment](untangle-assessment.md) records all 32 items,
implementation commits, focused verification, review fixes and remaining scope.
Shared/database builds, compiled imports, worker/web types, changed application
lint, formatting, agent evaluations, reconciliation evaluations and targeted
web/domain/worker suites passed. No tests were deleted. Feature-only pushes do
not trigger the main CI workflow; no merge or deployment was performed.

The subsequent [Google Drive ownership cleanup](google-drive-cleanup.md) applies
the same rules to the merged Drive v1 implementation, covering extraction,
capture contracts, selection linking, scheduling, OAuth attempt state, and
resource validation.
