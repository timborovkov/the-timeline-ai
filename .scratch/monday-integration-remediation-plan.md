# Monday Integration Remediation Plan

## Definition of done

The integration is complete when:

- Only real Monday boards and WorkDocs appear as selectable sources.
- Selecting a parent board imports every parent item, classic subitem, multi-level descendant,
  update, and relevant column value.
- Existing and older items are imported immediately after activation, not only after they change.
- Webhooks are created only on valid parent boards.
- A rejected webhook or inaccessible board does not block other selected boards.
- Parent-item and subitem webhooks hydrate the correct records within minutes.
- Agent answers include actual board items, correct status and column context, and citations.
- Large boards, expired cursors, rate limits, retries, reconnects, and partial failures recover
  automatically.
- Existing affected integrations are repaired without mutating captured raw source content.

## Phase 1: Capture the real failure and provider contract

Before changing behavior:

1. Restore read-only production diagnostics:
   - Fix the copied `DATABASE_URL` credentials or authenticate Railway.
   - Do not expose tokens or event content.
2. Capture a sanitized Monday discovery response for the affected account:
   - Board ID
   - Name
   - `board_kind`
   - Workspace
   - Any available hierarchy or helper-board relationship fields
3. Record:
   - Current selected resources and ordering
   - Sync cursor per board
   - Last sync and error timestamps
   - Raw event counts by board ID and event type
   - Webhook subscriptions and provisioning errors
4. Identify exactly how Monday distinguishes:
   - Classic parent boards
   - Classic hidden subitem boards
   - Multi-level boards
   - Legitimate boards whose user-defined name begins with “Subitems of”
5. Pin an explicit supported `API-Version` header. Production should not silently change when
   Monday changes its default API version.

Deliverable: sanitized fixtures reproducing Tecci's board topology without production credentials.

## Phase 2: Write failing regression tests

Create red tests before implementation.

### Source discovery

Test that:

- `board_kind: "sub_items_board"` is hidden.
- The actual production-shaped hidden helper board with `board_kind: "public"` is hidden.
- Localized helper boards are hidden.
- Legitimate user-created boards are retained.
- WorkDocs remain selectable.
- Search for “subitems” returns the parent board, not its helper board.
- Pagination across more than 100 boards remains complete.

Avoid relying solely on the English name heuristic. Prefer a provider relationship or derived
helper-board ID when Monday exposes one; use naming only as a compatibility fallback.

### Item retrieval

Test:

- A parent board with ordinary items.
- Classic parent items with subitems.
- Multi-level boards with descendants at several depths.
- Empty boards.
- Archived and deleted records according to the intended product policy.
- More than 100 or 500 items and multiple pages.
- More subitems than a nested response can return in one page.
- Correct parent relationships, board IDs, status, column titles, URLs, owners, and updates.

### Webhooks

Test:

- No webhook mutation targets a helper-board ID.
- A Monday `InvalidArgumentException` for a subitems board is classified as a known unsupported
  target.
- One rejected board does not prevent valid boards from provisioning.
- Already-persisted subscriptions are reused idempotently.
- Partial provisioning resumes without duplicating successful subscriptions.
- Rate limits remain retryable and preserve already-created subscriptions.
- Deprovisioning removed sources is idempotent.

### Targeted hydration

Add regressions for:

- Parent item webhook to parent item hydration.
- Classic subitem webhook where fetching the item returns the hidden subitems board.
- Correct authorization against the selected parent board.
- Multi-level item webhook where all hierarchy levels share the parent board ID.
- Deleted or missing items.
- Payloads with only board IDs and no item IDs.

This is important because the current board-ID equality check can reject a classic subitem whose
API `item.board` is the hidden helper board.

## Phase 3: Correct the provider model

Refactor `packages/shared/src/integrations/providers/monday.ts` around explicit concepts:

- Selectable board
- Classic helper board
- Multi-level board
- Parent board identity
- Item hierarchy
- Webhook-capable board

Implement:

1. A single canonical board-classification function used by:
   - Resource discovery
   - Selection validation
   - Webhook provisioning
   - Full reconciliation
   - Targeted webhook hydration
2. Pin the Monday API version in the GraphQL client.
3. Use `hierarchy_scope_config: "allItems"` where required for multi-level boards.
4. Use cursor pagination correctly:
   - Record cursor creation and expiry; Monday cursors are valid for 60 minutes.
   - Restart safely when a cursor expires.
   - Preserve the scan high-water mark.
   - Advance `item_since` only after every page completes.
5. Fetch the proper schema for classic subitems instead of assuming parent-board column
   definitions.
6. Canonicalize every record under its selected parent board:
   - `monday_parent_board_id`
   - `monday_item_board_id`
   - `monday_parent_item_id`
   - Hierarchy depth and type
7. Keep raw ingested events immutable.

## Phase 4: Make activation and selection changes immediately useful

Currently, saving selections provisions webhooks but does not guarantee an immediate full import.

Change activation and selection flows so they:

1. Calculate added, retained, and removed resources.
2. Persist selections transactionally.
3. Enqueue a full backfill immediately for newly added boards.
4. Restart affected board cursors from the beginning for explicit recovery backfills.
5. Preserve cursors for unchanged boards.
6. Reconcile webhooks independently from the backfill:
   - Webhook degradation must not block historical import.
   - Backfill failure must not undo saved selections.
