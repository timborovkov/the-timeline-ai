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

## Review Findings Addressed

This plan was tightened around five findings from review:

1. "Webhook-first" cannot mean "webhook-only." Every provider still needs
   reconciliation, because providers can drop, delay, redact, or redeliver
   events.
2. The universal layer must be a connector kit with explicit capability flags,
   not a fantasy route that makes every provider identical. Verification,
   target hints, normalization, provisioning, budgets, delivery storage,
   worker retries, status taxonomy, tests, and canaries are shared; provider
   signatures, resource models, and hydration depth stay provider-specific.
3. Cutover must be gated per existing integration. GitHub, Monday.com, Sentry,
   Linear, Drive, and Slack each need a clear posture, production config gate,
   fallback path, and rollback behavior.
4. Provider quotas are product state, not just worker errors. Cooldowns,
   degraded webhooks, reconnect requirements, and partial resource failures
   must appear as calm status states in the integrations UI and job recovery
   surfaces.
5. "Done" requires live-provider readiness. A branch can ship code paths behind
   config, but production webhook-first cutover is not complete until the
   live canary proves required app credentials and webhook secrets are present.

Those findings translate into hard plan corrections:

| Finding | Plan correction |
| --- | --- |
| Webhooks are not perfectly reliable. | Every webhook-first provider keeps a declared reconciliation cadence, replayable delivery storage, duplicate protection, and manual backfill path. |
| Connectors are not identical. | The common product is a provider kit plus policy contract, not a lowest-common-denominator route. Provider signatures, resource ids, payload shapes, and hydration depth stay adapter-owned. |
| Existing integrations need different cutovers. | GitHub, Monday.com, Sentry, Linear, Drive, and Slack each have their own posture, fallback, production gate, and rollback rule. |
| Quotas affect users. | Provider budget rows are part of product state. UI and job recovery read cooldown/degraded/reconnect state instead of treating expected limits as red failures. |
| Production readiness needs proof. | A provider is not considered cut over until deterministic tests pass and the live canary reports the required provider credentials/webhook secrets as `OK`. |

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
- [Sentry integration platform webhooks](https://docs.sentry.io/organization/integrations/integration-platform/webhooks/)

## Current State

Native integration ingestion already has useful foundations:

| Area | Current behavior |
| --- | --- |
| Provider adapter | `IntegrationProvider` owns OAuth, resource listing, backfill, incremental sync, and optional `handleWebhook` normalization with targeted sync hints. |
| Event writer | `writeIntegrationEvents` writes immutable `source='integration'` events with provider dedupe keys and object mapping hints. |
| Cursors | `integration_sync_state` stores per-resource cursor data and last status/error. |
| Worker | `integration-sync` runs backfill, provider-policy reconciliation, or targeted resource sync and guards each integration with a Postgres advisory lock. `webhook-delivery` processes persisted native webhook deliveries per matched target. |
| Webhook handling | Linear persists signed deliveries and lets `webhook-delivery` write direct events plus enqueue catch-up sync; Drive persists channel wake-up deliveries through the same worker; GitHub persists signed repo/org deliveries for selected sources and enqueues repo-limited sync; Monday.com persists token-protected board deliveries, challenge verification, lightweight events, and item-level sync when payloads include item ids; Sentry persists signed issue-alert, issue lifecycle, and release deliveries, writes direct events when payloads are complete, and enqueues project-limited sync when payload routing is known. |
| Generic ingest webhooks | Team-managed evidence-only webhooks exist separately and should remain separate from native authoritative integrations. |

The missing piece is finishing the shared native webhook gateway. Existing
webhook routes prove the patterns, and provider sync posture now lives in the
shared `PROVIDER_SYNC_POLICIES` contract so new providers must declare cadence,
budget scopes, targeted-sync support, provisioning model, and matching provider
methods before the worker will use them. Each route still owns too much provider
orchestration until the old provider-specific wrappers are fully migrated.

The architectural line is now: provider-specific routes may remain as thin
compatibility wrappers during migration, but they must delegate durable
delivery, target rows, worker dispatch, budget pauses, and status semantics to
shared integration code. Any provider that cannot do that yet is considered
partially migrated, even if its webhook endpoint exists.

### Existing Provider Coverage

This transition covers every implemented native provider in the registry:

| Provider | Current ingestion shape | Transition path |
| --- | --- | --- |
| Google Drive | OAuth provider plus `/api/webhooks/google-drive` channel wake-ups that persist delivery targets and enqueue `webhook-delivery`. | Keep Drive as wake-up-first because the webhook does not carry complete file state; move subscription renewal behind shared gateway management next. |
| Linear | OAuth provider plus `/api/webhooks/linear`; route verifies signatures, persists delivery targets, and enqueues `webhook-delivery`. | Use Linear as the first gateway migration because it already matches the desired shape. Preserve direct event writes through the shared worker and move target processing, delivery storage, and enqueueing into shared code. |
| GitHub | OAuth-backed resource selection, signed `/api/webhooks/github` delivery ingress for selected repos/orgs, repo-limited webhook sync, GitHub-specific rate-limit pause handling, GitHub App installation-token repo hydration when App ID/private-key config is present, installation-keyed provider-budget pauses for installation-token rate limits, and conditional REST requests for repo reconciliation surfaces. | Move the remaining work to production GitHub App event configuration and then lower background polling to slow reconciliation. |
| Monday.com | OAuth-backed board, item, update, subitem, and WorkDocs ingestion through GraphQL plus token-protected `/api/webhooks/monday` ingress for selected board deliveries, item-level webhook hydration, board webhook provisioning, account-id budget keys for new OAuth connections, reconnect attention for legacy grants missing `account:read`/`webhooks:write`, and daily WorkDocs reconciliation. | Keep legacy grants in reconciliation-first degraded mode until users reconnect, then lower broad board polling as webhook confidence grows. |
| Slack | Native workspace ingestion is reconciliation-first for v1; the separate `/api/slack/events` route handles conversational Slack capture. Slack Web API 429s now create shared `web_api` provider budget pauses. | Keep the existing Slack Events route intact and keep native workspace ingestion on selected-channel reconciliation until there is a separate product reason to subscribe native workspace ingestion to Events API callbacks. |
| Sentry | OAuth/API provider with issue/release polling, signed `/api/webhooks/sentry` issue-alert, issue lifecycle, and release ingress, provider payload normalization, installation-id routing when Sentry includes an installation UUID, and project-limited webhook sync. | Keep daily issue/release reconciliation as the fallback and move Sentry subscription setup into shared gateway management. |

### Current Rollout State

This table is the operational source of truth for the transition. "Code
landed" means the branch has deterministic coverage for the path. "Production
cutover remaining" is the part that must be true before the provider should rely
on webhooks for normal freshness in production.

| Provider | V1 posture | Code landed | Production cutover remaining |
| --- | --- | --- | --- |
| GitHub | Webhook-first with slow reconciliation. | Signed webhook ingress, durable delivery targets, repo/org target matching, repo-limited sync, GitHub App installation-token hydration when configured, installation-keyed budget pauses, conditional REST reconciliation for repo surfaces. | Configure production GitHub App id/private key, webhook URL, `GITHUB_WEBHOOK_SECRET`, and selected events; run live canary; then reduce broad polling. |
| Monday.com | Webhook-first for selected board activity; reconciliation for WorkDocs and legacy grants. | Token-protected challenge/ingress, board webhook provisioning/deprovisioning, lightweight board events, item-level hydration, account-keyed budgets for new grants, reconnect/degraded handling for legacy grants, daily WorkDocs reconciliation. | Configure `MONDAY_WEBHOOK_SECRET`; ensure new grants include `account:read` and `webhooks:write`; move legacy grants through reconnect or accepted degraded mode; validate live provisioning before lowering broad board polling. |
| Sentry | Webhook-first for issue/release activity with daily reconciliation. | Signed issue-alert, issue lifecycle, and release ingress, installation/project target routing, direct event normalization, project-limited sync. | Confirm live Sentry API permissions, webhook secret/signature config, and provider-side issue/release subscriptions; keep daily reconciliation enabled. |
| Linear | Webhook-first with reconciliation fallback. | Signed ingress through durable delivery targets and `webhook-delivery`, direct event writes, catch-up sync parity. | Keep route wrapper thin or remove it after gateway parity is complete; require configured signing secret before treating webhook freshness as production-critical. |
| Google Drive | Wake-up-first. | Channel wake-ups persist delivery targets and enqueue bounded sync through `webhook-delivery`; expiring subscription rows are swept by the integration tick and expired/manual channels surface `webhook_degraded` while changes-cursor reconciliation stays authoritative. | Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_DRIVE_WEBHOOK_SECRET`; keep manual Drive channel setup documented until provider-managed Drive watch provisioning is added. |
| Slack native workspace | Reconciliation-first for v1. | Selected-channel reconciliation and Slack Web API `Retry-After` provider budget pauses. Conversational `/api/slack/events` remains separate. | No webhook-first cutover for v1. Add native Slack Events API gateway ingestion only if the product later needs lower-latency selected-channel sync. |

### Connector Universality Model

New native providers should fit one of these postures. The posture is declared
in `PROVIDER_SYNC_POLICIES` and checked by provider contract tests.

| Posture | Meaning | Current providers |
| --- | --- | --- |
| Webhook-first | Webhooks are the normal freshness path; reconciliation catches missed or incomplete payloads. | GitHub, Monday.com board events, Linear, Sentry |
| Wake-up-first | Webhooks only say "something changed"; provider API hydration remains authoritative. | Google Drive |
| Reconciliation-first | Polling/reconciliation is the v1 product posture; provider webhooks are absent, not useful enough, or reserved for another product surface. | Slack native workspace ingestion |
| Evidence-only ingest | User/team-managed generic webhook evidence, not a native authoritative provider. | Custom ingest webhooks |

The shared kit owns the lifecycle around those postures:

- catalog registration and setup docs
- OAuth/provider connection storage and encrypted secrets
- resource selection and team sharing
- webhook verification adapter
- target-hint extraction and team/resource matching
- durable delivery and per-target delivery rows
- event normalization and targeted sync tasks
- provider budget keys and cooldown handling
- connection attention and status taxonomy
- manual sync, job recovery, live canary, and setup documentation

The provider owns only the facts that are genuinely provider-shaped: signature
headers, resource ids, event payload structure, subscription API details, and
the narrowest safe hydration calls.

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

Delivery status is provider-request state only. Processing state must be tracked
per matched Timeline target because one delivery can fan out to multiple
integrations and teams. Store target processing in a second table, for example
`integration_webhook_delivery_targets`:

| Column | Purpose |
| --- | --- |
| `id` | Timeline UUID. |
| `delivery_id` | Parent `integration_webhook_deliveries.id`. |
| `team_id` | Target Timeline team. |
| `integration_id` | Target native integration. |
| `provider_connection_id` | Provider connection used for credentials and owner state. |
| `status` | `pending`, `processing`, `processed`, `ignored`, `failed`, `dead_lettered`. |
| `attempts` | Processing attempts for this target only. |
| `next_attempt_at` | Backoff time for retryable target failures. |
| `last_error` | Last target-specific processing error. |
| `event_dedup_keys` | Optional list or side table of events written for this target. |
| `sync_job_id` | Optional queued targeted sync job id. |

Unique constraints should prevent duplicate target rows for
`delivery_id + integration_id`, while event writes still dedupe through
provider-scoped event keys. If one target succeeds and another fails, retries
must resume only the failed target.

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

Current implementation: GitHub repo webhooks, Monday board/item webhooks, and
Sentry project webhooks emit targeted jobs. The sync worker validates those jobs
against selected resources before calling the provider with a narrowed selection
and target context. GitHub org selections may target the changed repo, Sentry org
selections may target the changed project, and Monday item targets may run when
their parent board is selected.

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

Initial provider budget scopes:

| Provider | Initial budget key | Pause behavior |
| --- | --- | --- |
| GitHub | `github + app_or_oauth_client + installation_or_user_id + core|secondary` | Use `Retry-After` when present, otherwise `x-ratelimit-reset` for primary limits and exponential backoff for secondary limits. |
| Monday.com | `monday + MONDAY_CLIENT_ID + account_id + daily|minute|complexity|concurrency` | Use `retry_in_seconds`, `Retry-After`, and `RateLimit` reset metadata; pause all teams sharing that monday account/app key. |
| Google Drive | `google_drive + GOOGLE_CLIENT_ID + account_or_drive_id + requests` | Start with observed 429/403 retry metadata and exponential backoff when reset time is unavailable. |
| Linear | `linear + LINEAR_CLIENT_ID + organization_id + requests` | Start with observed retry headers and bounded backoff; do not promote retryable limits to user-action attention. |
| Slack | `slack + SLACK_CLIENT_ID + team_id + web_api|events` | Respect Slack Web API retry metadata for hydration and keep Events API ingress limits separate from outbound hydration budgets. |
| Sentry | `sentry + SENTRY_CLIENT_ID + organization_id + requests` | Start with observed retry headers and bounded backoff for issue/release hydration. |

Providers without a known reset header still get budget rows. Their rows record
the pause reason, last observed response, and conservative backoff so the
scheduler has one place to ask whether work is allowed.

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
| Sentry | Validate `Sentry-Hook-Signature` with HMAC-SHA256 using the Sentry OAuth client secret. Use `Request-ID` as delivery id when present. |

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

GitHub now has signed webhook delivery ingress at `/api/webhooks/github`.
The route verifies `X-Hub-Signature-256`, stores `X-GitHub-Delivery`, resolves
enabled Timeline targets from selected `github.repo` and `github.org`
resources, and lets `webhook-delivery` write direct events through
`githubProvider.handleWebhook()` plus enqueue repo-limited targeted sync. The
provider captures the connecting user's GitHub App installations during OAuth
and, when `GITHUB_APP_ID` plus `GITHUB_APP_PRIVATE_KEY` are configured, mints
one-hour installation access tokens for repo hydration. OAuth user tokens remain
the fallback and still drive resource selection. GitHub installation-token rate
limits are recorded under installation-owned provider budget keys, so another
Timeline team sharing the same installation pauses before spending the same
provider quota. Repo reconciliation stores GitHub `ETag` / `Last-Modified`
validators for page-1 PR, issue, commit, release, and workflow-run requests and
treats authenticated `304 Not Modified` responses as healthy no-op polls. The
remaining migration is to configure production GitHub App events and reduce
polling to slow reconciliation.

Webhook events to subscribe to:

| Event | Timeline handling |
| --- | --- |
| `push` | Write commit events from payload when sufficient; enqueue repo-limited targeted sync for the changed repo. |
| `pull_request` | Write PR event directly; enqueue repo-limited targeted sync for the changed repo. |
| `pull_request_review` | Write review event directly; enqueue repo-limited targeted sync for the changed repo. |
| `issues` | Write issue event directly; enqueue repo-limited targeted sync for the changed repo. |
| `release` | Write release event directly; enqueue repo-limited targeted sync for the changed repo. |
| `workflow_run` | Write workflow run status event directly; enqueue repo-limited targeted sync for the changed repo. |

Implementation notes:

- Use GitHub App installation identity for repository access whenever
  installation metadata and app private-key config are present. This spends the
  installation quota instead of the connection owner's OAuth user quota.
- Store `X-GitHub-Delivery` as the delivery id; the current route already does
  this for signed deliveries.
- Store `ETag` and `Last-Modified` on REST fallback surfaces. Current
  implementation covers page-1 PR, issue, commit, release, and workflow-run
  requests; authorized `304 Not Modified` responses do not count against primary
  rate limits.
- Keep a slow reconciliation job, for example every 6-24 hours per active
  installation, to catch missed deliveries and reconcile selected org scopes.
- Treat GitHub primary and secondary limits as provider budget rows keyed to
  `installation:<id>` when installation-token sync is active. Obey
  `Retry-After`; when `x-ratelimit-remaining` is `0`, pause until
  `x-ratelimit-reset`; otherwise use exponential backoff.

### Monday.com

Monday.com now has token-protected webhook ingress at `/api/webhooks/monday`.
The route echoes monday.com's URL-verification `challenge` only when
`MONDAY_WEBHOOK_SECRET` is present in the request URL/header, persists selected
board deliveries, and lets `webhook-delivery` write lightweight board activity
events plus enqueue item-level targeted sync when the payload identifies an
item. Activated board selections now provision monday.com board webhooks through
`create_webhook`, store provider webhook ids in
`integration_webhook_subscriptions`, and deprovision stale webhooks through
`delete_webhook` when boards are unshared or the integration is disconnected.
New OAuth connections request `account:read` and store the monday account id as
the integration `externalAccountId` when the account query is authorized, with a
fallback to token/user metadata when the provider omits account identity.
Existing connections created before `account:read`/`webhooks:write` cannot be
silently upgraded by Timeline; activation and sync now record reconnect
attention, skip provider-side webhook provisioning, and keep selected-resource
reconciliation running in degraded mode until the owner reconnects. Selected
WorkDocs now reconcile on their own daily doc cursor instead of being fetched
during every hourly board sync. The remaining migration is lowering broad board
polling as webhook confidence grows.

Webhook subscriptions to create for selected boards:

| Event | Timeline handling |
| --- | --- |
| `create_item` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `change_column_value` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `change_status_column_value` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `change_name` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `create_update` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `edit_update` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `delete_update` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `create_subitem` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `change_subitem_column_value` | Write lightweight board activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |
| `item_archived`, `item_deleted`, `item_restored` | Write lightweight board lifecycle activity when payload is sufficient; enqueue `monday.item` hydration when an item id is present. |

Implementation notes:

- monday.com verifies webhook URLs by POSTing a `challenge`; the route echoes
  `{ "challenge": "<same value>" }` after validating `MONDAY_WEBHOOK_SECRET`.
- Monday.com webhook provisioning requires `webhooks:write`, and account/app
  budget scoping is strongest with `account:read`; existing connections created
  before these scopes were requested show `needs_reconnect` attention and skip
  automatic provider-side provisioning until the owner reconnects.
- Key budget by monday account and Timeline monday app client id. monday.com
  limits are per account and app unless noted otherwise.
- Parse `retry_in_seconds`, `Retry-After`, and `RateLimit` headers from every
  response. Pause before hitting `r=0` when possible.
- Avoid calling WorkDocs backfill on every board incremental. WorkDocs now use a
  daily doc reconciliation cursor unless a doc webhook becomes available.
- If a board webhook identifies an item, enqueue `monday.item` targeted
  hydration under the selected board; if it only identifies the board, enqueue a
  board-limited targeted sync, not an account-wide incremental sync.

### Google Drive

Keep Drive webhooks as wake-up signals. The existing handler already validates
the channel token and enqueues incremental sync for the matching integration.

Changes:

- Move route-specific token verification into the shared adapter contract.
- Store channel ids and expirations in `integration_webhook_subscriptions`.
- Sweep expiring channel rows from the integration tick; providers with
  managed provisioning renew through the shared helper, while manual Drive
  channels that expire are marked `webhook_degraded`.
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
be collapsed into native workspace ingestion. Native Slack workspace ingestion
is explicitly reconciliation-first for v1: selected channels sync through the
provider worker, and the worker checks Slack `web_api` budget pauses before
spending provider calls for any team that shares the same Slack workspace/app
quota.

This avoids duplicate ingestion with conversational capture, keeps bound-channel
Slack behavior isolated, and still gives missed/edited/reaction/file activity a
bounded hourly reconciliation loop. A later native Slack event-subscription mode
can be added behind the shared gateway if the product needs lower-latency
selected-channel ingestion.

Changes:

- Keep `/api/slack/events` working for conversational capture while the native
  gateway covers other providers.
- Mark native Slack workspace ingestion as reconciliation-first in provider
  policy instead of leaving it as an implementation-time decision.
- Treat Slack Web API 429 `Retry-After` responses as shared provider budget
  pauses with scope `web_api`.
- Keep selected-channel reconciliation so missed Slack events do not create
  holes in timelines.

### Sentry

Sentry has provider payload normalization and signed inbound native webhook
ingress at `/api/webhooks/sentry`. The route verifies
`Sentry-Hook-Signature`, persists a delivery, resolves enabled Timeline
integrations by Sentry organization/project selections or a remembered
installation UUID, then lets `webhook-delivery` reuse the existing Sentry event
normalization path and enqueue project-limited targeted sync when the payload
identifies an organization/project.

Webhook events handled:

| Event | Timeline handling |
| --- | --- |
| Issue alert triggered | Write alert event directly when issue id, title, actor, and URL are present. |
| Issue created/resolved/ignored/assigned/unresolved | Write lifecycle event directly when Sentry includes `data.issue`; enqueue project-limited reconciliation for missing metadata. |
| Release created/deployed | Write release event directly when payload includes project/release identity. |

Changes:

- Keep the Sentry native gateway route on provider secret/signature validation.
- Reuse `sentryProvider.handleWebhook()` normalization behind the adapter
  contract for issue alerts, issue lifecycle payloads, and release payloads.
- Resolve targets by Sentry organization/project selection or remembered
  installation UUID before writing events. Ambiguous payloads record zero
  targets rather than fan out across teams.
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
| GitHub | Yes | 6 hours per installation now; page-1 PR, issue, commit, release, and workflow-run conditional requests landed. |
| Monday.com | Yes for boards | 1 hour for active boards now; selected WorkDocs reconcile daily through their own doc cursor. |
| Google Drive | Wake-up only | 15-minute changes-cursor reconciliation plus future channel renewal. |
| Linear | Yes | 6 hours per org/team. |
| Slack | No for native workspace v1 | 1 hour selected-channel reconciliation; conversational Slack Events API remains separate. |
| Sentry | Yes | Daily issue/release reconciliation. |

The scheduler should:

1. Load enabled integrations and selected resources.
2. Group work by provider budget key.
3. Skip groups with active `paused_until`.
4. Enqueue due reconciliation tasks with stable job ids. Current
   implementation dedupes policy-driven reconciliation by integration while
   pending/running, and allows a later run after retained completed/failed jobs
   are removed.
5. Prefer targeted tasks over integration-wide tasks.
6. Record skipped work as normal audit/status, not as user-facing failure.

Current implementation: reconciliation cadence, ingestion posture, budget
scopes, targeted-sync support, and webhook provisioning model are centralized in
`PROVIDER_SYNC_POLICIES`. Contract tests compare the policy to registered
provider capabilities: webhook-capable providers must expose webhook
normalization, provider-managed provisioning requires provision/deprovision
methods, and Slack's native ingestion remains explicitly non-webhook for v1.
The integration worker consumes this shared policy instead of owning a private
provider matrix, and `webhook-delivery` downgrades provider-supplied targeted
tasks to broad catch-up when the provider policy does not support targeted sync.

## User Experience

Integration status should stop treating expected cooldowns as generic failures.

Statuses:

| Status | User-facing meaning |
| --- | --- |
| `healthy` | Webhooks and reconciliation are current. |
| `syncing` | Backfill or targeted sync is running. |
| `provider_budget_paused` | Provider quota is cooling down; no user action needed. |
| `partial` | Some selected resources failed, but others are syncing. |
| `needs_reconnect` | Token or permission is invalid; user/admin action needed. |
| `needs_new_owner` | Connection owner left team; admin must choose a new owner. |
| `webhook_degraded` | Webhook subscription failed or expired; reconciliation still runs if budget allows. |
| `provider_degraded` | Provider is returning retryable failures outside known quota semantics. |

UI rules:

- Disable "Retry sync" while a provider budget pause is active. Show "Sync
  resumes at <time>" instead. Current implementation applies this to the
  connected integration list and manual sync API: paused integrations return a
  cooldown response and do not enqueue backfill work.
- Keep "Sync now" for manual reconciliation only when budget allows.
- Show provider/account scoped cooldowns clearly when multiple Timeline teams
  share a provider account quota.
- Make partial failures resource-specific, for example "2 of 18 GitHub repos
  need permission attention."
- Do not show raw provider JSON as the main message. Keep raw details in the
  disclosure panel for debugging.

User-facing status must be derived from shared state, in this order:

1. Required action: `needs_reconnect`, `needs_new_owner`, or permission
   attention.
2. Active provider budget pause: `provider_budget_paused`, with retry time and
   provider/account scope.
3. Webhook subscription trouble: `webhook_degraded`, with reconciliation
   fallback status.
4. Resource-level partial failure counts.
5. Healthy/syncing fallback from integration and sync-state rows.

Raw provider errors remain available in details panes and audit logs, but the
primary row copy must use the status taxonomy above. A quota response with
known retry metadata is not a red "sync failed" state.

## Observability and Health

The permanent fix needs production signals that prove Timeline is calling
providers less often without silently losing state.

Track these metrics by provider, external account/app budget key, and Timeline
team where safe:

| Signal | Why it matters |
| --- | --- |
| Webhook deliveries accepted, ignored, duplicated, failed, retried, and dead-lettered. | Shows whether provider ingress is healthy and whether duplicate protection is working. |
| Delivery target processing latency and attempts. | Finds fan-out or worker retry problems before users see stale integrations. |
| Targeted sync jobs enqueued, coalesced, completed, and downgraded to broad catch-up. | Proves webhook bursts collapse to bounded provider calls. |
| Reconciliation jobs due, skipped by budget, completed, and failed. | Shows whether fallback polling still covers missed webhooks. |
| Provider budget rows created, paused, resumed, and manually retried. | Shows which provider account/app quotas are constraining product freshness. |
| Connection attention by type: `needs_reconnect`, `needs_new_owner`, `webhook_degraded`, `sync_error`. | Separates user-action problems from provider cooldowns and implementation bugs. |
| Live canary status by provider capability. | Prevents code existence from being mistaken for production readiness. |

Alerting should page the team only for actionable system problems:

- verified webhook deliveries are accepted but target processing stays delayed
  beyond the provider's expected freshness window
- a provider route starts rejecting valid signatures or challenges
- dead-lettered delivery targets exceed a small threshold per provider
- reconciliation falls behind after webhook degradation
- provider budget pauses are missing for known 429/rate-limit responses

Quota exhaustion by itself should not page unless it is unexpected for the
provider/account or reconciliation has no remaining recovery window. Users
should see cooldown state; operators should see provider-budget evidence.

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

## Production Cutover Gates

Webhook-first cutover is per provider. A provider can be partially migrated in
code while still running reconciliation-first in production.

The cutover rule is deliberately conservative:

1. Code may ship behind configuration when deterministic tests pass.
2. Webhook-triggered targeted sync may run in production only for providers
   whose required secrets and provider app configuration are present.
3. Polling may be reduced only after live canary and production delivery logs
   show that webhook ingestion is accepted, durable, target-resolved, and
   recoverable through reconciliation.
4. A provider with missing secrets, missing permissions, or failing live probes
   stays reconciliation-first or wake-up-first, even if its webhook route exists.

Shared release gates:

- The provider has a declared `PROVIDER_SYNC_POLICIES` entry.
- Signature/challenge verification has route tests with valid and invalid
  fixtures.
- Target resolution proves selected-resource and cross-team isolation.
- Delivery persistence happens before async processing.
- Per-target processing can retry failed targets without replaying successful
  ones.
- Provider budget pauses skip scheduler/manual-sync enqueueing.
- The connected integration UI shows cooldown/reconnect/degraded states without
  exposing raw provider JSON as the primary message.
- `pnpm canary:integrations -- --env-file=<prod-like env>` reports `OK` for
  live probes where the canary can safely call the provider, and reports `OK`
  for required OAuth/webhook secrets that are presence-checked. Providers that
  are not green stay explicitly reconciliation-first or wake-up-first.
- Production delivery logs show accepted, duplicate, no-target, failed, retry,
  and dead-letter states without cross-team writes.
- Rollback can be applied by reverting the provider policy/config cutover while
  leaving provider connections, selected resources, persisted deliveries, and
  reconciliation cursors intact.

Provider-specific cutover gates:

| Provider | Required before webhook-first production cutover |
| --- | --- |
| GitHub | GitHub App id/private key configured; app webhook URL and `GITHUB_WEBHOOK_SECRET` configured; selected events enabled; installation-token live canary passes; OAuth fallback remains available. |
| Monday.com | `MONDAY_WEBHOOK_SECRET` configured; new OAuth grants include `account:read` and `webhooks:write`; legacy grants show reconnect attention; board webhook provisioning/deprovisioning deterministic tests pass; WorkDocs stays daily reconciliation. |
| Sentry | `SENTRY_INTEGRATION_CLIENT_SECRET` configured for webhook verification; issue alert/lifecycle/release fixtures pass; live token has org/project access; daily reconciliation remains enabled. |
| Linear | Signed webhook secret configured; route runs through delivery persistence; direct event and catch-up sync parity tests pass. |
| Google Drive | Channel-token verification persists deliveries; channel expiration state is represented in subscriptions; expired manual channels surface `webhook_degraded`; changes-cursor reconciliation remains authoritative. |
| Slack native workspace | No webhook-first cutover for v1. Selected-channel reconciliation, Web API budget handling, and the separate conversational Slack Events route remain the production posture. |

Rollback rule: if a provider cutover fails, revert that provider's policy/config
cutover or remove the provider-side webhook subscription, keep persisted
deliveries for replay, and keep slow reconciliation/manual backfill available.
Do not delete selected sources or user evidence during rollback.

Current live readiness should be read from the latest canary output, not from
the existence of code. For the current configured environment, webhook-first
production cutover is blocked until GitHub App credentials, webhook secrets for
GitHub, Monday.com, Drive, and Linear, Drive/Linear OAuth credentials, and
Sentry API permissions are green. GitHub, Monday.com, Slack, and Sentry
OAuth/app credentials are currently configured; Slack native workspace does not
need a webhook-first canary because its v1 posture is reconciliation-first.

## Implementation Phases

### Phase 0: Provider Decisions Before Build

Deliverables:

1. Resolved: GitHub webhook-first should use GitHub App installation tokens
   whenever app id/private-key config is present; OAuth user tokens remain the
   fallback for selection and environments without app-token config.
2. Resolved: native Slack workspace ingestion is reconciliation-first for v1,
   separate from conversational Slack Events API capture.
3. Resolved: Monday board webhook provisioning requires `webhooks:write`,
   account/app budget scoping is strongest with `account:read`, and existing
   Monday connections created before those scopes must reconnect before
   automatic provider-side provisioning and account-keyed budget pauses can
   fully succeed.
4. Resolved: provider budgets start as Postgres durable state. Redis can be
   added later as a fast cache only if scheduler load makes it necessary.

Exit criteria:

- Every implemented provider has an explicit v1 gateway posture:
  webhook-first, wake-up-first, or reconciliation-first.
- Slack is not left as an implementation-time product decision.
- GitHub credential changes are known before the final webhook-first cutover;
  Monday credential/scope changes are already documented and implemented in the
  provider adapter.
- Provider budget storage has one durable source of truth before any optional
  cache is introduced.

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
   webhooks and can preserve direct event writes through the shared worker.
9. Add `integration_webhook_delivery_targets` so multi-team fan-out tracks
   processing, retry, and dead-letter state per target.

Exit criteria:

- Linear webhook route can be expressed through the gateway without behavior
  regression.
- Duplicate deliveries are idempotent.
- A delivery targeting multiple Timeline integrations can partially succeed and
  retry only failed targets.
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
4. Add initial budget-key derivation for Drive, Linear, Slack, and Sentry, even
   when the first version uses conservative backoff instead of provider-specific
   reset headers.
5. Update the worker so provider cooldowns do not throw into BullMQ retry
   pressure.
6. Update UI copy and button state for paused budgets.

Exit criteria:

- Monday `DAILY_LIMIT_EXCEEDED` pauses until the provider retry time.
- GitHub primary and secondary rate limits use the same pause path.
- Drive, Linear, Slack, and Sentry rate-limit responses create budget rows
  instead of generic sync errors.
- No user can click a retry button that knowingly burns a paused budget.

### Phase 4: Targeted Sync Jobs

Deliverables:

1. Extend `IntegrationSyncJobData` with `targeted`.
2. Add provider methods for targeted hydration where possible.
3. Add stable job ids for targeted sync to collapse duplicate webhook bursts.
4. Add per-resource/surface cursor status in `integration_sync_state`.
5. Keep integration-wide incremental sync only as fallback.

Exit criteria:

- GitHub repo webhooks hydrate only the affected repo; PR/issue/surface-only
  hydration remains a follow-up optimization.
- Monday board webhooks hydrate a single `monday.item` when the payload includes
  an item id; otherwise they sync only the affected board.
- Sentry project webhooks sync only the affected project; issue-only hydration
  remains a follow-up optimization.
- Drive, Linear, and Slack can either implement targeted sync or explicitly
  route targeted tasks to bounded incremental fallback.
- Duplicate targeted bursts coalesce while a matching job is waiting or running;
  a later delivery can enqueue again after the retained completed/failed job is
  removed.

### Phase 5: GitHub Webhook-First

Deliverables:

1. Configure GitHub App webhook URL and `GITHUB_WEBHOOK_SECRET`.
2. Keep the GitHub webhook route and provider normalizer on the shared delivery
   path.
3. Subscribe to the minimum required GitHub events.
4. Write direct events for PRs, reviews, issues, releases, workflow runs, and
   commits when payloads are sufficient.
5. Landed for repo fallback: store conditional request validators for page-1
   PR, issue, commit, release, and workflow-run requests, and treat
   authenticated `304 Not Modified` responses as healthy no-op polls.
6. Reduce GitHub background polling to slow reconciliation after production
   GitHub App events are configured.

Exit criteria:

- Normal PR/issue/release/workflow activity appears from webhooks without
  waiting for hourly polling.
- Reconciliation catches missed deliveries without exhausting quota.
- Existing selected repo/org semantics still hold.

### Phase 6: Monday Webhook-First

Deliverables:

1. Keep the Monday webhook route and provider normalizer on the shared delivery
   path, including challenge handling.
2. Landed: subscription provisioning for selected boards and selected board
   event types through monday.com's `create_webhook`.
3. Landed: monday webhook ids are stored in
   `integration_webhook_subscriptions`.
4. Landed: stale board webhooks are deprovisioned through `delete_webhook`
   when a board is unshared or an integration disconnects.
5. Landed: WorkDocs use their own daily reconciliation cursor instead of the
   hourly board incremental loop.
6. Landed: board webhook payloads that identify an item, update, or subitem
   enqueue `monday.item` hydration under the selected parent board.

Exit criteria:

- Selected board changes trigger targeted sync without 5-minute polling.
- Monday daily and minute budgets are visible and honored.
- Removing a selected board removes or disables its monday webhook
  subscriptions.
- Existing Monday connections without `account:read` or `webhooks:write`
  degrade to user-keyed budgets/reconciliation and show reconnect guidance
  instead of generic sync failure.

### Phase 7: Slack Native Reconciliation Policy

Deliverables:

1. Keep the existing conversational Slack Events API route separate.
2. Keep native Slack workspace ingestion on selected-channel reconciliation for
   v1.
3. Record Slack Web API rate limits as provider budget pauses keyed by Slack
   team/app and scope `web_api`.
4. Leave native Slack event subscriptions as a later additive gateway mode, not
   a requirement for this transition.

Exit criteria:

- Slack's conversational capture and native workspace ingestion remain
  separate surfaces.
- Selected Slack channels have an explicit reconciliation-first policy in
  provider sync policy.
- Slack provider health uses the same status taxonomy as the other native
  providers.

### Phase 8: Sentry Native Webhooks

Deliverables:

1. Keep the Sentry native webhook route on the shared delivery gateway.
2. Verify provider secret/signature before target resolution.
3. Reuse existing Sentry webhook normalization behind the adapter.
4. Resolve targets by organization/project selection or remembered installation
   UUID.
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

1. Landed: add shared provider sync-policy contract tests so every registered
   native provider declares its cadence, ingestion posture, budget scopes,
   targeted-sync support, webhook provisioning model, and matching provider
   method capabilities.
2. Landed: add a provider template with documented adapter methods:
   `docs/native-provider-template.md`.
3. Landed: add native provider adapter contract tests that every registered
   provider must pass for core adapter methods, policy coherence, webhook
   capability coherence, and provider-specific test-file coverage.
4. Update setup docs to distinguish app-level, manual, and provisioned
   webhooks.
5. Remove old provider-specific route logic after parity tests pass.

Exit criteria:

- Every implemented native provider uses the same delivery table, status
  model, provider sync policy, and budget path.
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
- Google Drive wake-up webhook persists one delivery and enqueues bounded sync
  work for the matching integration.
- Linear webhook gateway migration preserves direct event writes and catch-up
  sync enqueue behavior through `webhook-delivery`.
- Slack tests prove conversational `/api/slack/events` remains separate from
  native workspace ingestion, and native Slack selected-channel policy is either
  event-backed or explicitly reconciliation-first.
- Sentry issue alert, issue lifecycle, and release webhook payloads route
  through target resolution, reuse provider normalization, and write cited
  events.
- A single provider delivery that targets two Timeline integrations can succeed
  for one target, fail for the other, and retry only the failed target.
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

Landed foundations:

1. Add schema, delivery persistence, target persistence, provider budget rows,
   and the `webhook-delivery` queue/worker.
2. Route Linear and Google Drive through persisted webhook delivery work.
3. Add generic provider budget pause handling, convert GitHub rate limits, and
   parse Monday rate-limit/cooldown responses.
4. Add signed GitHub, token-protected Monday.com, and signed Sentry webhook
   routes.
5. Add targeted sync jobs for GitHub repo, Monday board, and Sentry project
   webhook deliveries, with stable job ids that coalesce waiting/running bursts
   by integration, resource, and surface.
6. Add Monday board webhook provisioning/deprovisioning for activated board
   selections.
7. Make manual sync and the connected integration UI honor provider budget
   pauses so users see cooldown state instead of a retry action that burns
   quota.
8. Replace the old broad fan-out posture with a 5-minute reconciliation
   heartbeat that consults provider policies before enqueueing due work:
   Drive 15 minutes, Monday/Slack 1 hour, GitHub/Linear 6 hours, and Sentry
   daily.
9. Centralize provider sync posture in the shared provider policy contract so
   worker cadence, provider capabilities, and future connector setup do not
   drift.
10. Make `webhook-delivery` enforce targeted-sync support from the shared
    policy, falling back to broad catch-up for providers that have not opted in.
11. Add `docs/native-provider-template.md` so future native providers start
    from the shared policy, webhook, budget, test, canary, and documentation
    checklist.

Remaining migration:

1. Reduce GitHub polling to slow reconciliation after production GitHub App
   events are configured.
2. Reduce Monday board polling after enough webhook confidence data and after
   legacy monday connections have either reconnected or accepted degraded
   reconciliation mode.
3. Keep native Slack workspace ingestion reconciliation-first unless product
   requirements justify a later Events API-backed gateway mode.
4. Remove old provider-specific route logic after parity tests pass.
5. Continue deepening the budget-aware scheduler with budget-key grouping,
   per-resource stale policies, and UI health summaries.

During migration, keep backfill and manual sync working. Webhooks should improve
freshness and quota use, not become a new single point of failure.

## Operational Playbook

When a provider reports a quota limit:

1. Parse provider retry metadata into `ProviderRateLimitError`.
2. Upsert the provider budget row with `paused_until`.
3. Mark affected integration status as `rate_limited` and surface API/manual
   sync attempts as `provider_budget_paused`.
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

1. How the product should batch/announce the Monday reconnect prompt for
   existing connections that do not yet have `account:read` and
   `webhooks:write`.
2. Whether provider budget checks need a Redis read-through cache after
   production traffic grows. Postgres remains the durable source of truth.
3. How aggressively to coalesce webhook bursts, especially for GitHub pushes,
   Monday boards with automation-heavy workflows, and any future native Slack
   Events API-backed channel ingestion.
4. Whether delivery payload retention should be indefinite like raw events or
   shorter-lived operational data after normalized events are written.

## Success Criteria

The transition is complete when:

- GitHub and Monday no longer rely on frequent global polling for normal
  freshness.
- Linear and Google Drive route through the shared gateway while preserving
  their existing webhook behavior.
- Slack has an explicit native ingestion posture, uses shared budget/status
  handling for reconciliation-first v1, and can add native Events API gateway
  ingestion later without changing conversational Slack capture.
- Sentry native webhooks write issue/release events through the gateway, with
  reconciliation fallback for missed or incomplete payloads.
- Known provider quota limits pause work automatically and show as cooldowns,
  not product failures.
- Every implemented native provider uses the same delivery persistence, budget
  ledger, target resolution, and status taxonomy.
- New provider work starts from a documented adapter template and contract test
  harness.
- A missed webhook can be recovered by reconciliation without duplicate raw
  events.
- Users see clear resource-level health and know when action is required.
- Production cutover is backed by a live canary: required provider app
  credentials and webhook secrets are `OK`, or the provider remains explicitly
  reconciliation-first with setup docs explaining why.
- A provider can be rolled back from webhook-triggered targeted sync to
  reconciliation without deleting selections, losing persisted deliveries, or
  exposing raw provider failures as the primary user message.
