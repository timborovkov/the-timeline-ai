# Native Provider Template

Use this when adding or reshaping a first-party native integration. The goal is
that a provider author fills in provider-specific API details while the route,
delivery persistence, queueing, budget pauses, status model, and recovery
behavior stay shared.

This template is intentionally stricter than "make a provider file." A new
provider is not ready until its policy, webhook posture, fallback sync path,
tests, docs, and live canary story are explicit.

## 1. Decide The Provider Posture

Add the provider to `NATIVE_PROVIDER_IDS`, `IntegrationProvider['id']`, the
registry, catalog, and `PROVIDER_SYNC_POLICIES`.

Choose these fields before writing route code:

| Field | Required decision |
| --- | --- |
| `ingestionPosture` | `webhook_first`, `webhook_wakeup`, or `reconciliation_first`. |
| `reconciliationIntervalMs` | Slow fallback cadence. Webhooks are not a replacement for reconciliation. |
| `budgetScopes` | Provider quota scopes the worker checks before spending API calls. |
| `supportsWebhookIngress` | Whether inbound provider deliveries enter `webhook-delivery`. |
| `supportsTargetedSync` | Whether webhook work may enqueue `kind: 'targeted'`; otherwise it falls back to broad catch-up. |
| `provisioningModel` | `app_level`, `provider_managed`, `manual`, or `none`. |

Run `packages/shared/src/integrations/registry.test.ts`. It enforces that the
registered provider and the policy agree with actual provider methods.

## 2. Implement The Provider Adapter

Create `packages/shared/src/integrations/providers/<provider>.ts` and export it
from `packages/shared/src/integrations/index.ts`.

Skeleton:

```ts
import type { IntegrationProvider, WebhookHandleResult } from '#src/integrations/types.js';

export const exampleProvider: IntegrationProvider = {
  id: 'example',
  displayLabel: 'Example',

  async startOAuth({ redirectUri, state }) {
    return { authorizeUrl: buildAuthorizeUrl({ redirectUri, state }) };
  },

  async handleOAuthCallback({ code, redirectUri }) {
    const tokens = await exchangeCode({ code, redirectUri });
    return {
      externalAccountId: tokens.accountId,
      displayName: tokens.accountName,
      scopes: tokens.scopes,
      tokens,
      accessTokenExpiresAt: tokens.expiresAt,
    };
  },

  async listSyncableResources(integration, tokens, ctx) {
    const freshTokens = await ensureAccessToken(tokens, ctx);
    return listResources(freshTokens);
  },

  async backfill({ integration, tokens, selections, ctx }) {
    for (const selection of selections) {
      const cursor = await ctx.loadCursor(`${selection.kind}:${selection.externalId}`);
      const result = await syncSelection({ integration, tokens, selection, cursor, mode: 'backfill' });
      await ctx.writeEvents(result.events);
      await ctx.saveCursor(`${selection.kind}:${selection.externalId}`, result.cursor);
    }
  },

  async incrementalSync({ integration, tokens, selections, ctx, target }) {
    if (target?.resourceType === 'example.resource') {
      await syncOneResource({ integration, tokens, target, ctx });
      return;
    }
    for (const selection of selections) {
      const cursor = await ctx.loadCursor(`${selection.kind}:${selection.externalId}`);
      const result = await syncSelection({ integration, tokens, selection, cursor, mode: 'incremental' });
      await ctx.writeEvents(result.events);
      await ctx.saveCursor(`${selection.kind}:${selection.externalId}`, result.cursor);
    }
  },

  async handleWebhook({ integration, payload }): Promise<WebhookHandleResult> {
    const event = normalizePayload(payload);
    return {
      events: event ? [event] : [],
      syncTasks: event
        ? [
            {
              integrationId: integration.id,
              teamId: integration.teamId,
              triggeredBy: 'webhook',
              resourceType: 'example.resource',
              externalId: event.externalObjectId,
              reason: 'example_webhook',
            },
          ]
        : [],
    };
  },
};
```

