import { afterEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { listAvailableProviders, listFeaturedCatalog } from '#src/integrations/registry.js';

const ENV_BACKUP = { ...process.env };

function resetEnv(overrides: NodeJS.ProcessEnv = {}): void {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'test-auth-secret-at-least-sixteen',
    DATABASE_URL: 'postgres://timeline:timeline_dev@localhost:5432/timeline',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    LINEAR_CLIENT_ID: '',
    LINEAR_CLIENT_SECRET: '',
    GITHUB_APP_CLIENT_ID: '',
    GITHUB_APP_CLIENT_SECRET: '',
    ...overrides,
  };
  resetEnvForTests();
}

describe('integration registry catalog visibility', () => {
  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
  });

  it('hides unconfigured native providers from connectable and featured UI lists', () => {
    resetEnv();

    expect(listAvailableProviders()).toEqual([]);
    expect(listFeaturedCatalog().filter((entry) => entry.kind === 'native')).toEqual([]);
  });

  it('shows only native providers whose required env vars are configured', () => {
    resetEnv({
      GITHUB_APP_CLIENT_ID: 'github-client-id',
      GITHUB_APP_CLIENT_SECRET: 'github-client-secret',
    });

    expect(listAvailableProviders().map((entry) => entry.id)).toEqual(['github']);
    expect(
      listFeaturedCatalog()
        .filter((entry) => entry.kind === 'native')
        .map((entry) => entry.id),
    ).toEqual(['github']);
  });
});
