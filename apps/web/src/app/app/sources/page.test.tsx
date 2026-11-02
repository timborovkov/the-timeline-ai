import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: vi.fn(),
    useRouter: () => ({ refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('next/image'),
  () => ({
    default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img {...props} alt={props.alt ?? ''} />
    ),
  }),
  () => import('next/image'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/visibility'),
  () => ({
    setIntegrationVisibilityDefaultAction: vi.fn(() => Promise.resolve({ ok: true })),
  }),
  () => import('@/app/actions/visibility'),
);
const notify = vi.hoisted(() => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyError: notify.notifyError,
    notifySuccess: notify.notifySuccess,
  }),
  () => import('@/lib/notify'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { renderToString } = await import('react-dom/server');
const { RedirectActionToast } = await import('@/components/redirect-action-toast');
const { SourcesPageView } = await import('@/app/app/sources/sources-page-content');

afterEach(() => {
  notify.notifyError.mockClear();
  notify.notifySuccess.mockClear();
  cleanup();
});

const baseConnectedRow = {
  provider: 'github',
  displayName: 'GitHub — Tim',
  enabled: true,
  lastSyncedAt: '2026-06-29T10:00:00.000Z',
  lastError: null,
  syncPause: null,
  healthPause: null,
  visibilityDefault: 'team' as const,
  visibilityDefaultUserIds: null,
};

function summary(
  overrides: Partial<Parameters<typeof SourcesPageView>[0]['summary']> = {},
): Parameters<typeof SourcesPageView>[0]['summary'] {
  return {
    attention: 1,
    inboundEmail: 'acme+archive@inbound.timeline.test',
    emailForwarded: false,
    telegramConnections: 0,
    slackConnections: 0,
    documentsTotal: 0,
    documentAttention: 0,
    meetingsRecent: 0,
    meetingsActive: 0,
    meetingsFailed: 0,
    meetingMinutesUsed: 0,
    nativeIntegrations: 0,
    integrationErrors: 0,
    mcpServers: 0,
    mcpErrors: 0,
    ...overrides,
  };
}

function model(
  overrides: Partial<Parameters<typeof SourcesPageView>[0]['model']> = {},
): Parameters<typeof SourcesPageView>[0]['model'] {
  return {
    isAdmin: true,
    blockingAttentionCount: 1,
    webhookDegradedCount: 0,
    totalConnected: 2,
    totalCatalog: 3,
    totalSharedSources: 1,
    hasAnything: true,
    nativeCatalog: [
      {
        id: 'github' as const,
        label: 'GitHub',
        description: 'Repository activity and pull requests.',
        logo: '/connectors/github.svg',
        available: true,
      },
      {
        id: 'google_drive' as const,
        label: 'Google Drive',
        description: 'Selected folders into Documents.',
        logo: '/connectors/google-drive.svg',
        available: true,
      },
      {
        id: 'slack' as const,
        label: 'Slack',
        description: 'Selected channels and threads.',
        logo: '/connectors/slack.svg',
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
    ...overrides,
  };
}

describe('SourcesPageView', () => {
  it('keeps one page heading, the inbound address copy control, and sender-attribution guidance', () => {
    render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('acme+archive@inbound.timeline.test')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy();
    expect(screen.getByText(/Member email addresses are attributed automatically/)).toBeTruthy();
    expect(screen.getByText(/Unknown senders are captured and marked unverified/)).toBeTruthy();
  });

  it('lists native providers as collection rows without a separate Integrations or duplicate Slack row', () => {
    render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(document.querySelectorAll('#github')).toHaveLength(1);
    expect(document.querySelectorAll('#google_drive')).toHaveLength(1);
    expect(document.querySelectorAll('#slack')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Chat capture: Slack' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Install Slack/ })).toBeNull();
    expect(
      screen.queryByText('Connect Google Drive, Linear, GitHub, Monday.com, Slack, and Sentry.'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect: github' })).toBeTruthy();
  });

  it('keeps source actions contextual and rows responsive for keyboard and narrow-screen use', () => {
    const { container } = render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(screen.getByRole('link', { name: 'Manage email: Email' })).toBeTruthy();
    expect(container.innerHTML).toContain('min-h-8');
    expect(container.innerHTML).toContain('sm:flex-row sm:items-center sm:gap-3');
    expect(container.innerHTML).toContain('focus-visible:ring-2 focus-visible:ring-signal/50');
    expect(container.innerHTML).toContain('bg-white');
    expect(screen.getByText('Advanced tools')).toBeTruthy();
    expect(container.innerHTML).not.toContain('rounded-md border border-border bg-surface p-4');
  });

  it('shows administrator tools only to owners and admins', () => {
    const { rerender } = render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Outbound MCP sharing' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Integration audit' })).toBeTruthy();

    rerender(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin={false}
        summary={summary()}
        model={model({ isAdmin: false })}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Outbound MCP sharing' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Integration audit' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Provider accounts' })).toBeTruthy();
  });

  it('sends meeting failures to job recovery for admins only', () => {
    const failedSummary = summary({
      meetingsRecent: 4,
      meetingsFailed: 2,
      attention: 1,
    });
    const { rerender } = render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={failedSummary}
        model={model()}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Review failures: Meetings' }).getAttribute('href'),
    ).toBe('/app/team/jobs?kind=meeting_finalization');

    rerender(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin={false}
        summary={failedSummary}
        model={model({ isAdmin: false })}
      />,
    );
    expect(screen.queryByRole('link', { name: /Review failures/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /job recovery/i })).toBeNull();
  });

  it('orders recovery, connected sources, capture, team sync, then advanced tools', () => {
    render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Connections', level: 1 })).toBeTruthy();
    const sectionNames = [
      'Needs attention',
      'Add a connection',
      'Capture from email and chat',
      'Active team sync',
      'Available shared sources',
      'Advanced tools',
      'Advanced integration tools',
    ];
    const nodes = sectionNames.map((name) => screen.getByText(name, { exact: true }));
    expect(
      nodes.every((current, index) => {
        const next = nodes[index + 1];
        if (!next) return true;
        return Boolean(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
    expect(screen.getAllByText('GitHub — needs help').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Reconnect account' })).toBeTruthy();
    expect(screen.getByText(/Choose which provider-account sources/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Agent install guide' }).getAttribute('href')).toBe(
      '/help/agents',
    );
  });

  it('keeps the shared-source anchor available when replacement attention has no sources yet', () => {
    const pageModel = model({
      totalSharedSources: 0,
      teamSourceRows: [],
    });
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

    render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={pageModel}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Available shared sources' })).toBeTruthy();
    expect(screen.getByText(/No shared provider sources yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose replacement' }).getAttribute('href')).toBe(
      '#available-shared-sources',
    );
  });

  it('places health-paused integrations in Needs attention with a Paused notice', () => {
    render(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={model({
          connectedRows: [
            {
              ...baseConnectedRow,
              id: 'integration-paused',
              displayName: 'GitHub — paused',
              lastError: null,
              attention: [],
              healthPause: {
                kind: 'connectivity',
                pausedAt: '2026-06-28T12:00:00.000Z',
                firstFailedAt: '2026-06-25T12:00:00.000Z',
              },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText(/Paused: GitHub hasn't responded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('toasts MCP OAuth success instead of a page banner', () => {
    render(
      <SourcesPageView
        params={{ connected: '1' }}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(notify.notifySuccess).toHaveBeenCalledWith('integrations:oauth', 'MCP server connected');
    expect(screen.queryByText(/MCP server connected successfully/i)).toBeNull();
  });

  it('toasts connection errors without a page banner', () => {
    render(
      <SourcesPageView
        params={{ error: 'oauth_denied' }}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(notify.notifyError).toHaveBeenCalledWith(
      'integrations:oauth',
      'The provider denied access. Try connecting again.',
    );
    expect(screen.queryByText('oauth_denied')).toBeNull();
  });

  it('announces redirect errors after client mount, never during server rendering', () => {
    const toast = <RedirectActionToast id="ssr-contract" error="OAuth fixture denied" />;
    expect(renderToString(toast)).toBe('');
    expect(notify.notifyError).not.toHaveBeenCalled();
    render(toast);
    expect(notify.notifyError).toHaveBeenCalledTimes(1);
    expect(notify.notifyError).toHaveBeenCalledWith('ssr-contract', 'OAuth fixture denied');
  });
});
