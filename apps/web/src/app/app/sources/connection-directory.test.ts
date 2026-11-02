import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import {
  buildDirectoryProviders,
  filterAvailableProviders,
  initialOpenProviderId,
  partitionMcpCatalog,
  partitionMcpServers,
  providerRowStatus,
  providerStatusLabel,
} from '@/app/app/sources/connection-directory';

const nativeCatalog = [
  {
    id: 'github' as const,
    label: 'GitHub',
    description: 'Repos',
    logo: '/connectors/github.svg',
    available: true,
  },
  {
    id: 'linear' as const,
    label: 'Linear',
    description: 'Issues',
    logo: '/connectors/linear.svg',
    available: true,
  },
  {
    id: 'slack' as const,
    label: 'Slack',
    description: 'Channels',
    logo: '/connectors/slack.svg',
    available: true,
  },
];

function model(overrides: Partial<IntegrationsPageModel> = {}): IntegrationsPageModel {
  return {
    isAdmin: true,
    blockingAttentionCount: 0,
    webhookDegradedCount: 0,
    totalConnected: 0,
    totalCatalog: 3,
    totalSharedSources: 0,
    hasAnything: true,
    nativeCatalog,
    mcpCatalogAvailable: [],
    ingestWebhookList: [],
    activeShareIds: [],
    teamSourceRows: [],
    connectedRows: [],
    connectedMembers: [],
    ownedConnections: [],
    mcpServerRows: [],
    ...overrides,
  };
}

describe('connection directory helpers', () => {
  it('maps attention, team sync, and personal-only connection into one status each', () => {
    expect(providerRowStatus({ attention: true, teamSyncing: true })).toBe('attention');
    expect(providerRowStatus({ attention: false, teamSyncing: true })).toBe('syncing');
    expect(providerRowStatus({ attention: false, teamSyncing: false })).toBe('connected');
    expect(providerStatusLabel('attention')).toBe('Needs attention');
    expect(providerStatusLabel('syncing')).toBe('Syncing for team');
    expect(providerStatusLabel('connected')).toBe('Connected');
  });

  it('lists each native provider once as connected or available', () => {
    const directory = buildDirectoryProviders({
      model: model({
        connectedRows: [
          {
            id: 'int-1',
            provider: 'linear',
            displayName: 'Linear — Acme',
            enabled: true,
            lastSyncedAt: '2026-06-01T00:00:00.000Z',
            lastError: null,
            syncPause: null,
            healthPause: null,
            attention: [],
            visibilityDefault: 'team',
            visibilityDefaultUserIds: null,
          },
          {
            id: 'int-2',
            provider: 'linear',
            displayName: 'Linear — second',
            enabled: true,
            lastSyncedAt: '2026-06-02T00:00:00.000Z',
            lastError: null,
            syncPause: null,
            healthPause: null,
            attention: [],
            visibilityDefault: 'team',
            visibilityDefaultUserIds: null,
          },
        ],
        ownedConnections: [
          {
            id: 'conn-1',
            provider: 'github',
            displayName: 'GitHub — Tim',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      }),
      slackConnections: 1,
    });

    expect(directory.connected.map((row) => row.id)).toEqual(['github', 'linear', 'slack']);
    expect(directory.available).toEqual([]);
    expect(directory.connected.filter((row) => row.id === 'linear')).toHaveLength(1);
    expect(directory.connected.find((row) => row.id === 'linear')?.statusLabel).toBe(
      'Syncing for team',
    );
    expect(directory.connected.find((row) => row.id === 'github')?.statusLabel).toBe('Connected');
  });

  it('keeps native MCP entries off the Advanced catalog', () => {
    const partitioned = partitionMcpCatalog(
      [
        { id: 'linear', label: 'Linear' },
        { id: 'notion', label: 'Notion' },
      ],
      nativeCatalog,
    );
    expect(partitioned.advanced.map((entry) => entry.id)).toEqual(['notion']);
    expect(partitioned.byProviderId.get('linear')?.map((entry) => entry.id)).toEqual(['linear']);
  });

  it('routes exact-name MCP servers onto the matching provider panel', () => {
    const partitioned = partitionMcpServers(
      [{ name: 'Linear' }, { name: 'Custom tools' }],
      nativeCatalog,
    );
    expect(partitioned.advanced.map((entry) => entry.name)).toEqual(['Custom tools']);
    expect(partitioned.byProviderId.get('linear')?.map((entry) => entry.name)).toEqual(['Linear']);
  });

  it('filters available providers by name', () => {
    const directory = buildDirectoryProviders({ model: model(), slackConnections: 0 });
    expect(filterAvailableProviders(directory.available, 'lin').map((row) => row.id)).toEqual([
      'linear',
    ]);
  });

  it('opens a provider from an integration id or hash', () => {
    const connectedRows = [
      {
        id: 'int-linear',
        provider: 'linear',
        displayName: 'Linear',
        enabled: true,
        lastSyncedAt: null,
        lastError: null,
        syncPause: null,
        healthPause: null,
        attention: [],
        visibilityDefault: 'team' as const,
        visibilityDefaultUserIds: null,
      },
    ];
    const directory = buildDirectoryProviders({
      model: model({ connectedRows }),
      slackConnections: 0,
    });
    expect(
      initialOpenProviderId({
        providers: [...directory.connected, ...directory.available],
        connectedRows,
        integrationId: 'int-linear',
      }),
    ).toBe('linear');
    expect(
      initialOpenProviderId({
        providers: [...directory.connected, ...directory.available],
        connectedRows,
        hash: '#github',
      }),
    ).toBe('github');
  });
});
