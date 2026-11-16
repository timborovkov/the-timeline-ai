---
name: test-strategy
description: >-
  Testing strategy for adding, reviewing, and improving meaningful tests. Use
  when asked to increase coverage, add tests, review existing tests, set up test
  commands or GitHub Actions, design unit/integration/E2E/API/DB tests, or add
  evals for AI and agent workflows. Also use when an agent needs guidance on
  what to test, how to structure tests, or how to investigate failing tests.
---

## Timeline repository contract

Read root `AGENTS.md` and path-scoped instructions first. Their Bun-only commands,
validation gates, operational exemptions, privacy rules, and authorization scope
override generic examples below. Load this skill by reading its file if the client
has no Skill tool. Never assume local-machine tools, credentials, or global skills
exist in a cloud checkout.


# Test Strategy

Purpose: test behavior deeply enough to trust the system.

"Tests should be coupled to the behavior of code and decoupled from the structure of code." - Kent Beck

Use this as an action skill when the user asks to add or improve tests. Use it
as guidance when another workflow needs testing judgment.

## 1. Inspect First

Before changing tests:

- Read local instructions: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, README test docs, package manifests, Go modules, and `.github/workflows/`.
- Discover existing test tools, commands, fixtures, seed logic, CI behavior, and naming conventions.
- Follow established repo conventions unless they are weak, missing, deprecated, or conflict with the user's request.
- Before using framework/library-specific APIs or config, fetch current docs according to the repo's doc-fetching rule.
- Prefer latest stable supported dependencies and current APIs. Do not introduce deprecated patterns. For example, in Next.js 16, prefer `proxy.ts`/`proxy.js` and `proxy` exports over deprecated `middleware.ts`/`middleware.js` and `middleware` exports unless the repo has a documented reason.

## 2. Plan The Test Slice

For non-trivial work, write a brief test plan before implementation:

- behavior contract under test
- test layer: unit, integration, API, DB, E2E, or eval
- happy paths, edge cases, error cases, permissions, and state transitions
- fixtures, seed data, auth setup, cleanup, and external resources
- what failure would prove the product logic is wrong

For small bug fixes, start with a focused failing regression test.

## 3. Test Behavior, Not Structure

Couple tests to externally meaningful behavior:

- caller-visible inputs and outputs
- persisted records, database constraints, transactions, and migrations
- HTTP status, response bodies, headers, auth, permissions, and rate/error behavior
- emitted events, jobs, queue messages, emails, webhooks, files, and logs when those are the contract
- rendered UI, navigation, accessibility-relevant state, and user-visible errors
- agent/eval task outcomes, tool traces, artifacts, and success criteria

Avoid tests that only prove implementation choreography:

- tautological mocks that return exactly the value asserted
- tests that only verify a helper, repository, or service was called unless that call is itself the contract
- brittle assertions on private structure, incidental call order, snapshots, CSS classes, or object shape details that callers do not rely on
- coverage inflation with low-value assertions

Testing private/internal code is a last resort. Prefer public module/package/API
boundaries and caller perspective. Internal tests are acceptable when complex or
safety-critical logic cannot be exercised through the public surface without
absurd setup, or when Go package-internal behavior truly cannot be reached from
an external test package.

## 4. Choose The Right Layers

Default stack:

- JavaScript/TypeScript: Vitest for unit, component, API-adjacent, and integration tests unless the repo has a stronger established choice.
- Browser E2E: Playwright.
- Go: standard `go test`.
- Go package tests: use external `_test` packages whenever possible, as external callers would. Use same-package tests only for package-internal behavior that cannot reasonably be tested externally.

Use unit tests for pure logic, branching, validation, transformations, reducers,
serializers, authorization decisions below the API boundary, and error handling.

Use integration tests for real wiring: APIs, databases, auth/session stores,
queues, object storage, webhooks, migrations, and service boundaries.

Use E2E tests for critical user-facing workflows. Keep them focused and stable;
unit and integration tests should carry most branch coverage.

Use evals for AI and agent workflows. Do not merely test prompt plumbing with
mocks. Exercise representative tasks, tool use, traces, artifacts, success
criteria, regressions, and failure modes.

## 5. Infrastructure And Auth

Prefer real infrastructure for integration tests when behavior depends on real
semantics: SQL constraints, transactions, migrations, query behavior, queues,
auth/session stores, object storage permissions, webhooks, and external APIs.

