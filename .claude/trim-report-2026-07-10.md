# Trim Report — 2026-07-10

## Scope

- Base: `origin/main` at `2386fe97` (latest main CI run passed).
- Reviewed: union of committed branch changes and current unstaged changes.
- Changed paths: 159 total; 154 TypeScript/TSX files, including 54 test files.
- Excluded: `pnpm-lock.yaml`, generated/build output, vendor dependencies, agent state,
  and unchanged code outside the branch diff.
- Stack: TypeScript 6, Next.js 16, React 19, Vitest 4, Drizzle/PGlite.
- Current-diff verification already green: `pnpm test`, `pnpm validate`,
  `pnpm run doctor` (100), `pnpm test:dist-imports`, and `pnpm test:eval`.

Estimated regular-finding reduction: **120–145 lines**. No behavior changes are
proposed.

## Public API Findings

### P1 — Remove the public Slack provider test mutator

- Bucket: `P` public-surface risk
- Location:
  - `packages/shared/src/integrations/providers/slack.ts:14-21`
  - `packages/shared/src/integrations/index.ts:16`
  - `apps/worker/src/workers/integrationSync.test.ts:124,158`
- Current/proposed lines: approximately 9 / 0 public lines; replacement test
  injection may be line-neutral overall.
- Why: `setSlackProviderFetchForTests` is mutable process-global test state exposed
  through the published `@timeline/shared/integrations` barrel. Production callers
  can discover and invoke an API that exists only to support one worker test.
- Proposal: keep the transport seam private to the provider/test boundary, or inject
  the provider/transport through the worker's existing dependency boundary. Remove
  the setter from the package barrel.
- Risk: medium; removing a package-barrel export is a public-surface change and needs
  explicit opt-in.
- Tests: meaningful coverage exists in
  `packages/shared/src/integrations/providers/slack.test.ts` and the native Slack
  worker sync case in `apps/worker/src/workers/integrationSync.test.ts`.

Before:

```ts
export function setSlackProviderFetchForTests(transport?: typeof externalFetch): void
export { setSlackProviderFetchForTests, slackProvider } from './providers/slack.js';
```

After:

```ts
// Production barrel exports only slackProvider; tests inject the transport
// through a non-public dependency boundary.
```

## Regular Findings

### a1 — Remove component-location narration

- Bucket: `a` verbose comments
- Location: `apps/web/src/components/integrations/mcp-servers.tsx:132-139,
  173-176,323-326`
- Current/proposed comment lines: 15 / 3
- Estimated reduction: 12 lines
- Why: two comments enumerate visible call sites already found by symbol search, and
  the OAuth comment narrates the immediately following branch. Keep only the reason
  that OAuth servers must start authorization immediately.
- Risk: none.
- Tests: not required for comment-only removal.

Before:

```ts
/**
 * Standalone add-server form. Mounted by either:
 *   - <McpServersUi> ...
 *   - the team /integrations page ...
 */
```

After:

```ts
// Start OAuth immediately so a newly created server is not left disabled.
```

### e1 — Replace the action-union MCP share reducer with a patch reducer

- Bucket: `e` simplification
- Location: `apps/web/src/components/integrations/mcp-share.tsx:57-95,313-342,
  419,435,453`
- Current/proposed lines: approximately 46 / 25
- Estimated reduction: 18–22 lines
- Why: every reducer action except `created` assigns one field. A `Partial<McpShareState>`
  patch reducer matches the state transitions already used by the adjacent MCP server
  form; the `created` transition can pass its three-field patch directly.
- Risk: low.
- Tests: four meaningful component tests cover key creation, revocation, offline
  failure, and duplicate-request suppression.

Before:

```ts
type McpShareAction =
  | { type: 'busy'; busy: boolean }
  | { type: 'name'; name: string }
  // ...
function mcpShareReducer(state, action) {
  switch (action.type) { /* one assignment per case */ }
}
```

After:

```ts
function patchMcpShareState(state: McpShareState, patch: Partial<McpShareState>) {
  return { ...state, ...patch };
}
```

### d1 — Consolidate the single-job retry and dismiss route factories

