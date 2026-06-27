# Integration Webhook Transition Plan

## Goal

Move native integrations from eager background polling to a webhook-first,
budget-aware ingestion system. Timeline should treat provider APIs as scarce
shared resources, accept provider events quickly, process them idempotently, and
poll only for backfill, reconciliation, and providers that cannot send useful
webhooks.

The transition must make future connectors cheaper to add. A new provider should
implement a small adapter contract for verification, target resolution,
subscription management, event normalization, and fallback sync. The route,
delivery persistence, dedupe, queueing, budget pauses, status UI, and recovery
logic should be shared.

## Why This Is Needed

The current integration worker registers a 5-minute global tick that fans out
incremental sync to enabled native integrations. GitHub has a slower background
cadence and a rate-limit pause path, but most providers still fit a polling
model. That model has three product problems:

1. Provider quotas are shared by provider account and app, not by Timeline team.
   Multiple Timeline teams connected to the same external account can burn the
   same quota.
2. Expected provider cooldowns surface as red integration failures. Users see a
   broken product even when the correct behavior is "paused until the provider
   budget resets."
3. Every new provider needs custom webhook routing, retry behavior, and error
   interpretation unless the shared platform owns those concerns.

monday.com documents daily, minute, complexity, concurrency, IP, and resource
protection limits. Rate-limit responses include `retry_in_seconds`, and
responses expose `RateLimit` headers that can be used to throttle before the
limit is exhausted. GitHub recommends webhook subscriptions over polling,
serial API queues to avoid secondary rate limits, `Retry-After` and
`x-ratelimit-reset` handling, and conditional `GET` requests with `ETag` or
`Last-Modified`.

Sources:

