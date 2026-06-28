import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  getProvider,
  listRegisteredNativeProviderIds,
  listAvailableProviders,
  listCatalog,
  listFeaturedCatalog,
} from '#src/integrations/registry.js';
import {
  NATIVE_PROVIDER_IDS,
  PROVIDER_SYNC_POLICIES,
  providerSyncPolicy,
} from '#src/integrations/types.js';

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

  it('shows Slack native sync when OAuth credentials are configured without Events API signing', () => {
    resetEnv({
      SLACK_CLIENT_ID: 'slack-client-id',
      SLACK_CLIENT_SECRET: 'slack-client-secret',
      SLACK_SIGNING_SECRET: '',
    });

    const byId = new Map(listCatalog().map((entry) => [entry.id, entry]));
    expect(byId.get('slack')?.status).toBe('native_available');
    expect(listAvailableProviders().map((entry) => entry.id)).toEqual(['slack']);
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

  it('has a shared sync policy for every registered native provider', () => {
    resetEnv();

    expect(listRegisteredNativeProviderIds()).toEqual([...NATIVE_PROVIDER_IDS].sort());
    for (const provider of NATIVE_PROVIDER_IDS) {
      const policy = providerSyncPolicy(provider);
      expect(policy, `${provider} should have a provider sync policy`).toBe(
        PROVIDER_SYNC_POLICIES[provider],
      );
      expect(
        policy.reconciliationIntervalMs,
        `${provider} reconciliation should be bounded`,
      ).toBeGreaterThan(0);
      expect(
        policy.budgetScopes.length,
        `${provider} should declare budget scopes`,
      ).toBeGreaterThan(0);
      expect(
        ['webhook_first', 'webhook_wakeup', 'reconciliation_first'],
        `${provider} should declare a v1 ingestion posture`,
      ).toContain(policy.ingestionPosture);
      expect(
        ['app_level', 'provider_managed', 'manual', 'none'],
        `${provider} should declare how webhooks are provisioned`,
      ).toContain(policy.provisioningModel);
    }
  });

  it('keeps provider capabilities coherent with the shared sync policy', () => {
    resetEnv();

    for (const providerId of NATIVE_PROVIDER_IDS) {
      const provider = getProvider(providerId);
      const policy = providerSyncPolicy(providerId);

      if (policy.supportsWebhookIngress) {
        expect(
          typeof Reflect.get(provider, 'handleWebhook'),
          `${providerId} should normalize webhook payloads`,
        ).toBe('function');
      } else {
        expect(
          Reflect.get(provider, 'handleWebhook'),
          `${providerId} should not expose native webhook ingress`,
        ).toBe(undefined);
      }

      if (policy.provisioningModel === 'provider_managed') {
        expect(
          typeof Reflect.get(provider, 'provisionWebhooks'),
          `${providerId} should provision provider-managed webhooks`,
        ).toBe('function');
        expect(
          typeof Reflect.get(provider, 'deprovisionWebhook'),
          `${providerId} should deprovision provider-managed webhooks`,
        ).toBe('function');
      }
    }
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