Provider rules:

- Use stable provider-scoped `dedupKey` values for every event.
- Treat webhook payloads as untrusted. Do not trust routing fields until the
  route verifies the provider signature or token.
- Save cursors per resource/surface. A partial failure should not poison the
  whole integration when other resources succeeded.
- Throw `ProviderRateLimitError` when the provider gives retry metadata. Do not
  turn expected quota cooldowns into `needs_reconnect`.
- Refresh OAuth tokens through the shared `ctx.persistTokens()` path.
- Store secrets only through encrypted provider connections. Never add plaintext
  token columns.

## 3. Add Webhook Ingress

If `supportsWebhookIngress` is true, add a route under
`apps/web/src/app/api/webhooks/<provider>/route.ts`.

Route responsibilities:

1. Verify provider signature, token, or challenge before trusting payload
   routing fields.
2. Return provider-required challenge responses without writing events.
3. Persist accepted deliveries through `recordWebhookDeliveryTargets()`.
4. Enqueue `webhook-delivery` after persistence.
5. Return success for verified deliveries with no matching selected targets so
   providers do not retry forever.

The route should not write raw events directly. Direct event writes happen in
`webhook-delivery` after a delivery target is loaded and matched to an enabled
integration.

## 4. Add Provisioning Only When The Provider Owns It

For `provisioningModel: 'provider_managed'`, implement both:

- `provisionWebhooks(input): Promise<WebhookSubscription[]>`
- `deprovisionWebhook(input): Promise<void>`

The shared scope persists active subscriptions and deprovisions stale ones.
Provider-managed provisioning should be best-effort from activation and
selection changes: if it fails, record `webhook_degraded` or `sync_error`
attention while keeping reconciliation alive.

For `app_level` or `manual`, document the operator setup instead of pretending
Timeline can create provider subscriptions.

## 5. Add Tests

Minimum deterministic tests:

- Registry/policy coherence in `registry.test.ts`.
- OAuth URL/callback token handling.
- Resource listing shape and token refresh persistence.
- Backfill/incremental cursor behavior.
- Webhook route verification: valid signature, invalid signature, duplicate
  delivery, no selected target, persistence failure.
- Provider `handleWebhook()` normalization and targeted sync hints.
- Worker behavior when a targeted task is returned:
  `supportsTargetedSync=true` enqueues targeted sync;
  `supportsTargetedSync=false` falls back to broad catch-up.
- Provider rate-limit parsing into `ProviderRateLimitError`.

Run at least:

```bash
pnpm validate
pnpm run doctor
pnpm test:dist-imports
pnpm test:eval
pnpm canary:integrations -- --env-file=<env-file>
```

## 6. Update Docs And Canary

Update:

- `.env.example` and `docs/railway.html` for required env vars.
- `docs/setup/integrations.html` for operator setup and webhook URLs.
- `docs/integration-webhook-transition-plan.md` for provider posture and
  migration state.
- `TEST_TODO.md` for coverage state and remaining E2E gaps.
- `scripts/check-live-integrations.ts` when a live secret-safe probe is possible.

The canary should distinguish:

- `OK`: configured and probe succeeded.
- `WARN`: configured but provider rejected the probe.
- `SKIP`: missing optional provider credentials.
- strict mode may fail on `WARN` or `SKIP`, but the default canary should stay
  safe for local development.

## Done Criteria

A provider is ready for product use when:

- A user can connect it, select resources, backfill, and reconcile.
- Webhook delivery is durable before asynchronous processing.
- Missed webhook state can be recovered from reconciliation.
- Provider quota cooldowns pause work without looking like product failures.
- Deleting or unsharing selected resources stops future provider-side webhook
  work where Timeline controls provisioning.
- Tests prove team/resource isolation and duplicate delivery idempotency.