- Bucket: `d` duplication
- Location:
  - `apps/web/src/app/api/team/job-recovery/[id]/retry/route.ts:1-64`
  - `apps/web/src/app/api/team/job-recovery/[id]/dismiss/route.ts:1-64`
  - analogous factory at `apps/web/src/app/api/team/job-recovery/bulk-route.ts:44-123`
- Current/proposed lines: 128 / approximately 75
- Estimated reduction: 45–55 lines
- Why: the two route files differ only in action name, scope method, operation name,
  and fallback code. The bulk endpoints already use a factory with the same pattern.
- Risk: low; authorization, audit outcome, expected errors, and status codes must stay
  byte-for-byte equivalent.
- Tests: separate retry and dismiss route suites cover unauthenticated/forbidden and
  successful dispatch paths. Add one factory-level assertion for each failure mapping
  before refactoring if the existing rejection coverage is judged insufficient.

Before:

```ts
export async function POST(...) {
  // auth, team, admin, audit, execute, audit, sanitize response
}
// Repeated in dismiss/route.ts with four identifiers changed.
```

After:

```ts
export const POST = createSingleFailedJobRecoveryRoute({
  action: 'job.retry',
  run: (scope, id) => scope.jobRecovery.retryRecoverableJob(id),
  operation: 'retry_recoverable_job',
  fallbackCode: 'retry_failed',
});
```

### d2 — Centralize JSON serialization of sanitized API errors

- Bucket: `d` duplication
- Location: `apps/web/src/lib/public-error.ts:53-72` and 12 JSON API catch
  blocks under `apps/web/src/app/api/` (MCP, integrations, connections, and job
  recovery). OAuth redirect callbacks are intentionally excluded.
- Current/proposed lines: approximately 95 / 40
- Estimated reduction: 45–55 lines
- Why: each site calls `publicApiError`, reconstructs the same optional-reference
  payload, and applies `failure.status`. A server-only helper can own that exact
  response contract while callers supply only the classification options.
- Risk: medium; preserve `NextResponse.json` status/body behavior and do not use the
  helper for redirect callbacks.
- Tests: `public-error.test.ts` covers classification and references; route suites
  cover MCP, integration, resource, and recovery response contracts.

Before:

```ts
const failure = publicApiError(err, options);
return NextResponse.json(
  { error: failure.error, ...(failure.reference ? { reference: failure.reference } : {}) },
  { status: failure.status },
);
```

After:

```ts
return publicApiErrorResponse(err, options);
```

### d3 — Share the public-error report assertion helper

- Bucket: `d` duplication
- Location:
  - `apps/web/src/app/actions/chat.test.ts:49-55,102-154`
  - `apps/web/src/app/actions/objects.test.ts:100-106,347-356`
- Current/proposed lines: approximately 35 / 20
- Estimated reduction: 12–16 lines
- Why: both files duplicate `errorReferenceFrom` and the same error/context/reference
  assertions. A test-only helper can assert the reported error, surface, operation,
  and eight-character reference in one call.
- Risk: none; test-only refactor.
- Tests: the affected chat/object tests themselves exercise the helper against real
  action results and mocked reporting side effects.

Before:

```ts
function errorReferenceFrom(context: unknown): unknown { /* repeated */ }
expect(reportContext).toMatchObject({ surface: 'server_action', operation });
expect(errorReferenceFrom(reportContext)).toMatch(/^[0-9a-f]{8}$/);
```

After:

```ts
expectPublicActionErrorReport(reportMock, error, operation);
```

## Buckets With No Actionable Findings

- `b` Legacy patterns: compatibility paths in this diff are intentional migrations,
  not obsolete syntax.
- `c` Dead private code: repo-wide Knip and ESLint are green; searches found no
  branch-added private code with a safely provable zero-call path.

## Approval

- `all`: implement all regular findings (`a1`, `e1`, `d1`, `d2`, `d3`), excluding
  `P1`.
- `select`: name specific regular findings and optionally `P1`.
- `none`: stop and leave this report in place.

`P1` always requires separate explicit approval because it changes a package public
surface.
