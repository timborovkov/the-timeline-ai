# Bun migration and release runbook

The JavaScript runtime, dependency manager, TypeScript script runner, and
unit/integration test runner use **Bun 1.4.4**. Next.js, TypeScript typechecking,
Turborepo, Playwright, Python extraction, FFmpeg, and infrastructure retain their
existing responsibilities. No Node-only tooling exception has been required so far.

## Development and CI

Install the version in `.bun-version`, then run `bun install --frozen-lockfile`.
Use `bun run dev`, `bun run build`, `bun run validate`, `bun run doctor`, and
`bun run test`. Run one package with `bun run --filter @timeline/web build`.
Operational commands retain their script names; invoke them with `bun run`.

`bun.lock` was imported from the previous pnpm lockfile. The dependency audit found
six added package versions: Bun types, Happy DOM's global registrator, Sinon fake
timers and its two dependencies. No application dependency version was upgraded.
The old test/build tooling accounts for removed package versions. The hoisted linker preserves a single Drizzle identity across workspaces, checked
by compilation and migration-backed tests. The old optional Vite peer allowance
was only needed by the removed Vite/Vitest tooling; no application override was
present. Native install scripts remain allowlisted; core-js's informational postinstall remains blocked.

Bun normally loads environment files automatically. The repository disables that
behavior with `env = false` in `bunfig.toml`, preserving existing explicit loaders
and exported development variables. Production commands additionally use
`--no-env-file`; configure Railway runtime variables normally. Offline tests
run with `--no-env-file` and a small environment allowlist, excluding provider
credentials. Live evaluations retain their explicit opt-in flags and credentials.

## Test execution

Use **`bun run test`**, not bare `bun test`, for the complete suite. The canonical
runner checks `scripts/testing/manifest.json` against discovered application tests
and launches each file in a separate Bun process. Register new files in that
manifest. Database suites remain serial, and the large suggestions suite retains
its bounded chunks. Opt-in live evaluations remain separate. All 622 original application/package test files and both existing standalone
script contracts are accounted for; the compatibility-helper contract adds one file. An explicit `--live` file
selector permits the selected tests to inherit credentials, while the original
per-suite opt-in flags still control provider calls. E2E fixtures also mark Next's
environment as already processed so its independent dotenv loader does not merge
a developer's symlinked `.env` into the test server or smoke build. Exported
provider and telemetry credentials are stripped from ordinary E2E environments;
explicit fixture database, Redis, and storage configuration remains supported.
Development E2E setup warms routes before timed journeys so cold Next.js
compilation does not consume navigation budgets. Production smoke uses compiled
output, binds explicitly to the fixture loopback address, and omits the dummy
OpenRouter key because production privacy checks intentionally reject it.
Setup recreates fixture auth states through real browser sign-in; ordinary
journeys reuse those states in independent contexts. Dedicated authentication
tests still exercise sign-in and sign-out directly. The opt-in analytics browser
scenario accepts only its documented dummy `ph-e2e` key.

Existing assertions execute with Bun's matchers. `@timeline/test-support` preserves
arbitrary expected-value typing and assimilates database query thenables for
`resolves`/`rejects`. The adapter also compiles string regex patterns and clones
plain data containers for subset matching: Bun 1.4.4 otherwise treats string
patterns literally and mutates nested received arrays during `toMatchObject`.
Focused contract tests protect both original assertion semantics. Mock registration is explicit before subject imports; partial
mocks read their originals first. Reset imports use distinct absolute specifiers
because Bun ignores query parameters on `file://` imports. Fake timers use Sinon
without replacing `setImmediate`, which React needs to finish asynchronous `act`.
Happy DOM, the React form-action fix, and stylesheet-backed CSS module mappings
are preloaded only for the applicable web tests.

The external HTTP boundary imports `undici/index.js` explicitly. Bun's built-in
`undici` substitute does not implement the complete Agent API needed by our DNS
pinning and dispatcher cleanup. Do not replace this with unguarded native fetch.

