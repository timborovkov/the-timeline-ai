import { AsyncLocalStorage } from 'node:async_hooks';

import { getEnv } from '#src/env.js';
import { externalFetch } from '#src/http/external-fetch.js';
import {
  requestBudgetIdentity,
  reserveProviderRequest,
  pauseProviderRequests,
  observeProviderCapacity,
} from '#src/integrations/request-budget.js';
import { ProviderRateLimitError, type NativeProviderId } from '#src/integrations/types.js';
import { childLogger } from '#src/logger.js';

export interface ProviderRequestContext {
  provider: NativeProviderId;
  externalAccountId?: string;
  appKey?: string;
  purpose: 'setup' | 'backfill' | 'webhook' | 'recovery' | 'resync' | 'chat' | 'health';
}

const context = new AsyncLocalStorage<ProviderRequestContext>();
const log = childLogger('integrations:requests');

export function currentProviderRequestContext(): ProviderRequestContext | undefined {
  return context.getStore();
}

export function withProviderRequestContext<T>(value: ProviderRequestContext, run: () => T): T {
  return context.run(value, run);
}

/** Retry-After accepts either seconds or an HTTP date. Never retry early. */
export function providerRetryAt(headers: Headers, now = Date.now()): Date {
  const value = headers.get('retry-after');
  const seconds = value === null ? NaN : Number(value);
  const date = value === null ? NaN : Date.parse(value);
  const reset = Math.max(
    0,
    ...[
      'x-ratelimit-reset',
      'x-ratelimit-requests-reset',
      'x-ratelimit-complexity-reset',
      'x-sentry-rate-limit-reset',
    ].map((name) => {
      const value = Number(headers.get(name));
      return Number.isFinite(value) ? (value > 1e12 ? value : value * 1000) : 0;
    }),
  );
  const retryAfter =
    Number.isFinite(seconds) && seconds >= 0
      ? now + seconds * 1000
      : Number.isFinite(date)
        ? date
        : 0;
  return new Date(
    Math.max(now + 1000, retryAfter, reset, retryAfter || reset > now ? 0 : now + 60_000),
  );
}

export function providerResponseLimit(
  provider: NativeProviderId,
  response: Response,
  body: string,
): ProviderRateLimitError | null {
  const quotaBody =
    /rate.?limit|ratelimited|quota.?exceeded|RESOURCE_EXHAUSTED|COMPLEXITY_BUDGET_EXHAUSTED/i.test(
      body,
    );
  if (
    response.status !== 429 &&
    !(response.status === 403 && quotaBody) &&
    !(provider === 'linear' && response.ok && /"errors"\s*:/.test(body) && quotaBody) &&
    !(provider === 'slack' && response.ok && /"error"\s*:\s*"ratelimited"/.test(body))
  )
    return null;
  const retryAt = providerRetryAt(response.headers);
  const account = context.getStore()?.externalAccountId;
  return new ProviderRateLimitError({
    provider,
    retryAt,
    retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000)),
    scope: 'requests',
    reason: 'provider_quota_exhausted',
    ...(account ? { externalAccountId: account } : {}),
  });
}

