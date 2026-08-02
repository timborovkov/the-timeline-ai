// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { visibleConnectionAttentionStats } from '@/app/app/team/integrations/connection-attention';
import { IntegrationsPageView } from '@/app/app/team/integrations/integrations-page-content';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} alt={props.alt ?? ''} />
  ),
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/app/actions/visibility', () => ({
  setIntegrationVisibilityDefaultAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

afterEach(() => {
  cleanup();
});

const baseConnectedRow = {
  provider: 'github',
  displayName: 'GitHub — Tim',
  enabled: true,
  lastSyncedAt: '2026-06-29T10:00:00.000Z',
  lastError: null,
  syncPause: null,
  visibilityDefault: 'team' as const,
  visibilityDefaultUserIds: null,
};

function model(): Parameters<typeof IntegrationsPageView>[0]['model'] {
  return {
    isAdmin: true,
    blockingAttentionCount: 1,
    webhookDegradedCount: 0,
    totalConnected: 2,
    totalCatalog: 1,
    totalSharedSources: 1,
    hasAnything: true,
    nativeCatalog: [
      {
        id: 'github' as const,
        label: 'GitHub',
        description: 'Repository activity and pull requests.',
        logo: '/github.svg',
        available: true,
      },
    ],
    mcpCatalogAvailable: [],
    ingestWebhookList: [],
    activeShareIds: [],
    teamSourceRows: [
      {
        share: {
          id: 'share-1',
          providerConnectionId: 'conn-1',
          resourceKind: 'github.repo',
          externalId: 'acme/app',
          externalLabel: 'acme/app',
          revokedAt: null,
        },
        connection: {
          id: 'conn-1',
          provider: 'github',
          displayName: 'GitHub — Tim',
          lastError: null,
          lastConnectedAt: '2026-06-01T00:00:00.000Z',
          ownerLabel: 'Tim',
          ownerUserId: 'user-1',
        },
      },
    ],
    connectedRows: [
      {
        ...baseConnectedRow,
        id: 'integration-needs-help',
        displayName: 'GitHub — needs help',
        lastError: 'github needs reconnect',
        attention: [
          {
            id: 'attention-1',
            category: 'needs_reconnect' as const,
            summary: 'Reconnect GitHub before sync can continue.',
            lastSeenAt: '2026-06-29T10:00:00.000Z',
          },
        ],
      },
      {
        ...baseConnectedRow,
        id: 'integration-healthy',
        displayName: 'GitHub — healthy',
        attention: [],
      },
    ],
    connectedMembers: [],
    mcpServerRows: [],
  };
}

describe('IntegrationsPageView', () => {
  it('counts only attention attached to visible integrations for the page banners', () => {
    const connectedRows = model().connectedRows;
    const firstConnectedRow = connectedRows[0];
    if (!firstConnectedRow) throw new Error('Expected connected row fixture');
    firstConnectedRow.attention.push({
      id: 'attention-2',
      category: 'webhook_degraded',
      summary: 'Webhook provisioning degraded.',
      lastSeenAt: '2026-06-29T10:05:00.000Z',
    });

    expect(visibleConnectionAttentionStats(connectedRows)).toEqual({
      blockingAttentionCount: 1,
      webhookDegradedCount: 1,
    });
    expect(
      visibleConnectionAttentionStats([
        {
          ...firstConnectedRow,
          attention: [],
        },
      ]),
    ).toEqual({ blockingAttentionCount: 0, webhookDegradedCount: 0 });
  });

  it('orders integration management by recovery, active sync, available sources, connect, then advanced tools', () => {
    render(<IntegrationsPageView params={{}} active={{ teamName: 'Acme' }} model={model()} />);

    expect(screen.getByRole('heading', { name: 'Team integrations', level: 1 })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Provider accounts/i })).toBeTruthy();

    const sectionNames = [
      'Needs attention',
      'Active team sync',
      'Available shared sources',
      'Connect provider account',
      'Advanced integration tools',
    ];
    const topPositions = sectionNames.map((name) =>
      screen.getByRole('heading', { name }).compareDocumentPosition(document.body),
    );

    expect(screen.getByText('GitHub — needs help')).toBeTruthy();
    expect(screen.getByText('GitHub — healthy')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconnect account' })).toBeTruthy();
    expect(screen.getByText(/Choose which provider-account sources/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeTruthy();

    expect(
      sectionNames.every((name, index) => {
        const current = screen.getByRole('heading', { name });
        const nextName = sectionNames[index + 1];
        if (!nextName) return true;
        const next = screen.getByRole('heading', { name: nextName });
        return Boolean(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
    expect(topPositions.length).toBe(sectionNames.length);
  });

  it('keeps the shared-source anchor available when replacement attention has no sources yet', () => {
    const pageModel = model();
    pageModel.totalSharedSources = 0;
    pageModel.teamSourceRows = [];
    const firstConnectedRow = pageModel.connectedRows[0];
    if (!firstConnectedRow) throw new Error('Expected connected row fixture');
    pageModel.connectedRows[0] = {
      ...firstConnectedRow,
      attention: [
        {
          id: 'attention-2',
          category: 'needs_new_owner',
          summary: 'Choose a replacement connection before sync can continue.',
          lastSeenAt: '2026-06-29T10:00:00.000Z',
        },
      ],
    };

    render(<IntegrationsPageView params={{}} active={{ teamName: 'Acme' }} model={pageModel} />);

    expect(screen.getByRole('heading', { name: 'Available shared sources' })).toBeTruthy();
    expect(screen.getByText(/No shared provider sources yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose replacement' }).getAttribute('href')).toBe(
      '#available-shared-sources',
    );
  });

  it('keeps the replacement anchor available for deleted-provider errors without attention rows', () => {
    const pageModel = model();
    pageModel.totalSharedSources = 0;
    pageModel.teamSourceRows = [];
    const firstConnectedRow = pageModel.connectedRows[0];
    if (!firstConnectedRow) throw new Error('Expected connected row fixture');
    pageModel.connectedRows[0] = {
      ...firstConnectedRow,
      lastError: 'Provider connection deleted — replacement required',
      attention: [],
    };

    render(<IntegrationsPageView params={{}} active={{ teamName: 'Acme' }} model={pageModel} />);

    expect(screen.getByRole('heading', { name: 'Available shared sources' })).toBeTruthy();
    expect(screen.getByText(/No shared provider sources yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose replacement' }).getAttribute('href')).toBe(
      '#available-shared-sources',
    );
  });

  it('points the MCP OAuth success banner to advanced integration tools', () => {
    render(
      <IntegrationsPageView
        params={{ connected: '1' }}
        active={{ teamName: 'Acme' }}
        model={model()}
      />,
    );

    expect(
      screen.getByText(/MCP server connected successfully.*Advanced integration tools/i),
    ).toBeTruthy();
    expect(screen.queryByText(/list above/i)).toBeNull();
  });

  it('keeps connection error codes in a closed technical disclosure', () => {
    render(
      <IntegrationsPageView
        params={{ error: 'oauth_denied' }}
        active={{ teamName: 'Acme' }}
        model={model()}
      />,
    );

    const errorAlert = screen.getAllByRole('alert').find((alert) => alert.querySelector('details'));
    expect(errorAlert).toBeTruthy();
  });
});
