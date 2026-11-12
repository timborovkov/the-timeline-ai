import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import {
  agentMcpAccessMatchesQuery,
  buildDirectoryProviders,
  connectionsIntegrationIdFallback,
  connectionsTabHref,
  directoryHashOwnerId,
  directoryProviderList,
  filterAvailableProviders,
  initialOpenProviderId,
  parseConnectionsLocation,
  partitionAdvancedMcpCatalog,
  partitionMcpCatalog,
  partitionMcpServers,
  providerRowStatus,
  providerStatusLabel,
} from '@/app/app/connections/connection-directory';

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
      telegramConnections: 0,
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
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      }),
      slackConnections: 1,
    });

    expect(directory.connected.map((row) => row.id)).toEqual(['slack', 'github', 'linear']);
    expect(directory.available.map((row) => row.id)).toEqual(['telegram']);
    expect(directory.email.id).toBe('email');
    expect(directory.email.connected).toBe(false);
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

  it('counts a native-named MCP server as connected so the provider sheet stays reachable', () => {
    const directory = buildDirectoryProviders({
      model: model({
        mcpServerRows: [
          {
            id: 'mcp-linear',
            name: 'Linear',
            url: 'https://mcp.linear.app',
            authType: 'oauth',
            enabled: true,
            cachedTools: [],
            disabledTools: [],
            toolsCachedAt: null,
            lastError: null,
          },
        ],
      }),
      slackConnections: 0,
      telegramConnections: 0,
    });
    expect(directory.connected.map((row) => row.id)).toEqual(['linear']);
    expect(directory.connected.find((row) => row.id === 'linear')).toMatchObject({
      kind: 'native',
      primaryAction: 'open',
      statusLabel: 'Connected',
    });
    expect(directory.available.map((row) => row.id)).toEqual(['telegram', 'slack', 'github']);
    expect(directory.email.connected).toBe(false);

    const attention = buildDirectoryProviders({
      model: model({
        mcpServerRows: [
          {
            id: 'mcp-linear',
            name: 'Linear',
            url: 'https://mcp.linear.app',
            authType: 'oauth',
            enabled: true,
            cachedTools: [],
            disabledTools: [],
            toolsCachedAt: null,
            lastError: 'token expired',
          },
        ],
      }),
      slackConnections: 0,
      telegramConnections: 0,
    });
    expect(attention.connected.find((row) => row.id === 'linear')?.statusLabel).toBe(
      'Needs attention',
    );
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
    const directory = buildDirectoryProviders({
      model: model(),
      slackConnections: 0,
      telegramConnections: 0,
    });
    expect(filterAvailableProviders(directory.available, 'linea').map((row) => row.id)).toEqual([
      'linear',
    ]);
    expect(filterAvailableProviders(directory.available, 'tele').map((row) => row.id)).toEqual([
      'telegram',
    ]);
    expect(filterAvailableProviders([directory.email], 'email').map((row) => row.id)).toEqual([
      'email',
    ]);
  });

  it('lists Telegram and Email once as connected or available capture rows', () => {
    const unconfigured = buildDirectoryProviders({
      model: model(),
      slackConnections: 0,
      telegramConnections: 0,
      inboundEmail: {
        inboundEmail: null,
        enabled: true,
        senders: [],
        placeholderInbound: true,
      },
    });
    expect(unconfigured.available.map((row) => row.id)).toEqual([
      'telegram',
      'slack',
      'github',
      'linear',
    ]);
    expect(unconfigured.available.find((row) => row.id === 'telegram')).toMatchObject({
      kind: 'capture',
      primaryAction: 'setup',
      statusLabel: 'Not connected',
    });
    expect(unconfigured.email).toMatchObject({
      kind: 'capture',
      primaryAction: 'setup',
      connected: false,
    });

    const configured = buildDirectoryProviders({
      model: model(),
      slackConnections: 0,
      telegramConnections: 2,
      telegramWebhookConfigured: true,
      inboundEmail: {
        inboundEmail: 'acme@inbound.timeline.test',
        enabled: true,
        senders: ['ops@example.test'],
        placeholderInbound: false,
      },
    });
    expect(configured.connected.map((row) => row.id)).toEqual(['telegram']);
    expect(configured.connected.find((row) => row.id === 'telegram')?.statusLabel).toBe(
      'Connected',
    );
    expect(configured.email).toMatchObject({
      connected: true,
      statusLabel: 'Connected',
    });
    expect(configured.available.map((row) => row.id)).toEqual(['slack', 'github', 'linear']);
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
      telegramConnections: 0,
    });
    const providers = directoryProviderList(directory);
    expect(
      initialOpenProviderId({
        providers,
        connectedRows,
        integrationId: 'int-linear',
      }),
    ).toBe('linear');
    expect(
      initialOpenProviderId({
        providers,
        connectedRows,
        hash: '#github',
      }),
    ).toBe('github');
    expect(
      initialOpenProviderId({
        providers,
        connectedRows,
        hash: '#telegram',
      }),
    ).toBe('telegram');
    expect(
      initialOpenProviderId({
        providers,
        connectedRows,
        hash: '#email',
      }),
    ).toBe('email');
    expect(
      initialOpenProviderId({
        providers,
        connectedRows,
        hash: '#github-team-sources',
      }),
    ).toBe('github');
    expect(
      initialOpenProviderId({
        providers,
        connectedRows,
        hash: '#github-accounts',
      }),
    ).toBe('github');
    expect(
      directoryHashOwnerId('#google_drive-team-sources', [
        { id: 'google' },
        { id: 'google_drive' },
      ]),
    ).toBe('google_drive');
    expect(
      directoryHashOwnerId('#google-team-sources', [{ id: 'google' }, { id: 'google_drive' }]),
    ).toBe('google');
    expect(directoryHashOwnerId('#agent-mcp', providers)).toBeNull();
  });

  it('moves local-only and planned MCP catalog rows into Coming soon', () => {
    const partitioned = partitionAdvancedMcpCatalog([
      { id: 'notion', label: 'Notion', status: 'mcp_available' },
      { id: 'figma', label: 'Figma', status: 'mcp_local' },
      { id: 'hubspot', label: 'HubSpot', status: 'coming_soon' },
    ]);
    expect(partitioned.connectable.map((entry) => entry.id)).toEqual(['notion']);
    expect(partitioned.comingSoon.map((entry) => entry.id)).toEqual(['figma', 'hubspot']);
  });

  it('routes hashes onto Sources, Agent tools, or Developer', () => {
    const directory = buildDirectoryProviders({
      model: model(),
      slackConnections: 0,
      telegramConnections: 0,
    });
    const providers = directoryProviderList(directory);
    expect(
      parseConnectionsLocation({
        hash: '#email',
        providers,
        connectedRows: [],
      }),
    ).toEqual({ tab: 'sources', hash: 'email' });
    expect(
      parseConnectionsLocation({
        hash: '#github-team-sources',
        providers,
        connectedRows: [],
      }),
    ).toEqual({ tab: 'sources', hash: 'github-team-sources' });
    expect(
      parseConnectionsLocation({
        hash: '#github-accounts',
        providers,
        connectedRows: [],
      }),
    ).toEqual({ tab: 'sources', hash: 'github-accounts' });
    expect(
      parseConnectionsLocation({
        hash: '#agent-mcp',
        providers,
        connectedRows: [],
      }),
    ).toEqual({ tab: 'agent', hash: 'agent-mcp' });
    expect(
      parseConnectionsLocation({
        hash: '#webhooks',
        providers,
        connectedRows: [],
      }),
    ).toEqual({ tab: 'developer', hash: 'webhooks' });
    expect(
      parseConnectionsLocation({
        tab: 'agent',
        providers,
        connectedRows: [],
      }),
    ).toEqual({ tab: 'agent', hash: null });
    expect(connectionsTabHref('agent', 'timeline-mcp')).toBe(
      '/app/connections/agent-tools#timeline-mcp',
    );
  });

  it('opens ?integrationId= only on initial navigation, not after the sheet is dismissed', () => {
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
      telegramConnections: 0,
    });
    const providers = directoryProviderList(directory);
    expect(
      parseConnectionsLocation({
        hash: '',
        providers,
        connectedRows,
        integrationId: connectionsIntegrationIdFallback({
          source: 'initial',
          dismissed: false,
          integrationId: 'int-linear',
        }),
      }),
    ).toEqual({ tab: 'sources', hash: 'linear' });
    expect(
      parseConnectionsLocation({
        hash: 'linear-team-sources',
        providers,
        connectedRows,
        integrationId: connectionsIntegrationIdFallback({
          source: 'hash',
          dismissed: false,
          integrationId: 'int-linear',
        }),
      }),
    ).toEqual({ tab: 'sources', hash: 'linear-team-sources' });
    expect(
      parseConnectionsLocation({
        hash: '',
        providers,
        connectedRows,
        integrationId: connectionsIntegrationIdFallback({
          source: 'hash',
          dismissed: false,
          integrationId: 'int-linear',
        }),
      }),
    ).toEqual({ tab: 'sources', hash: null });
    expect(
      parseConnectionsLocation({
        hash: '',
        providers,
        connectedRows,
        integrationId: connectionsIntegrationIdFallback({
          source: 'initial',
          dismissed: true,
          integrationId: 'int-linear',
        }),
      }),
    ).toEqual({ tab: 'sources', hash: null });
    expect(
      parseConnectionsLocation({
        hash: '',
        providers,
        connectedRows,
        integrationId: connectionsIntegrationIdFallback({
          source: 'popstate',
          dismissed: false,
          integrationId: 'int-linear',
        }),
      }),
    ).toEqual({ tab: 'sources', hash: 'linear' });
  });

  it('keeps the Agent MCP row when search matches a connectable catalog tool or connected server', () => {
    const connectable = [
      { id: 'notion', label: 'Notion', description: 'Workspace pages and databases.' },
    ];
    const servers = [{ id: 'srv-1', name: 'Stripe MCP', url: 'https://mcp.stripe.com' }];
    expect(
      agentMcpAccessMatchesQuery({
        query: 'notion',
        connectable,
        servers,
      }),
    ).toBe(true);
    expect(
      agentMcpAccessMatchesQuery({
        query: 'stripe',
        connectable,
        servers,
      }),
    ).toBe(true);
    expect(
      agentMcpAccessMatchesQuery({
        query: 'figma',
        connectable,
        servers,
      }),
    ).toBe(false);
  });
});