- Prefer Docker, service containers, local emulators, and isolated test databases.
- Use in-memory substitutes only when they faithfully preserve the contract or the test is explicitly below the integration boundary.
- Cover authenticated, unauthenticated, unauthorized, expired/session-invalid, role/permission, and tenant/account isolation paths where relevant.
- For E2E, add deterministic seed logic, realistic test accounts, login/session helpers, and cleanup/reset commands.
- Cover the real login flow where practical; use storage-state helpers for repeated scenarios after login itself is covered.
- Give tests unique namespaces and deterministic fixture data.
- Clean up aggressively after tests, especially when creating persistent or costly resources such as Daytona workspaces, cloud projects, repos, users, queues, buckets, sandboxes, or eval artifacts.
- For external resources, use teardown, idempotent cleanup, TTLs when available, and defensive cleanup of leftovers from failed runs.

## 6. Mocks And Test Doubles

Use mocks, fakes, and stubs to protect the test boundary, not to replace the
logic under test.

Good uses:

- fake clocks, UUIDs, random sources, and timers
- test HTTP servers
- fake email/payment/analytics clients when the external provider is not under test
- controllable external API failures
- in-memory queues or stores only when their semantics match the contract being tested
- safety fences around costly, destructive, or flaky side effects in evals

Bad uses:

- mocking the repository/service/helper to return the exact asserted value
- bypassing auth/authorization in an API or E2E test where auth is part of the behavior
- replacing an agent workflow with a stubbed answer and calling it an eval

## 7. Coverage And Scenarios

Strive for the highest meaningful coverage achievable without pointless tests.
Do not mandate a universal percentage.

- Preserve existing thresholds.
- Add thresholds only when the suite is mature enough that the threshold protects quality instead of forcing shallow tests.
- Use coverage reports to find untested behavior, branches, and error paths.
- Test all important usage scenarios from the caller's perspective.
- Always include error cases: invalid input, missing resources, permission denial, dependency failure, timeout/cancelation, duplicate/retry/idempotency, and partial failure when relevant.
- Add concurrency, race, and idempotency tests where the code can be called concurrently or retried.
- For bug fixes, use red-green: write or identify a failing test that proves the bug before fixing it.

## 8. Test Intent Comments

At the top of each new test file or major suite, add a short plain-English
comment explaining the business behavior under test and why it matters.

For agent evals, this is mandatory. Explain:

- what the workflow is supposed to accomplish
- what success means
- which failure modes are guarded against
- which tools, services, or external resources may be touched

Keep comments useful. Do not narrate obvious code mechanics.

## 9. Commands, CI, And Docs

Prefer clear layer-specific commands:

- `test:unit`
- `test:integration`
- `test:e2e`
- `test:eval`

Also provide a fast default `test` or `validate` command when the repo can
support it cleanly. Slow, costly, destructive, or external-resource suites
should require explicit commands, labels, schedules, or secrets.

Set up GitHub Actions when the repo lacks a credible CI path for the new test
layer, unless the user explicitly says not to.

- Unit and core integration tests should run by default.
- E2E should auto-skip or be gated when browsers, Docker, secrets, or required services are unavailable.
- Agent evals should be split: fast regression evals in CI with tight budgets and stable fixtures; slow/costly/flaky/external evals behind explicit commands, scheduled jobs, labels, or required secrets.
- Skips must be explicit in logs and explain what was unavailable.

Update README/CONTRIBUTING/test docs when the developer contract changes:

- new test layer
- changed commands
- CI behavior
- required env vars, secrets, Docker services, or emulators
- seed/login/fixture/database setup
- E2E skip behavior
- eval commands and artifact locations

Do not document every individual test case.

## 10. When Tests Fail

A failing test is evidence, not an instruction to weaken the test.

Investigate before changing assertions:

- Confirm intended behavior from docs, code, user request, product language, or existing callers.
- Determine whether the product logic, test setup, fixture, assertion, environment, or dependency is wrong.
- Fix the underlying code when the test reveals a real behavior bug.
- Fix the test when the asserted contract is invalid or the setup is unrealistic.
- Only loosen, skip, or delete a test when you can explain why the test contract was wrong or the layer is intentionally unavailable.

Final reports should say what test layers changed, what behavior is now covered,
what commands passed, and which meaningful gaps remain.