/** Provider-specific wrappers preserve the existing SSRF/timeout transport. */
export function providerFetch(provider: NativeProviderId): typeof externalFetch {
  const once: typeof externalFetch = async (url, init, options) => {
    const started = Date.now();
    let status: number | undefined;
    let remaining: string | null = null;
    const current: ProviderRequestContext = context.getStore() ?? { provider, purpose: 'setup' };
    const identity =
      current.externalAccountId ?? new Headers(init?.headers).get('authorization') ?? 'setup-app';
    const parsedUrl = new URL(url);
    const method =
      provider === 'slack' &&
      parsedUrl.hostname === 'slack.com' &&
      parsedUrl.pathname.startsWith('/api/')
        ? parsedUrl.pathname.split('/').at(-1)
        : undefined;
    const paced = method === 'conversations.history' || method === 'conversations.replies';
    const enabled =
      Boolean(getEnv().REDIS_URL) &&
      getEnv().INTEGRATION_REQUEST_GOVERNOR_PROVIDERS.split(',').includes(provider);
    const key = identity
      ? requestBudgetIdentity(
          provider,
          `${current.appKey ?? provider}:${identity}:${method ?? 'api'}`,
        )
      : undefined;
    const release =
      enabled && key
        ? await reserveProviderRequest(provider, key, paced ? 60_000 : 0, current.externalAccountId)
        : undefined;
    try {
      const response = await externalFetch(url, init, options);
      status = response.status;
      remaining = response.headers.get('x-ratelimit-remaining');
      // Inspect only errors and Linear GraphQL, never duplicate downloaded file bodies.
      if (
        status === 429 ||
        status === 403 ||
        provider === 'linear' ||
        (provider === 'slack' && method !== undefined)
      ) {
        const error = providerResponseLimit(provider, response, await response.clone().text());
        if (error) {
          if (enabled && key) await pauseProviderRequests(key, error.retryAt);
          if (!['slack', 'monday', 'github'].includes(provider)) throw error;
        }
      }
      if (enabled && key) {
        const policies =
          provider === 'linear'
            ? [
                ['x-ratelimit-requests-remaining', 'x-ratelimit-requests-reset'],
                ['x-ratelimit-complexity-remaining', 'x-ratelimit-complexity-reset'],
              ]
            : provider === 'sentry'
              ? [['x-sentry-rate-limit-remaining', 'x-sentry-rate-limit-reset']]
              : [['x-ratelimit-remaining', 'x-ratelimit-reset']];
        for (const [remainingHeader, resetHeader] of policies) {
          if (!remainingHeader || !resetHeader) continue;
          const value = response.headers.get(remainingHeader);
          const reset = response.headers.get(resetHeader);
          if (value !== null && reset && !remainingHeader.includes('complexity')) {
            const resetMs = Number(reset) > 1e12 ? Number(reset) : Number(reset) * 1000;
            await observeProviderCapacity(
              key,
              Number(value) - (provider === 'github' ? 250 : 0),
              new Date(resetMs),
            );
          }
          if (
            value === null ||
            !Number.isFinite(Number(value)) ||
            Number(value) > (provider === 'github' ? 250 : 0)
          )
            continue;
          const headers = new Headers(response.headers);
          if (reset)
            headers.set(
              'x-ratelimit-reset',
              String(Number(reset) > 1e12 ? Number(reset) / 1000 : Number(reset)),
            );
          await pauseProviderRequests(key, providerRetryAt(headers));
        }
      }
      return response;
    } finally {
      await release?.().catch(() => {
        log.warn({ provider }, 'request lease release failed');
      });
      log.info(
        {
          provider,
          purpose: context.getStore()?.purpose ?? 'setup',
          status,
          remaining:
            remaining !== null && Number.isFinite(Number(remaining)) ? Number(remaining) : null,
          accountKey: key,
          operation: method ?? init?.method ?? 'GET',
          durationMs: Date.now() - started,
        },
        'provider request',
      );
    }
  };
  return async (url, init, options) => {
    const read = ['GET', 'HEAD'].includes(init?.method?.toUpperCase() ?? 'GET');
    const retries = read ? Math.max(0, options?.retries ?? 0) : 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await once(url, init, { ...options, retries: 0 });
        if (attempt < retries && [502, 503, 504].includes(response.status)) continue;
        return response;
      } catch (error) {
        if (
          attempt >= retries ||
          !(error instanceof Error) ||
          !('code' in error) ||
          (error.code !== 'timeout' && error.code !== 'network_failure')
        )
          throw error;
      }
    }
  };
}

export function providerRecoveryEnabled(provider: NativeProviderId): boolean {
  return getEnv().INTEGRATION_RECOVERY_PROVIDERS.split(',').includes(provider);
}

export function withProviderAccount<T>(account: string | undefined, run: () => T): T {
  const current = context.getStore();
  return current && account ? context.run({ ...current, externalAccountId: account }, run) : run();
}

/** Chat and arbitrary MCP servers have their own quota identities, outside native sync. */
export async function withExternalRequest<T>(
  input: { provider: 'telegram' | 'mcp'; identity: string; operation: string },
  run: () => Promise<T>,
): Promise<T> {
  const key = requestBudgetIdentity(input.provider, input.identity);
  const enabled = Boolean(getEnv().REDIS_URL);
  const release = enabled ? await reserveProviderRequest(input.provider, key) : undefined;
  const started = Date.now();
  let outcome = 'ok';
  try {
    return await run();
  } catch (error) {
    outcome = 'failed';
    if (enabled && error instanceof Error && 'retryAt' in error && error.retryAt instanceof Date)
      await pauseProviderRequests(key, error.retryAt);
    throw error;
  } finally {
    await release?.().catch(() => {
      log.warn({ provider: input.provider }, 'request lease release failed');
    });
    log.info(
      {
        provider: input.provider,
        operation: input.operation,
        accountKey: key,
        outcome,
        durationMs: Date.now() - started,
      },
      'provider request',
    );
  }
}