- [monday.com rate limits](https://developer.monday.com/api-reference/docs/rate-limits)
- [monday.com webhooks](https://developer.monday.com/api-reference/reference/webhooks)
- [GitHub REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [GitHub App best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)

## Current State

Native integration ingestion already has useful foundations:

| Area | Current behavior |
| --- | --- |
| Provider adapter | `IntegrationProvider` owns OAuth, resource listing, backfill, incremental sync, and optional `handleWebhook`. |
| Event writer | `writeIntegrationEvents` writes immutable `source='integration'` events with provider dedupe keys and object mapping hints. |
| Cursors | `integration_sync_state` stores per-resource cursor data and last status/error. |
| Worker | `integration-sync` runs backfill or incremental sync and guards each integration with a Postgres advisory lock. |
| Webhook handling | Linear writes events directly and enqueues sync; Drive uses webhooks as wake-up signals; Sentry has provider payload normalization but no wired inbound route yet. |
| Generic ingest webhooks | Team-managed evidence-only webhooks exist separately and should remain separate from native authoritative integrations. |

The missing piece is a shared native webhook gateway. Existing webhook routes
prove the patterns, but each route still owns too much provider orchestration.

### Existing Provider Coverage

This transition covers every implemented native provider in the registry:

| Provider | Current ingestion shape | Transition path |
| --- | --- | --- |
| Google Drive | OAuth provider plus `/api/webhooks/google-drive` channel wake-ups that enqueue incremental sync. | Move channel verification, subscription renewal, delivery persistence, and enqueue behavior behind the shared gateway. Keep Drive as wake-up-first because the webhook does not carry complete file state. |
| Linear | OAuth provider plus `/api/webhooks/linear`; route verifies signatures, writes direct events, and enqueues sync. | Use Linear as the first gateway migration because it already matches the desired shape. Preserve direct event writes and move target resolution, delivery storage, and enqueueing into shared code. |
| GitHub | OAuth-backed polling with a slower background cadence and GitHub-specific rate-limit pause handling. | Move to GitHub App webhooks for normal freshness, conditional REST reconciliation for missed state, and provider-budget rows for primary and secondary limits. |
| Monday.com | OAuth-backed board, item, update, subitem, and WorkDocs polling through GraphQL. | Add per-board webhook provisioning for high-change board surfaces, targeted board/item hydration, WorkDocs slow reconciliation, and monday account/app budget rows. |
| Slack | Native workspace ingestion is poller-backed; the separate `/api/slack/events` route handles conversational Slack capture. | Keep the existing Slack Events route intact, then decide whether native Slack workspace ingestion should consume Slack event subscriptions through the gateway or remain reconciliation-first for selected channels. |
| Sentry | OAuth/API provider with issue/release polling and provider payload normalization; no wired inbound native webhook route yet. | Add a Sentry gateway route for issue alert/release payloads, reuse existing normalization, and keep daily issue/release reconciliation as the fallback. |

## Target Architecture

Native integration ingestion should move to this shape:

```text
Provider webhook
      |
      v
/api/webhooks/:provider
      |
      v
Webhook gateway
  - rate-limit ingress by IP/provider
  - verify signature or challenge
  - persist delivery envelope
  - resolve matching Timeline integrations
  - acknowledge provider quickly
      |
      v
webhook-delivery worker
  - normalize events
  - enqueue targeted sync tasks
  - update provider budget ledger
  - record audit/status
      |
      +--> writeIntegrationEvents()
      |
      +--> targeted integration sync
              - backfill
              - reconcile
              - hydrate one resource/surface
```

Polling remains, but its job changes:

- Full backfill after initial connection or source activation.
- Slow reconciliation for missed, dropped, or unsupported webhook surfaces.
- Provider-specific catch-up when a webhook only says "something changed."
- Manual retry after an admin fixes credentials or permissions.

The 5-minute global tick should no longer fan out full incremental sync to
every enabled provider. It should become a scheduler that asks the provider
budget ledger and provider policies what work is due.

## Shared Concepts

### Delivery

A delivery is one inbound provider request after basic HTTP parsing. It is not
necessarily a Timeline event. One delivery may produce zero events, one event,
many events, or one targeted sync task.

Store every accepted native delivery in a new table, for example
`integration_webhook_deliveries`:

| Column | Purpose |
| --- | --- |
| `id` | Timeline UUID. |
| `provider` | Native provider id. |
| `external_delivery_id` | Provider delivery id when available, such as GitHub `X-GitHub-Delivery`. |
| `external_account_id` | Provider account/org/install id used for tenant routing. |
| `resource_kind` | Provider resource kind, such as `github.repo` or `monday.board`. |
| `external_resource_id` | Provider resource id, such as repo full name or board id. |
| `event_type` | Provider event name, such as `pull_request` or `change_column_value`. |
| `action` | Provider action when present. |
| `received_at` | Timeline receipt time. |
| `payload` | Raw provider JSON or header envelope, stored as untrusted data. |
| `headers` | Redacted/safe provider headers needed for debugging. |
| `dedup_key` | Stable provider scoped key. Unique per provider. |
| `status` | `accepted`, `processing`, `processed`, `ignored`, `failed`, `dead_lettered`. |
| `last_error` | Last processing error, if any. |

The route should dedupe before enqueueing work. Duplicate provider redeliveries
should return success and may re-enqueue processing for the existing delivery if
the prior processing did not finish.

### Target

A target is a Timeline integration that should receive this delivery. Target
resolution is shared, but it uses provider adapter routing keys.

Examples:

- GitHub delivery for `Tecci-Oy/tecci-commerce` targets enabled GitHub
  integrations whose selected resources include that repo, or an org selection
  that covers `Tecci-Oy`.
- Monday delivery for board `123` targets enabled Monday integrations whose
  selected resources include `monday.board:123`.
- Linear delivery for organization `org_abc` and team `team_xyz` targets enabled
  Linear integrations for that org with `linear.team:team_xyz` selected.

### Sync Task

A sync task is provider work after a delivery. It should be narrower than the
current integration-wide incremental job.

Extend `IntegrationSyncJobData` from:

```ts
{ kind: 'incremental'; integrationId: string; teamId: string }
```

to support targeted work:

```ts
type IntegrationSyncJobData =
  | { kind: 'backfill'; integrationId: string; teamId: string; triggeredBy?: string }
  | { kind: 'incremental'; integrationId: string; teamId: string; triggeredBy?: string }
  | {
      kind: 'targeted';
      integrationId: string;
      teamId: string;
      triggeredBy: 'webhook' | 'reconcile' | 'manual';
      resourceType: string;
      externalId: string;
      surface?: string;
      reason?: string;
    };
```

Providers that cannot hydrate a single resource can route `targeted` work back
to their existing incremental implementation at first. Providers that can
hydrate narrowly should avoid account-wide calls.

### Budget

A budget is the current known provider quota state. It is keyed by the real
provider quota boundary, not by Timeline team.

Suggested key:

```text
provider + app_client_id + external_account_id + quota_scope
```

Examples:

- `monday + MONDAY_CLIENT_ID + account_id + daily`
- `monday + MONDAY_CLIENT_ID + account_id + minute`
- `github + github_app_id + installation_id + core`
- `github + github_app_id + user_id + secondary`

Store budget state in a new table, for example `integration_provider_budgets`:

| Column | Purpose |
| --- | --- |
| `provider` | Native provider id. |
| `app_key` | OAuth client id, GitHub app id, or deployment-stable app identifier. |
| `external_account_id` | Provider quota owner. |
| `scope` | `daily`, `minute`, `complexity`, `concurrency`, `core`, `secondary`, etc. |
| `remaining` | Last observed remaining quota if known. |
| `limit` | Last observed limit if known. |
| `reset_at` | Reset time from provider headers/body if known. |
| `paused_until` | Hard pause time. No scheduled sync before this. |
| `reason` | Machine reason, such as `daily_limit_exceeded`. |
| `last_observed_at` | Last response that updated this row. |

Every outbound provider request should update this table when headers or error
bodies expose quota state. The scheduler should consult this table before
enqueueing provider work.

## Adapter Contract

Add a native webhook adapter next to `IntegrationProvider`, or extend
`IntegrationProvider` with a `webhooks` property.

```ts
interface NativeWebhookAdapter {
  provider: NativeProviderId;

  verify(input: WebhookVerifyInput): Promise<WebhookVerifyResult>;

  resolveTargets(input: WebhookTargetInput): Promise<WebhookTargetHint[]>;

  normalize(input: WebhookNormalizeInput): Promise<WebhookNormalizeResult>;

  provision?(input: WebhookProvisionInput): Promise<WebhookSubscription[]>;

  deprovision?(input: WebhookDeprovisionInput): Promise<void>;

  reconcilePolicy(input: ReconcilePolicyInput): ReconcilePolicy;
}
```

### Verification

Verification should be the only step that knows provider signature mechanics:

| Provider | Verification |
| --- | --- |
| GitHub | Validate `X-Hub-Signature-256` using the GitHub App webhook secret. Use `X-GitHub-Delivery` as delivery id. |
| Monday.com | Respond to URL challenge with the same `challenge`; validate event payload shape and any supported signing or app-level secret mechanism. |
| Linear | Validate `Linear-Signature` over the raw body. |
| Google Drive | Validate `x-goog-channel-token` as `integration_id.HMAC(secret, integration_id)`. |
| Slack | Validate Slack signing secret over timestamped raw body. |
| Sentry | Validate provider secret/signature where configured. |

The generic route owns IP rate limiting, JSON parsing after verification when
safe, delivery persistence, and response status policy.

### Target Resolution

Provider adapters return routing hints. The gateway uses shared DB code to match
them against enabled integrations and selections.

```ts
interface WebhookTargetHint {
  externalAccountId?: string;
  resourceKind?: string;
  externalResourceId?: string;
  providerConnectionId?: string;
  integrationId?: string;
}
```

Provider adapters should not write Timeline events while resolving targets.
Target resolution must be cheap and deterministic.

### Normalization

Normalization turns a verified delivery and a matched integration into events
and optional targeted sync tasks.

```ts
interface WebhookNormalizeResult {
  events: IntegrationEvent[];
  syncTasks: TargetedSyncTask[];
  ignoredReason?: string;
}
```

Use direct events when the provider payload is authoritative enough. Use sync
tasks when the payload is only a wake-up signal or when fresh state is needed to
build a complete event.

### Provisioning

Provisioning is optional because some providers use app-level webhooks and some
use manual provider setup.

| Provider | Provisioning model |
| --- | --- |
| GitHub | App-level webhook configured once per GitHub App. Users do not create per-repo hooks. |
| Monday.com | Per selected board and event type through `create_webhook`; deprovision when the board is unshared or integration is disconnected. |
| Google Drive | Per integration/resource watch channel with expiration and renewal. |
| Linear | Usually manual org webhook today; can later become app-managed if provider support allows. |
| Slack | App event subscriptions configured at app level. |
| Sentry | Organization/project webhook configuration depending on provider app model. |

Provisioned subscriptions should be stored in
`integration_webhook_subscriptions`:

| Column | Purpose |
| --- | --- |
| `id` | Timeline UUID. |
| `integration_id` | Owning integration when subscription is per integration. |
| `provider_connection_id` | Owning connection when subscription is broader. |
| `provider` | Native provider id. |
| `external_subscription_id` | Provider webhook id/channel id. |
| `resource_kind` | Selected resource kind. |
| `external_resource_id` | Provider resource id. |
| `event_type` | Provider event type. |
| `status` | `active`, `verifying`, `failed`, `disabled`, `expired`. |
| `expires_at` | For providers such as Drive. |
| `last_verified_at` | Last successful setup or renewal. |
| `last_error` | Last provisioning error. |

## Provider Plans

### GitHub

Move GitHub from repo polling to GitHub App webhook events plus slow
reconciliation.

Webhook events to subscribe to:

| Event | Timeline handling |
| --- | --- |
| `push` | Write commit events from payload when sufficient; enqueue targeted commit reconciliation for large pushes. |
| `pull_request` | Write PR event directly; enqueue PR hydration only when body/review metadata is missing. |
| `pull_request_review` | Write review event directly. |
| `issues` | Write issue event directly. |
| `release` | Write release event directly. |
| `workflow_run` | Write workflow run status event directly. |
| `installation_repositories` | Refresh org/repo resource caches and selected org coverage. |

Implementation notes:

- Prefer GitHub App installation identity for repository access. It has better
  webhook semantics and installation-aware quotas than OAuth-only polling.
- Store `X-GitHub-Delivery` as the delivery id.
- Store `ETag` and `Last-Modified` on REST fallback surfaces. Authorized
  `304 Not Modified` responses do not count against primary rate limits.
- Keep a slow reconciliation job, for example every 6-24 hours per active
  installation, to catch missed deliveries and reconcile selected org scopes.
- Treat GitHub primary and secondary limits as provider budget rows. Obey
  `Retry-After`; when `x-ratelimit-remaining` is `0`, pause until
  `x-ratelimit-reset`; otherwise use exponential backoff.

### Monday.com

Move Monday.com from frequent board polling to per-board webhook wake-ups plus
rate-limit-aware hydration.

Webhook subscriptions to create for selected boards:

| Event | Timeline handling |
| --- | --- |
| `create_item` | Enqueue targeted item hydration for the board/item. |
| `change_column_value` | Enqueue targeted item hydration; write lightweight activity event if payload is sufficient. |
| `change_status_column_value` | Enqueue targeted item hydration and map status change. |
| `change_name` | Enqueue targeted item hydration. |
| `create_update` | Hydrate update or write direct update event if payload includes body and author. |
| `edit_update` | Hydrate update and write updated event. |
| `delete_update` | Write deletion/removed activity if payload identifies update. |
| `create_subitem` | Hydrate parent and subitem. |
| `change_subitem_column_value` | Hydrate subitem and parent. |
| `item_archived`, `item_deleted`, `item_restored` | Write lifecycle event; hydrate if needed. |

Implementation notes:

- monday.com verifies webhook URLs by POSTing a `challenge`; the route must
  echo `{ "challenge": "<same value>" }`.
- Add `webhooks:write` or required webhook scope if monday.com requires it for
  app-managed subscription creation.
- Key budget by monday account and Timeline monday app client id. monday.com
  limits are per account and app unless noted otherwise.
- Parse `retry_in_seconds`, `Retry-After`, and `RateLimit` headers from every
  response. Pause before hitting `r=0` when possible.
- Avoid calling WorkDocs backfill on every board incremental. WorkDocs should
  have its own slow doc reconciliation policy unless a doc webhook is available.
- If a board webhook only identifies the board, enqueue a board-limited
  targeted sync, not an account-wide incremental sync.

### Google Drive

Keep Drive webhooks as wake-up signals. The existing handler already validates
the channel token and enqueues incremental sync for the matching integration.

Changes:

- Move route-specific token verification into the shared adapter contract.
- Store channel ids and expirations in `integration_webhook_subscriptions`.
- Add renewal jobs before `expires_at`.
- Route Drive notifications through delivery persistence so redeliveries and
  enqueue failures are visible in the same dashboard as other providers.

### Linear

Linear already has the closest implementation to the target shape: verify
signature, find matching org/team integrations, write direct events, and enqueue
sync.

Changes:

- Move signature verification and team extraction into the adapter.
- Persist deliveries before normalization.
- Replace route-owned target filtering with shared target resolution.
- Keep direct event writes for Issue, Comment, and Project payloads.

### Slack

Slack has two distinct surfaces and the transition should keep them separate.
The existing Slack Events API route is for conversational capture and should not
be collapsed into native workspace ingestion without a separate product
decision. Native Slack workspace ingestion is poller-backed today.

Future native Slack provider event subscriptions should treat event callbacks
as authoritative for messages and reactions when payloads contain enough
content; otherwise enqueue channel/thread targeted sync.

Changes:

- Keep `/api/slack/events` working for conversational capture while the native
  gateway is introduced.
- Add Slack gateway adapter support only for native workspace ingestion events,
  keyed by Slack team and selected channel.
- Route channel, message, thread, reaction, and file callbacks to targeted
  channel/thread sync when payloads are incomplete.
- Keep selected-channel reconciliation so missed Slack events do not create
  holes in timelines.

### Sentry

Sentry has provider payload normalization today, but no wired inbound native
webhook route. Its transition is to route issue alert and release webhooks
through the gateway, then reuse the existing Sentry event normalization path.

Webhook events to handle:

| Event | Timeline handling |
| --- | --- |
| Issue alert triggered | Write alert event directly when issue id, title, actor, and URL are present. |
| Issue resolved/regressed | Write lifecycle event directly and enqueue targeted issue hydration if metadata is missing. |
| Release created/deployed | Write release event directly when payload includes project/release identity. |

Changes:

- Add a Sentry native gateway route with provider secret/signature validation.
- Reuse existing `sentryProvider.handleWebhook()` normalization behind the
  adapter contract.
- Resolve targets by Sentry organization/project selection before writing
  events.
- Keep daily issue/release reconciliation as the fallback for missed alerts,
  missing metadata, and projects without webhook configuration.

## Scheduler and Polling Changes

Replace the current global poller posture with provider policies.

```ts
interface ProviderSyncPolicy {
  provider: NativeProviderId;
  defaultBackfillWindow: Duration;
  reconciliationInterval: Duration;
  staleResourceInterval: Duration;
  supportsWebhooks: boolean;
  supportsTargetedSync: boolean;
  maxConcurrentRequestsPerBudgetKey: number;
}
```

Recommended starting policies:

| Provider | Webhook-first | Reconciliation |
| --- | --- | --- |
| GitHub | Yes | 6-24 hours per installation, conditional requests. |
| Monday.com | Yes for boards | 1-4 hours for active boards, daily for WorkDocs. |
| Google Drive | Wake-up only | Existing changes cursor, channel renewal. |
| Linear | Yes | 6-24 hours per org/team. |
| Slack | Mixed | Channel/thread reconciliation based on selected channels. |
| Sentry | Yes | Daily issue/release reconciliation. |

The scheduler should:

1. Load enabled integrations and selected resources.
2. Group work by provider budget key.
3. Skip groups with active `paused_until`.
4. Enqueue due reconciliation tasks with stable job ids.
5. Prefer targeted tasks over integration-wide tasks.
6. Record skipped work as normal audit/status, not as user-facing failure.

## User Experience

Integration status should stop treating expected cooldowns as generic failures.

Statuses:

| Status | User-facing meaning |
| --- | --- |
| `healthy` | Webhooks and reconciliation are current. |
| `syncing` | Backfill or targeted sync is running. |
| `paused_rate_limit` | Provider quota is cooling down; no user action needed. |
| `partial` | Some selected resources failed, but others are syncing. |
| `needs_reconnect` | Token or permission is invalid; user/admin action needed. |
| `needs_new_owner` | Connection owner left team; admin must choose a new owner. |
| `webhook_degraded` | Webhook subscription failed or expired; reconciliation still runs if budget allows. |
| `provider_degraded` | Provider is returning retryable failures outside known quota semantics. |

UI rules:

- Disable "Retry sync" while a provider budget pause is active. Show "Sync
  resumes at <time>" instead.
- Keep "Sync now" for manual reconciliation only when budget allows.
- Show provider/account scoped cooldowns clearly when multiple Timeline teams
  share a provider account quota.
- Make partial failures resource-specific, for example "2 of 18 GitHub repos
  need permission attention."
- Do not show raw provider JSON as the main message. Keep raw details in the
  disclosure panel for debugging.

## Security and Isolation

The webhook gateway must preserve existing Team isolation rules.

- Verify signatures before trusting payload routing keys.
- Treat every payload field as untrusted external content.
- Match provider account/resource ids to enabled integrations and selections
  before writing events.
- Do not let a webhook for an unselected repo, board, channel, project, or
  folder create Timeline events.
- Preserve current `withTeam` boundaries for document harvest and derived
  object writes.
- Redact sensitive headers before storing delivery metadata.
- Return provider-friendly `2xx` for handled invalid/no-target cases when a
  provider would otherwise retry indefinitely, but report handled auth failures
  internally.

## Implementation Phases

### Phase 1: Shared Gateway Skeleton and Linear Migration

Deliverables:

1. Add `integration_webhook_deliveries`.
2. Add `integration_webhook_subscriptions`.
3. Add `integration_provider_budgets`.
4. Add adapter types under `packages/shared/src/integrations`.
5. Add a generic `/api/webhooks/[provider]` route or shared route helper.
6. Add a `webhook-delivery` queue and worker.
7. Keep existing provider-specific routes as compatibility wrappers that call
   the gateway.
8. Move Linear through the gateway first because it already verifies signed
   webhooks, writes direct events, and enqueues sync.

Exit criteria:

- Linear webhook route can be expressed through the gateway without behavior
  regression.
- Duplicate deliveries are idempotent.
- Delivery processing can recover when queue enqueue fails after persistence.

### Phase 2: Google Drive Gateway Migration

Deliverables:

1. Move Google Drive channel-token verification into the adapter contract.
2. Persist Drive webhook deliveries before enqueueing sync.
3. Store Drive channel ids and expirations in
   `integration_webhook_subscriptions`.
4. Add renewal jobs before channel expiration.
5. Preserve the existing Drive changes-cursor incremental sync as the
   authoritative hydration path.

Exit criteria:

- Drive wake-ups flow through the same delivery table and status model as
  Linear.
- Expired Drive channels are renewed or marked `webhook_degraded`.
- Duplicate Drive notifications collapse to bounded sync work.

### Phase 3: Generic Provider Rate Limits

Deliverables:

1. Replace `github_rate_limited`-only pause handling with
   `ProviderRateLimitError`.
2. Parse GitHub `Retry-After`, `x-ratelimit-remaining`, and
   `x-ratelimit-reset`.
3. Parse monday.com `retry_in_seconds`, `Retry-After`, and `RateLimit`.
4. Update the worker so provider cooldowns do not throw into BullMQ retry
   pressure.
5. Update UI copy and button state for paused budgets.

Exit criteria:

- Monday `DAILY_LIMIT_EXCEEDED` pauses until the provider retry time.
- GitHub primary and secondary rate limits use the same pause path.
- No user can click a retry button that knowingly burns a paused budget.

### Phase 4: Targeted Sync Jobs

Deliverables:

1. Extend `IntegrationSyncJobData` with `targeted`.
2. Add provider methods for targeted hydration where possible.
3. Add stable job ids for targeted sync to collapse duplicate webhook bursts.
4. Add per-resource/surface cursor status in `integration_sync_state`.
5. Keep integration-wide incremental sync only as fallback.

Exit criteria:

- A GitHub PR webhook can hydrate only that repo/PR surface when needed.
- A Monday board webhook can sync only the affected board/item when possible.
- Drive, Linear, Slack, and Sentry can either implement targeted sync or
  explicitly route targeted tasks to bounded incremental fallback.
- Duplicate bursts do not enqueue unbounded provider calls.

### Phase 5: GitHub Webhook-First

Deliverables:

1. Configure GitHub App webhook URL and secret.
2. Add GitHub webhook adapter.
3. Subscribe to the minimum required GitHub events.
4. Write direct events for PRs, reviews, issues, releases, workflow runs, and
   commits when payloads are sufficient.
5. Add conditional request storage for reconciliation fallback.
6. Reduce GitHub background polling to slow reconciliation.

Exit criteria:

- Normal PR/issue/release/workflow activity appears from webhooks without
  waiting for hourly polling.
- Reconciliation catches missed deliveries without exhausting quota.
- Existing selected repo/org semantics still hold.

### Phase 6: Monday Webhook-First

Deliverables:

1. Add Monday webhook adapter with challenge handling.
2. Add subscription provisioning for selected boards and selected board event
   types.
3. Store monday webhook ids in `integration_webhook_subscriptions`.
4. Add deprovisioning when a board is unshared or an integration disconnects.
5. Add targeted board/item hydration.
6. Move WorkDocs to its own slower reconciliation path.

Exit criteria:

- Selected board changes trigger targeted sync without 5-minute polling.
- Monday daily and minute budgets are visible and honored.
- Removing a selected board removes or disables its monday webhook
  subscriptions.

### Phase 7: Slack Native Gateway Decision and Migration

Deliverables:

1. Keep the existing conversational Slack Events API route separate.
2. Decide whether native Slack workspace ingestion should use Slack event
   subscriptions, selected-channel reconciliation, or both.
3. If event subscriptions are enabled, route them through the gateway and key
   targets by Slack team/channel selections.
4. Add targeted channel/thread sync for incomplete message, reaction, and file
   payloads.

Exit criteria:

- Slack's conversational capture and native workspace ingestion remain
  separate surfaces.
- Selected Slack channels either receive gateway events or have an explicit
  reconciliation-first policy documented in `ProviderSyncPolicy`.
- Slack provider health uses the same status taxonomy as the other native
  providers.

### Phase 8: Sentry Native Webhooks

Deliverables:

1. Add the Sentry native webhook route through the gateway.
2. Verify provider secret/signature before target resolution.
3. Reuse existing Sentry webhook normalization behind the adapter.
4. Resolve targets by organization/project selection.
5. Keep daily issue/release reconciliation for missed alerts and incomplete
   payloads.

Exit criteria:

- Sentry issue alert, issue lifecycle, and release payloads can write direct
  events through the gateway.
- Sentry reconciliation catches missed or incomplete webhook deliveries.
- Sentry appears in the same delivery, budget, and health dashboards as the
  other implemented native providers.

### Phase 9: Provider Kit and Old Route Removal

Deliverables:

1. Add provider contract tests that every new native provider must pass.
2. Add a provider template with documented adapter methods.
3. Update setup docs to distinguish app-level, manual, and provisioned
   webhooks.
4. Remove old provider-specific route logic after parity tests pass.

Exit criteria:

- Every implemented native provider uses the same delivery table, status
  model, and budget path.
- New providers can be added without creating a new bespoke route pattern.

## Testing Strategy

Shared tests:

- Gateway rejects invalid signatures before parsing trusted routing fields.
- Challenge requests return the provider-required response without storing an
  event.
- Duplicate deliveries dedupe by provider delivery id or provider scoped body
  hash.
- Accepted deliveries are durable before async processing.
- Delivery worker can process direct events, targeted sync tasks, ignored
  deliveries, and failures.
- Provider budget rows pause scheduler enqueueing.
- Provider cooldown errors do not create `sync_error` attention.
- Team/resource selection filters prevent cross-team writes.

Provider contract tests:

- `verify()` accepts valid fixture signatures and rejects bad ones.
- `resolveTargets()` extracts the correct account/resource keys.
- `normalize()` produces stable `IntegrationEvent.dedupKey` values.
- `provision()` creates expected subscription records or is explicitly absent.
- `deprovision()` is idempotent.
- `reconcilePolicy()` returns a bounded polling plan.

End-to-end tests:

- GitHub PR webhook writes one cited raw event and maps the PR object.
- Monday board update webhook enqueues one targeted board/item sync.
- Rate-limited Monday response pauses future Monday work for the same account
  and app.
- Two Timeline teams connected to the same Monday account share a provider
  budget pause but keep events team-scoped.
- Manual retry is disabled during a provider budget pause and enabled after the
  pause expires.

Required gates for implementation changes remain `pnpm validate`,
`pnpm run doctor`, and targeted tests. Changes that touch integration tools,
retrieval, visibility filters, MCP tool handling, or answer synthesis should
also run `pnpm test:eval`.

## Migration Strategy

Use a strangler pattern: new gateway path first, existing routes preserved until
each provider is moved.

1. Add schema and gateway with no provider traffic.
2. Route Linear through the gateway because it already writes direct events and
   enqueues sync.
3. Route Drive through the gateway because it is a pure wake-up signal.
4. Add generic provider budget handling and convert GitHub rate-limit handling.
5. Add Monday rate-limit parsing before enabling Monday webhooks.
6. Add targeted sync jobs and bounded fallback behavior for every provider.
7. Enable GitHub App webhooks and reduce GitHub polling.
8. Enable Monday board webhook provisioning and reduce Monday polling.
9. Decide and migrate the native Slack workspace surface while preserving the
   existing Slack Events conversational route.
10. Add Sentry native webhooks and reuse existing Sentry normalization.
11. Remove old provider-specific route logic after parity tests pass.
12. Change the global integration tick into a budget-aware reconciliation
    scheduler.

During migration, keep backfill and manual sync working. Webhooks should improve
freshness and quota use, not become a new single point of failure.

## Operational Playbook

When a provider reports a quota limit:

1. Parse provider retry metadata into `ProviderRateLimitError`.
2. Upsert the provider budget row with `paused_until`.
3. Mark affected integration status as `paused_rate_limit`.
4. Do not enqueue new work for that budget key.
5. Do not create user-action attention unless credentials or permissions are
   actually invalid.
6. Resume from cursor after the pause.

When webhook delivery fails:

1. Persist the delivery if verification succeeded.
2. Mark processing failure on the delivery row.
3. Retry with bounded worker attempts.
4. If repeated failures continue, move to dead letter and surface
   `webhook_degraded`.
5. Keep reconciliation polling available as the fallback.

When subscription provisioning fails:

1. Store the failed subscription row with `last_error`.
2. Show `webhook_degraded` for that resource.
3. Do not fail the whole integration if backfill/reconciliation still works.
4. Retry provisioning after credential, permission, or URL configuration
   changes.

## Documentation Updates Needed During Implementation

Update these docs as each phase lands:

- `README.md`: documentation list and current integration behavior.
- `docs/index.html`: link to the transition plan and any new setup docs.
- `docs/integration-ingest-plan.md`: keep provider waves and shared adapter kit
  aligned with the webhook gateway.
- `docs/setup/integrations.html`: provider setup steps for GitHub App webhooks,
  Monday webhook scopes/challenges, Drive renewal, and status meanings.
- `AGENTS.md`: update required workflows if validation, scripts, or worker
  queues change.
- `TEST_TODO.md`: update coverage rows for webhook gateway, provider budgets,
  and targeted sync.

## Non-Goals

- Do not remove backfill. Webhooks do not provide historical state.
- Do not make generic ingest webhooks authoritative. They remain evidence-only.
- Do not rely on webhooks without reconciliation. Providers can drop, delay, or
  redeliver events.
- Do not expose provider payloads directly to agents without external-content
  fencing.
- Do not build provider-specific status UI for every connector. The UI consumes
  shared status categories.

## Open Decisions

1. Whether GitHub should be migrated from OAuth-app style user tokens to
   full GitHub App installation tokens before webhook-first ingestion launches.
2. Whether Monday webhook provisioning needs a new OAuth scope beyond the
   current read scopes, and how that scope upgrade is presented to existing
   connections.
3. Whether provider budget rows should live in Postgres only or use Redis for
   short-lived fast checks with Postgres as the durable ledger.
4. How aggressively to coalesce webhook bursts, especially for Slack channels,
   GitHub pushes, and Monday boards with automation-heavy workflows.
5. Whether delivery payload retention should be indefinite like raw events or
   shorter-lived operational data after normalized events are written.

## Success Criteria

The transition is complete when:

- GitHub and Monday no longer rely on frequent global polling for normal
  freshness.
- Known provider quota limits pause work automatically and show as cooldowns,
  not product failures.
- Every implemented native provider uses the same delivery persistence, budget
  ledger, target resolution, and status taxonomy.
- New provider work starts from a documented adapter template and contract test
  harness.
- A missed webhook can be recovered by reconciliation without duplicate raw
  events.
- Users see clear resource-level health and know when action is required.
