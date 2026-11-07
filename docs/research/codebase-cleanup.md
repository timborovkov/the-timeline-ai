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