7. Return a useful state such as:
   - `sync_queued`
   - `webhooks_active`
   - `webhooks_degraded`
8. Show “Initial sync queued/in progress” in the UI instead of appearing fully ready before items
   exist.

Relevant seams include the team activation route, legacy selection route, manual sync route,
integration scope, and integration worker.

## Phase 5: Isolate failures per board

A single selected source should never prevent later sources from syncing.

Update Monday backfill and incremental reconciliation to:

- Catch and record failures per board or document.
- Continue with remaining selected resources.
- Return structured partial failures.
- Mark the integration successful-with-degradation when some sources succeeded.
- Raise attention only for affected sources.
- Retry rate-limited work at the correct reset time.
- Preserve resumable pagination state.
- Never mark a failed resource as fully synchronized.

Add worker tests proving a failing helper or inaccessible board cannot prevent another selected
parent board from importing its items.

## Phase 6: Repair existing affected accounts

Create an idempotent, team-scoped repair command with dry-run mode.

It should:

1. Rediscover Monday resources.
2. Identify invalid helper-board shares and selections.
3. Print counts and IDs, not content or credentials.
4. Revoke or remove invalid helper selections.
5. Mark impossible helper-board webhook subscriptions deleted or unsupported.
6. Preserve historical raw events.
7. Canonically associate existing subitem evidence with its parent board where possible.
8. Clear stale helper-board sync cursors.
9. Enqueue full parent-board backfills.
10. Resolve webhook-degraded attention only after valid subscriptions reconcile.

Run dry-run first for Tecci, inspect the report, then apply and verify.

## Phase 7: Prove agent retrieval end to end

Because the user-facing failure is an incorrect agent answer, connector tests alone are
insufficient.

Add deterministic eval fixtures that flow through:

1. Monday provider normalization
2. Event writer
3. Extraction and embedding
4. Team-scoped retrieval
5. Agent answer synthesis

Scenarios:

- “What open items are on Ext-Faba?”
- “Show Faba items, including subitems.”
- “Which parent item does this subitem belong to?”
- “What changed recently on this board?”
- Same item names across two boards
- Old closed subitems alongside current open parent items
- No results on an unselected board
- Cross-team isolation

Success requires:

- Actual board items are returned.
- Helper boards are never described as independent user boards.
- Status and parent relationships are accurate.
- Citations point to the correct evidence.
- The agent does not conclude “no open items” when matching current items exist.

Run `pnpm test:eval`; run reconciliation evals if metadata or source associations change.

## Phase 8: UI, observability, and supportability

### UI

Show per connection or source:

- Initial sync queued, running, or completed
- Last successful reconciliation
- Number of boards and items imported
- Webhook coverage
- Partial failures with an actionable retry
- Provider quota cooldown
- Reconnect requirement

Do not expose raw GraphQL errors directly when a clearer explanation exists.

### Metrics and audits

Add:

- Discovered real boards versus filtered helper boards
- Selected parent boards
- Parent items and subitems imported per run
- Pagination pages and cursor restarts
- Webhook active and desired counts
- Known unsupported webhook targets
- Partial failures by board
- Backfill queue latency and duration
- Retrieval coverage: selected boards with zero item events

Extend `pnpm canary:integrations` with an opt-in Monday test account and board that:

- Discovers the test parent board
- Confirms helper boards are hidden
- Creates and removes a webhook
- Creates or updates a parent item and subitem
- Waits for ingestion
- Verifies cited retrieval
- Cleans up defensively

## Test and validation matrix

Run targeted suites during development:

- Monday provider unit tests
- Integration selection and activation route tests
- Integration worker tests
- Monday webhook route and delivery tests
- Event-writer and embedding tests
- Agent retrieval and eval tests
- Repair-command dry-run tests
- Component tests for source picker and sync status
- Focused Playwright connection workflow using a fake Monday HTTP server

Before handoff:

```text
pnpm validate
pnpm run doctor
pnpm test
pnpm test:eval
pnpm test:reconciliation-eval
pnpm e2e
```

Also run `pnpm test:dist-imports` if shared exports or compiled loader boundaries change. React
Doctor must report 100.

## Rollout

1. Deploy code with repair tooling disabled by default.
2. Run the live Monday canary against a dedicated test board.
3. Dry-run the production repair and review counts.
4. Apply repair to Tecci first.
5. Enqueue a full backfill.
6. Verify database counts, webhook coverage, and the exact agent questions from the screenshots.
7. Expand repair to other affected Monday integrations.
8. Monitor for at least one full reconciliation window.
9. Update Monday setup documentation, help content, architecture and design facts if applicable,
   and completed TODO state.
10. Run the required release-documentation audit before shipping.

## Rollback strategy

- Keep raw events immutable and never delete source evidence during rollout.
- Make cleanup and backfill commands idempotent.
- Preserve old cursor values in repair audit metadata before replacement.
- Separate selection repair, webhook repair, and backfill so each can be retried independently.
- If the new API version or hierarchy query regresses, disable the new sync path while retaining
  selections and historical evidence.

The testing strategy is behavior-first: provider fixtures establish edge cases, database and
worker tests prove persistence and recovery, E2E proves the admin workflow, and agent evals prove
the customer outcome.
