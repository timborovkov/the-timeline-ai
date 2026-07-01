import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adminLoadProviderBudgetPause,
  adminRecordProviderBudgetPause,
  providerBudgetKeysForIntegration,
} from '#src/integrations/scope.js';
import {
  isProviderCooldownErrorMessage,
  missingRequiredProviderScopes,
} from '#src/integrations/types.js';
import { applyDbMigrations } from '#src/test/pglite.js';

describe('provider budget pauses', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await pg.close();
  });

  it('upserts active provider budget pauses by account/app/scope', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:00:00.000Z'));
    const key = {
      provider: 'monday' as const,
      appKey: 'monday-client',
      externalAccountId: 'account-1',
      scope: 'daily',
    };

    await adminRecordProviderBudgetPause(db as never, key, {
      pausedUntil: new Date('2026-06-25T03:00:00.000Z'),
      reason: 'daily_limit_exceeded',
    });
    await adminRecordProviderBudgetPause(db as never, key, {
      pausedUntil: new Date('2026-06-25T04:00:00.000Z'),
      reason: 'daily_limit_exceeded',
    });

    await expect(
      adminLoadProviderBudgetPause(db as never, {
        provider: 'monday',
        appKey: 'monday-client',
        externalAccountId: 'account-1',
      }),
    ).resolves.toEqual({
      retryAt: new Date('2026-06-25T04:00:00.000Z'),
      reason: 'daily_limit_exceeded',
      scope: 'daily',
    });

    vi.setSystemTime(new Date('2026-06-25T04:00:01.000Z'));
    await expect(
      adminLoadProviderBudgetPause(db as never, {
        provider: 'monday',
        appKey: 'monday-client',
        externalAccountId: 'account-1',
      }),
    ).resolves.toBeNull();
  });

  it('derives GitHub installation budget keys from stored token metadata', () => {
    const keys = providerBudgetKeysForIntegration(
      {
        provider: 'github',
        externalAccountId: 'user-42',
      } as never,
      'primary',
      {
        github_installation_id: '123',
        github_app_installations: [
          { id: '123', account_login: 'acme' },
          { id: 456, account_login: 'other' },
        ],
        github_app_installation_tokens: {
          '789': { token: 'ghs_cached', expires_at: Date.now() + 60_000 },
        },
      },
    );

    expect(keys.map((key) => key.externalAccountId)).toEqual([
      'user-42',
      'installation:123',
      'installation:456',
      'installation:789',
    ]);
    expect(new Set(keys.map((key) => key.scope))).toEqual(new Set(['primary']));
  });

  it('reports legacy Monday connections missing account and webhook scopes', () => {
    expect(
      missingRequiredProviderScopes('monday', [
        'boards:read',
        'users:read',
        'updates:read',
        'docs:read',
      ]),
    ).toEqual(['account:read', 'webhooks:read', 'webhooks:write']);
    expect(
      missingRequiredProviderScopes('monday', [
        'boards:read',
        'account:read',
        'webhooks:read',
        'webhooks:write',
      ]),
    ).toEqual([]);
    expect(missingRequiredProviderScopes('github', [])).toEqual([]);
  });

  it('classifies provider cooldown messages separately from actionable sync errors', () => {
    expect(
      isProviderCooldownErrorMessage(
        'monday_rate_limited: Monday API DAILY_LIMIT_EXCEEDED; retry after 2026-06-28T12:00:00.000Z',
      ),
    ).toBe(true);
    expect(
      isProviderCooldownErrorMessage(
        'github_rate_limited: GitHub API rate limit reached; retry after 2026-06-25T03:00:00.000Z',
      ),
    ).toBe(true);
    expect(isProviderCooldownErrorMessage('Pull requests read permission required')).toBe(false);
    expect(isProviderCooldownErrorMessage('GitHub GET /repos/acme/app 404: Not Found')).toBe(false);
  });
});
