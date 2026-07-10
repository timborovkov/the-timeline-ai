# App Audit Fixes And Improvements

Prioritized implementation backlog from the repository audit performed on
2026-07-10. This document covers security, reliability, accessibility,
performance, and maintainability findings. It does not replace the product
roadmap in [`todo.md`](../todo.md).

## Implementation Status

All 15 findings were implemented on 2026-07-10. The changes include:

- DNS-pinned SSRF protection and bounded outbound/inbound HTTP.
- Public error correlation references and canonical security audit actions.
- Failure-aware MCP controls, connected labels, native modal navigation,
  visible focus, and live support-form status.
- Offscreen task containment, cohesive security/domain helper modules, and a
  resettable PGlite test database.
- Queue-free private text capture stage stamping and locale-aware display copy.

The sections below remain as the evidence and acceptance record for regression
review.

## Final Verification

- `pnpm test` passed all six workspace tasks across the database, shared, web,
  and worker packages. The web package passed 1,098 tests across 182 files;
  shared unit and PGlite integration suites and all worker unit/integration
  suites also passed.
- `pnpm test:dist-imports` and `pnpm test:eval` passed.
- The 35-test boards PGlite suite now completes in seconds rather than the
  multi-minute baseline stall.
- `pnpm validate` passed formatting, TypeScript, ESLint, and Knip; `pnpm run
  doctor` reported `React Doctor score: 100` and `No issues found!`.

## Audit Baseline

- `pnpm validate` passed.
- `pnpm run doctor` reported `React Doctor score: 100` and `No issues found!`.
- `pnpm check:web-bundle` passed.
- `pnpm --filter @timeline/web test` passed 1,075 tests across 179 files.
- The full workspace test run was stopped after 7 minutes 47 seconds while
  `packages/shared/src/boards/index.test.ts` was still running. That test file
  recreates PGlite and reapplies every migration before each of 35 tests; see
  item 13.

## Recommended Implementation Order

1. Close the MCP SSRF bypass.
2. Harden outbound HTTP and inbound webhook body handling.
3. Sanitize public errors and complete audit logging.
4. Fix failed-mutation handling and accessibility defects.
5. Address large-list performance, module size, and test speed.

## P0 — Security

### 1. Close the MCP SSRF bypass

**Evidence:**
[`packages/shared/src/mcp/auth.ts`](../packages/shared/src/mcp/auth.ts) validates
the URL's hostname as a string. Production-mode checks currently accept direct
targets such as `127.0.0.2`, `0.0.0.0`, `100.64.0.1`, IPv4-mapped loopback IPv6,
and public hostnames that resolve or later rebind to private addresses.

**Implement:**

- Classify all resolved IPv4 and IPv6 addresses, including loopback, private,
  link-local, carrier-grade NAT, unspecified, multicast, reserved, and
  IPv4-mapped IPv6 ranges.
- Resolve and validate every A/AAAA result immediately before connection.
- Prevent DNS rebinding by pinning the validated address for the request or by
  using a dispatcher that validates the actual connected address.
- Apply the same guard to MCP RPC, discovery, registration, token, and refresh
  requests, not only when a server is created.
- Keep redirects disabled and add an infrastructure egress deny-list as a
  second boundary.

**Acceptance criteria:**

- Regression tests reject every reserved range, equivalent numeric form, DNS
  name resolving to a blocked address, and address that changes between
  validation and connection.
- Valid public HTTPS MCP servers continue to connect.

## P1 — Security And Reliability

### 2. Add bounded, abortable outbound HTTP

**Evidence:**
[`packages/shared/src/mcp/client.ts`](../packages/shared/src/mcp/client.ts) and
the provider adapters under
[`packages/shared/src/integrations/providers/`](../packages/shared/src/integrations/providers/)
use unrestricted `fetch`. The timeout in
[`apps/worker/src/workers/mcpHealth.ts`](../apps/worker/src/workers/mcpHealth.ts)
uses `Promise.race` but does not abort the losing request.

**Implement:**

- Add a shared hardened HTTP client with an abort signal, per-operation
  timeout, maximum response bytes, redirect policy, and safe retry rules.
- Stream and cap response bodies instead of calling `res.text()` without a
  limit.
- Apply it to MCP calls, OAuth discovery/token requests, and every native
  integration provider.
- Record timeout, oversized-response, and abort reasons as typed operational
  errors.

**Acceptance criteria:**

- Hanging requests release their socket and worker resources after timeout.
- Oversized responses fail before the complete body is buffered.
- Tests cover timeouts, chunked oversized responses, redirects, and retryable
  versus terminal failures.

### 3. Bound webhook bodies before signature verification

**Evidence:** GitHub, Linear, Monday, Sentry, Recall, and Slack webhook routes
buffer `req.text()` or `req.json()` without byte caps before authentication.
The generic ingest route already contains a streaming capped-body reader in
[`apps/web/src/app/api/webhooks/ingest/route.ts`](../apps/web/src/app/api/webhooks/ingest/route.ts).

