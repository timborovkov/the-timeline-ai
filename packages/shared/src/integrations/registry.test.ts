import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  listAvailableProviders,
  listCatalog,
  listFeaturedCatalog,
} from '#src/integrations/registry.js';

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
    MONDAY_CLIENT_ID: '',
    MONDAY_CLIENT_SECRET: '',
    SLACK_CLIENT_ID: '',
    SLACK_CLIENT_SECRET: '',
    SLACK_SIGNING_SECRET: '',
    SENTRY_INTEGRATION_CLIENT_ID: '',
    SENTRY_INTEGRATION_CLIENT_SECRET: '',
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

  it('tracks the required first-party ingestion catalog', () => {
    resetEnv();

    const required = [
      'google_drive',
      'notion',
      'confluence',
      'figma',
      'linear',
      'jira',
      'asana',
      'monday',
      'trello',
      'basecamp',
      'github',
      'gitlab',
      'bitbucket',
      'sentry',
      'datadog',
      'slack',
      'discord',
      'salesforce',
      'hubspot',
      'pipedrive',
      'attio',
      'close',
      'stripe',
      'zendesk',
      'intercom',
    ];
    const byId = new Map(listCatalog().map((entry) => [entry.id, entry]));

    for (const id of required) {
      const entry = byId.get(id);
      expect(entry, `${id} should be represented in the integration catalog`).toBeDefined();
      expect(
        entry?.ingestStatus,
        `${id} should be implemented or on the first-party ingestion roadmap`,
      ).toMatch(/^(implemented|coming_soon)$/);
    }

    expect(byId.get('google_drive')?.ingestStatus).toBe('implemented');
    expect(byId.get('linear')?.ingestStatus).toBe('implemented');
    expect(byId.get('github')?.ingestStatus).toBe('implemented');
    expect(byId.get('monday')?.ingestStatus).toBe('implemented');
    expect(byId.get('slack')?.ingestStatus).toBe('implemented');
    expect(byId.get('sentry')?.ingestStatus).toBe('implemented');
  });

  it('points catalog logos at checked-in assets', () => {
    resetEnv();

    for (const entry of listCatalog()) {
      expect(entry.logo, `${entry.id} should use a local connector asset`).toMatch(
        /^\/connectors\/.+\.(svg|png)$/,
      );
      expect(
        existsSync(join(process.cwd(), '../../apps/web/public', entry.logo)),
        `${entry.id} logo should exist at ${entry.logo}`,
      ).toBe(true);
    }
  });
});
