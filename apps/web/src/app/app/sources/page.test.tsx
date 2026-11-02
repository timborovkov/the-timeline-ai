import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import type { ReactElement } from 'react';
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
await vi.mock(
  import.meta.resolve('@/app/actions/teams'),
  async () => ({
    ...(await import('@/app/actions/teams')),
    updateInboundEmailWhitelistAction: vi.fn(() => Promise.resolve({ ok: true })),
  }),
  () => import('@/app/actions/teams'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/telegram'),
  () => ({
    generatePersonalLinkTokenAction: vi.fn(() => Promise.resolve({})),
    generateGroupLinkTokenAction: vi.fn(() => Promise.resolve({})),
    revokeLinkTokenAction: vi.fn(() => Promise.resolve()),
    unbindChatAction: vi.fn(() => Promise.resolve()),
  }),
  () => import('@/app/actions/telegram'),
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

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { cleanup, render, screen, within } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { renderToString } = await import('react-dom/server');
const { RedirectActionToast } = await import('@/components/redirect-action-toast');
const { SourcesPageView } = await import('@/app/app/sources/sources-page-content');

afterEach(() => {
  notify.notifyError.mockClear();
  notify.notifySuccess.mockClear();
  cleanup();
});

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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
        id: 'linear' as const,
        label: 'Linear',
        description: 'Issues and projects.',
        logo: '/connectors/linear.svg',
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
      {
        ...baseConnectedRow,
        id: 'integration-linear',
        provider: 'linear',
        displayName: 'Linear — Acme',
        attention: [],
      },
    ],
    connectedMembers: [],
    ownedConnections: [
      {
        id: 'conn-1',
        provider: 'github',
        displayName: 'GitHub — Tim',
        lastError: null,
        lastConnectedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    mcpServerRows: [],
    ...overrides,
  };
}

async function expandAdvanced() {
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: /^Advanced / });
  if (trigger.getAttribute('aria-expanded') === 'false') {
    await user.click(trigger);
  }
  return user;
}