**Implement:**

- Extract the capped raw-body reader into a shared web utility.
- Set explicit provider-appropriate limits and return `413` when exceeded.
- Keep an early `Content-Length` rejection, but enforce the cap while reading
  so chunked requests cannot bypass it.
- Verify signatures against the exact bounded raw bytes.

**Acceptance criteria:**

- Every public webhook route rejects oversized bodies with bounded memory use.
- Tests cover declared and chunked oversized requests and confirm valid
  signatures still pass.

### 4. Stop returning raw exception messages to clients

**Evidence:** Actions and routes including
[`apps/web/src/app/actions/boards.ts`](../apps/web/src/app/actions/boards.ts),
[`apps/web/src/app/actions/calendar.ts`](../apps/web/src/app/actions/calendar.ts),
and
[`apps/web/src/app/api/team/job-recovery/bulk-route.ts`](../apps/web/src/app/api/team/job-recovery/bulk-route.ts)
return `err.message` directly. Database, provider, and queue details can reach
the browser.

**Implement:**

- Define typed public error codes and safe user-facing messages at action and
  route boundaries.
- Preserve explicitly expected domain errors through a narrow allow-list.
- Log the full internal error with operation context and a correlation ID.
- Return the correlation ID, not internal error text, for unexpected failures.

**Acceptance criteria:**

- SQL, stack, provider response, token, and queue details never appear in
  public responses.
- Tests distinguish expected domain errors from unexpected internal errors.

### 5. Complete security-relevant audit logging

**Evidence:**
[`apps/web/src/app/actions/team-exports.ts`](../apps/web/src/app/actions/team-exports.ts)
uses `team_export.created` and `team_export.archive_url_signed`, while the
shared audit action vocabulary contains `team.export_create`. Job retry and
dismiss routes do not write the available `job.retry` and `job.dismiss`
actions. This gap is also tracked in [`todo.md`](../todo.md).

**Implement:**

- Write `team.export_create`, `job.retry`, and `job.dismiss` through the shared
  audit scope.
- Include actor, team, target ID, recovery kind, single/bulk mode, and outcome
  without storing sensitive payload content.
- Place audit writes in the same database transaction as the state change
  where possible.

**Acceptance criteria:**

- Successful and rejected security-relevant operations have consistent audit
  entries.
- Tests assert action name, actor, target, metadata, and team isolation.

## P1 — Product And Accessibility

### 6. Handle failed MCP management mutations

**Evidence:** Enable, remove, and revoke operations in
[`apps/web/src/components/integrations/mcp-servers.tsx`](../apps/web/src/components/integrations/mcp-servers.tsx)
and
[`apps/web/src/components/integrations/mcp-share.tsx`](../apps/web/src/components/integrations/mcp-share.tsx)
ignore `res.ok`, do not catch network errors, and refresh as if the mutation
succeeded.

**Implement:**

- Check every response and parse a safe public error.
- Catch offline and aborted requests.
- Add per-row busy state, disable duplicate actions, and keep or roll back the
  previous UI state on failure.
- Surface actionable inline errors instead of raw `res.text()` dialogs.

**Acceptance criteria:** Tests cover success, `403`, `500`, offline, and rapid
repeat interactions for enable, remove, and revoke.

### 7. Repair form labels

**Evidence:** MCP configuration fields render `Label` without `htmlFor` and
controls without IDs in the same MCP components.

**Implement:** Give every input/select a stable ID and connect its label with
`htmlFor`. Preserve a single clickable label/control target for checkboxes and
radios.

**Acceptance criteria:** All form controls have an accessible name and clicking
a visible label focuses or toggles its control.

### 8. Restore visible keyboard focus

**Evidence:** Multiple custom controls remove outlines and use only a subtle
border-color change, including
[`apps/web/src/components/global-search-page.tsx`](../apps/web/src/components/global-search-page.tsx),
[`apps/web/src/components/work-filter-bar.tsx`](../apps/web/src/components/work-filter-bar.tsx),
and board forms.

**Implement:** Standardize shared control classes with a high-contrast
`focus-visible` ring and offset. Remove local `outline-none` unless the
replacement is equally visible.

**Acceptance criteria:** A keyboard-only pass can always identify the focused
element in light and dark themes.

### 9. Make mobile navigation genuinely modal

**Evidence:**
[`apps/web/src/components/mobile-nav.tsx`](../apps/web/src/components/mobile-nav.tsx)
renders `<dialog open>` without invoking modal behavior. It does not provide a
native focus trap or make background content inert.

**Implement:** Rebuild the sheet on the existing dialog primitive or call
`showModal()` with full lifecycle handling. Focus the close control on open,
trap focus, restore the opener on close, make the background inert, and add
safe-area and overscroll containment.