`bun run test:runtime` requires disposable local Redis (default port 6379, or
`RUNTIME_SMOKE_REDIS_URL`). It uses a unique queue, removes only that queue, and
checks real retries/reconnects, waits for an active job during graceful shutdown,
FFmpeg processing, Sentry capture/flush
with an in-memory transport, and migration startup/exit/signal propagation.
It also verifies that aborting an HTTP stream rejects its reader and closes the
server connection. Chunked test files include a complementary run for parameterized
or computed test names, preventing literal-name extraction from omitting cases.

## Deployment and rollback

All three Railway application services use the repository Dockerfiles with
`oven/bun:1.4.4-debian`. Remove dashboard overrides for Railpack build commands and
Node start commands. Production dependencies are installed from the frozen Bun
lockfile; workspace paths, database migrations, shared email templates, Next.js
standalone assets, and extractor sources are retained. Runtime images run as the
non-root `bun` user. The extractor retains its database migration command and
its existing restricted environment allowlist. The image's `node` compatibility command resolves to Bun.

1. Save the current Node release image identifiers and all service configurations.
   Do not combine the runtime switch with database-schema or payload changes.
2. Deploy the complete Bun release to the designated staging environment. Verify
   migrations, web health/authentication/streaming, both worker modes, Redis
   reconnects, retries, graceful shutdown, FFmpeg, and Sentry delivery/flush.
3. Run three matched Node/Bun workloads against identical isolated fixtures and
   resource limits. Record web p95 latency, job throughput/duration, CPU, and
   steady/peak RSS. Investigate repeatable degradation over 10%; installation and
   build timings alone do not establish runtime performance parity.
4. Complete a 24-hour staging soak, including scheduled jobs and process restarts.
   Record failures, queue depth, reconnects, and monitoring evidence.
5. After explicit production release authorization, pause webhook/job intake and
   scheduled producers, drain active jobs, switch the web and both worker services
   to the same Bun release, smoke-test, and resume intake. Do not leave an
   intentional mixed-runtime deployment.
6. On a failed startup, correctness, monitoring, or performance gate, pause intake
   and restore the saved **whole Node release** and its service configurations.
   Verify health before resuming. No reverse database migration is introduced.

## Evidence and outstanding gates

The [local Node/Bun comparison](research/bun-local-performance.md) records three
matched runtime runs, a longer-warm-up follow-up, and processing isolation. It
shows a consistent local memory reduction, with workload-dependent latency and
CPU results; it does not replace staging acceptance.

Implementation validation is in progress. Static validation, React Doctor's verified
100 score, offline agent and reconciliation evaluations, compiled-package imports,
and runtime smoke checks have passed. All 619 offline test files have passed across
the migration runs and targeted reruns; this is aggregate evidence, not a claim of
one uninterrupted full-suite run. The final chunk-runner correction passed all
208 suggestions cases, including both parameterized interrupted-acceptance cases. The clean frozen Bun install, production
dependency image, Sharp and FFmpeg loading, and production web build/smoke have
also passed. The initial Node
baseline passed 31 database tests and 1,207 shared tests but hit an existing
10-second database-setup timeout in the shared unit group; it is not a full green
baseline. The full worker image has also passed both ordinary-worker and
document-extractor startup, all 77 migrations, non-root Bun runtime verification,
and graceful shutdown against disposable local infrastructure. Railway configuration
tests pass for the web and worker services. Browser coverage has passing aggregate
evidence, including the final five production-mode filter and calendar checks;
this is not one uninterrupted full-browser-suite run. Full migration acceptance
still requires final static checks and staging gates. Both full Docker images
build successfully. The web image passed migrations, health, sign-in HTML and
static-asset delivery, non-root Bun executable verification, and signal-driven
shutdown. No production rollout is claimed.

Railway staging access and the target environment must be supplied before the
staging deployment, matched measurements, and soak can be completed. The repository
mentions `/document-release`, but that skill was not present in the available skill
catalog or searched repository locations; the documentation audit is performed
manually instead.