describe('SourcesPageView', () => {
  it('keeps one page heading and lists each native provider once', () => {
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.querySelectorAll('#github')).toHaveLength(1);
    expect(document.querySelectorAll('#linear')).toHaveLength(1);
    expect(document.querySelectorAll('#google_drive')).toHaveLength(1);
    expect(document.querySelectorAll('#slack')).toHaveLength(1);
    expect(document.querySelectorAll('#telegram')).toHaveLength(1);
    expect(document.querySelectorAll('#email')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Set up: telegram' })).toBeTruthy();
    expect(screen.getByText('Connected providers')).toBeTruthy();
    expect(screen.getByText('Available providers')).toBeTruthy();
    expect(screen.queryByText('Active team sync')).toBeNull();
    expect(screen.queryByText('Available shared sources')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Chat capture: Slack' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect: google_drive' })).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Syncing for team')).toBeTruthy();
  });

  it('filters the available provider list by search', async () => {
    const user = userEvent.setup();
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    await user.type(screen.getByLabelText('Search available providers'), 'drive');
    expect(screen.getByText('Google Drive')).toBeTruthy();
    expect(screen.queryByText('Slack')).toBeNull();
    expect(screen.queryByText('No matching providers.')).toBeNull();
  });

  it('keeps native-named MCP catalog entries off the page until that provider sheet opens', async () => {
    const user = userEvent.setup();
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model({
          mcpCatalogAvailable: [
            {
              id: 'linear',
              label: 'Linear',
              description: 'Linear MCP tools.',
              logo: '/connectors/linear.svg',
              category: 'project-management',
              kind: 'mcp',
              status: 'mcp_available',
              ingestStatus: 'coming_soon',
              featured: false,
              examplePrompt: 'What is blocked in Linear?',
            },
            {
              id: 'notion',
              label: 'Notion',
              description: 'Notion MCP tools.',
              logo: '/connectors/notion.svg',
              category: 'productivity',
              kind: 'mcp',
              status: 'mcp_available',
              ingestStatus: 'coming_soon',
              featured: false,
              examplePrompt: 'What is in the runbook?',
            },
          ],
        })}
      />,
    );

    expect(document.querySelectorAll('#linear')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Advanced / }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    await expandAdvanced();
    const advanced = screen.getByRole('button', { name: /^Advanced / }).closest('section');
    if (!advanced) throw new Error('Expected Advanced section');
    expect(within(advanced).getByText('Notion')).toBeTruthy();
    expect(within(advanced).queryByText('Linear')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open Linear details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Linear' });
    expect(within(dialog).getByText('MCP')).toBeTruthy();
  });

  it('keeps an MCP-only native-named server manageable from the provider sheet', async () => {
    const user = userEvent.setup();
    const pageModel = model({
      blockingAttentionCount: 0,
      connectedRows: [],
      ownedConnections: [],
      teamSourceRows: [],
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
    });
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary({ attention: 0 })}
        model={pageModel}
      />,
    );

    expect(document.querySelectorAll('#linear')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open Linear details' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect: linear' })).toBeNull();

    await expandAdvanced();
    const advanced = screen.getByRole('button', { name: /^Advanced / }).closest('section');
    if (!advanced) throw new Error('Expected Advanced section');
    expect(within(advanced).queryByText('Linear')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open Linear details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Linear' });
    expect(within(dialog).getByText('MCP')).toBeTruthy();
    expect(within(dialog).getByText('https://mcp.linear.app')).toBeTruthy();
  });

  it('opens a provider details sheet with accounts, team sync, and visibility', async () => {
    const user = userEvent.setup();
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open Linear details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Linear' });
    expect(within(dialog).getByText('Accounts')).toBeTruthy();
    expect(within(dialog).getByText('Team sync')).toBeTruthy();
    expect(
      within(dialog).getByRole('combobox', { name: 'Default visibility for Linear' }),
    ).toBeTruthy();
    expect(within(dialog).getAllByText('Linear — Acme').length).toBeGreaterThan(0);
  });

  it('moves Telegram and Email setup into provider sheets and keeps Advanced to agent MCP, webhooks, audit, and jobs', async () => {
    const user = userEvent.setup();
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary({
          telegramConnections: 1,
          inboundEmail: 'acme+archive@inbound.timeline.test',
        })}
        model={model()}
        inboundEmail={{
          inboundEmail: 'acme+archive@inbound.timeline.test',
          enabled: true,
          senders: ['vendor@example.test'],
          placeholderInbound: false,
        }}
      />,
    );

    expect(document.querySelectorAll('#telegram')).toHaveLength(1);
    expect(document.querySelectorAll('#email')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Telegram' })).toBeNull();
    expect(screen.queryByLabelText('Additional senders')).toBeNull();
    expect(screen.getByRole('button', { name: /^Advanced / }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'Open Telegram details' }));
    const telegram = await screen.findByRole('dialog', { name: 'Telegram' });
    expect(within(telegram).getByText('Link a personal DM')).toBeTruthy();
    expect(within(telegram).getByText('Bind a group chat')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Open Email details' }));
    const email = await screen.findByRole('dialog', { name: 'Email' });
    expect(within(email).getByLabelText('Additional senders')).toBeTruthy();
    expect(within(email).getByText('vendor@example.test')).toBeTruthy();
    expect(within(email).getByDisplayValue('acme+archive@inbound.timeline.test')).toBeTruthy();
    await user.keyboard('{Escape}');

    await expandAdvanced();
    expect(screen.queryByLabelText('Additional senders')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Telegram' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Provider accounts' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Personal MCP' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Integration audit' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Job recovery' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Agent install guide' }).getAttribute('href')).toBe(
      '/help/agents',
    );
  });

  it('keeps source actions contextual and rows responsive for keyboard and narrow-screen use', () => {
    const { container } = renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    expect(container.innerHTML).toContain('min-h-8');
    expect(container.innerHTML).toContain('sm:flex-row sm:items-center sm:gap-3');
    expect(container.innerHTML).toContain('focus-visible:ring-2 focus-visible:ring-signal/50');
    expect(container.innerHTML).toContain('bg-white');
    expect(container.innerHTML).not.toContain('rounded-md border border-border bg-surface p-4');
  });

  it('shows administrator tools only to owners and admins', async () => {
    const { rerender } = renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );
    await expandAdvanced();
    expect(screen.getByRole('link', { name: 'Integration audit' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Job recovery' })).toBeTruthy();

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <SourcesPageView
          params={{}}
          active={{ teamName: 'Acme Labs' }}
          isAdmin={false}
          summary={summary()}
          model={model({ isAdmin: false })}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /^Advanced / })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Integration audit' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Job recovery' })).toBeNull();
  });

  it('keeps the shared-source recovery action inside the provider sheet', async () => {
    const user = userEvent.setup();
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

    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={pageModel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open GitHub details' }));
    const dialog = await screen.findByRole('dialog', { name: 'GitHub' });
    expect(within(dialog).getByText(/No shared provider sources yet/i)).toBeTruthy();
    expect(
      within(dialog).getByRole('link', { name: 'Choose replacement' }).getAttribute('href'),
    ).toBe('#github-team-sources');
  });

  it('places health-paused integrations in Needs attention with a Resume control in the sheet', async () => {
    const user = userEvent.setup();
    renderPage(
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
    await user.click(screen.getByRole('button', { name: 'Open GitHub details' }));
    const dialog = await screen.findByRole('dialog', { name: 'GitHub' });
    expect(within(dialog).getByText(/Paused: GitHub hasn't responded/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('toasts MCP OAuth success instead of a page banner', () => {
    renderPage(
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
    renderPage(
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