**Acceptance criteria:** Keyboard, screen-reader, resize, rotation, backdrop,
and Escape behavior are covered by component/browser tests.

### 10. Fix support-form hydration and announcements

**Evidence:**
[`apps/web/src/components/help/support-form.tsx`](../apps/web/src/components/help/support-form.tsx)
reads `window.location.href` during render, producing different server and
client values. Its success and error updates are not live announcements.

**Implement:** Pass the current page from the server or populate it after
hydration. Use an `aria-live`/alert status region and replace remaining three
period loading copy with a typographic ellipsis.

**Acceptance criteria:** No hydration warning occurs, the correct source URL is
submitted, and assistive technology announces success and failure.

## P2 — Performance And Maintainability

### 11. Virtualize large task collections

**Evidence:** [`apps/web/src/lib/task-board-config.ts`](../apps/web/src/lib/task-board-config.ts)
loads 500 tasks per page and permits 250 rendered cards per column or 1,000
rendered list rows.

**Implement:** Virtualize long columns/lists or apply measured
`content-visibility` containment while preserving drag-and-drop, keyboard
navigation, selected-task deep links, and cursor loading.

**Acceptance criteria:** Profile with 500, 1,000, and 5,000 tasks; scrolling,
filtering, selection, and drag operations remain responsive without losing
accessibility semantics.

### 12. Break up oversized domain and UI modules

Current hotspots include:

- `packages/shared/src/objects/index.ts` — approximately 6,690 lines.
- `packages/shared/src/suggestions/index.ts` — approximately 5,551 lines.
- `packages/shared/src/team-scope.ts` — approximately 3,365 lines.
- `packages/shared/src/agent/tools.ts` — approximately 3,292 lines.
- `apps/web/src/components/objects/object-detail-client.tsx` — approximately
  2,275 lines.

**Implement:** Extract cohesive command/query modules and UI sections behind
the current package exports. Keep team scoping and transaction ownership at
explicit boundaries rather than creating new cross-module database access.

**Acceptance criteria:** Public behavior and package exports remain stable,
tests stay meaningful, and each new module has a clear domain responsibility.

### 13. Speed up PGlite test setup

**Evidence:**
[`packages/shared/src/boards/index.test.ts`](../packages/shared/src/boards/index.test.ts)
creates PGlite, applies every migration, and seeds the workspace in
`beforeEach` for 35 tests.

**Implement:** Create one migrated base snapshot and clone it per test, or use
transaction rollback when isolation semantics allow it. Apply the same helper
to other PGlite-heavy files.

**Acceptance criteria:** Preserve isolation and schema-contract coverage while
reducing the board test file from minutes to seconds and making `pnpm test`
practical as a local gate.

### 14. Remove unnecessary private-capture queue churn

**Evidence:**
[`apps/web/src/app/actions/events.ts`](../apps/web/src/app/actions/events.ts)
enqueues extraction, embedding, and suggestion jobs for private text captures,
while those workers intentionally skip non-team AI processing after privacy-safe
preprocessing.

**Implement:** Separate deterministic privacy-safe preprocessing from AI work,
then stamp skipped AI stages without scheduling jobs that cannot proceed.

**Acceptance criteria:** Private captures retain required link/provenance
behavior, never reach model or embedding providers, and do not report false
processing warnings during queue outages.

### 15. Clean stale copy and locale handling

**Evidence:** Custom MCP OAuth is implemented but the option still says
`OAuth (coming soon)`. Several surfaces use hardcoded `en-CA` display dates and
three-period loading text.

**Implement:** Update the OAuth label, format user-facing dates with the
appropriate `Intl` locale/timezone, use stable ISO formatting only for machine
fields, and standardize loading copy with `…`.

**Acceptance criteria:** Copy matches shipped behavior and dates render
correctly for non-English locales and multiple team timezones.

## Existing Roadmap Items To Keep Prioritized

These are already present in [`todo.md`](../todo.md) and remain important for
beta readiness:

- Per-team monthly vision-spend caps and an admin dashboard.
- Failed meeting-bot states with retry or rejoin recovery.
- Backup automation, restore documentation, and recurring restore drills.
- Railway/Sentry/worker queue dashboards and provider canaries.
- UX overhaul verification with browser QA and before/after screenshots.

## Verification For Each Implementation

After every change:

1. Add the nearest meaningful regression tests.
2. Run `pnpm validate`.
3. Run `pnpm run doctor` and require a score of 100.
4. Run the targeted test command and any required eval, dist-import, or E2E
   suites from [`AGENTS.md`](../AGENTS.md).
5. Update this backlog and `todo.md` when an item ships or its scope changes.

Accessibility findings should continue to be checked against the current
[Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)
and the project rules in [`design.md`](../design.md).
