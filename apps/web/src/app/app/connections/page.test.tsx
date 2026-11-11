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
    default: ({
      unoptimized: _unoptimized,
      ...props
    }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => (
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
const { act, cleanup, render, screen, waitFor, within } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { renderToString } = await import('react-dom/server');
const { RedirectActionToast } = await import('@/components/redirect-action-toast');
const { SourcesPageView } = await import('@/app/app/connections/connections-page-content');

afterEach(() => {
  notify.notifyError.mockClear();
  notify.notifySuccess.mockClear();
  cleanup();
  window.history.replaceState(null, '', '/');
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

async function openTab(name: 'Sources' | 'Agent tools' | 'Developer') {
  const user = userEvent.setup();
  const tab = screen.getByRole('tab', { name });
  if (tab.getAttribute('aria-selected') !== 'true') {
    await user.click(tab);
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
    expect(screen.getByRole('link', { name: 'Set up: telegram' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sources' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Agent tools' }).getAttribute('href')).toBe(
      '/app/connections/agent-tools',
    );
    expect(screen.getByRole('tab', { name: 'Developer' }).getAttribute('href')).toBe(
      '/app/connections/developer',
    );
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(screen.getByText('Connected providers')).toBeTruthy();
    expect(screen.getByText('Available providers')).toBeTruthy();
    const available = screen.getByText('Available providers').closest('section');
    expect(available?.textContent).toMatch(/Telegram[\s\S]*Slack/u);
    expect(screen.getByLabelText('Search sources')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Documents details' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Meetings details' })).toBeNull();
    expect(screen.queryByText('Active team sync')).toBeNull();
    expect(screen.queryByText('Available shared sources')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Chat capture: Slack' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect: google_drive' })).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Syncing for team')).toBeTruthy();
  });

  it('places searchable website sources directly after email', async () => {
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
    const website = screen.getByRole('link', { name: 'Websites' });
    expect(website.getAttribute('href')).toBe('/app/connections/websites');
    const rows = [...document.querySelectorAll('[data-slot="collection-row"]')];
    const emailIndex = rows.findIndex((row) => row.textContent.includes('Email'));
    expect(rows[emailIndex + 1]?.contains(website)).toBe(true);
    expect(screen.queryByText('Website sources — add, scan, and schedule')).toBeNull();
    await user.type(screen.getByLabelText('Search sources'), 'website');
    expect(screen.getByRole('link', { name: 'Websites' })).toBeTruthy();
    expect(screen.queryByText('Email', { exact: true })).toBeNull();
    await user.clear(screen.getByLabelText('Search sources'));
    await user.type(screen.getByLabelText('Search sources'), 'drive');
    expect(screen.queryByRole('link', { name: 'Websites' })).toBeNull();
  });

  it('writes Agent tools onto its own Connections route', async () => {
    window.history.replaceState({ next: true }, '', '/app/connections/sources');
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );

    await openTab('Agent tools');
    expect(screen.getByRole('tab', { name: 'Agent tools' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(window.location.pathname).toBe('/app/connections/agent-tools');
    expect(window.location.search).toBe('');
    expect(screen.getByText('Agent access')).toBeTruthy();
    expect(screen.queryByText('Connected providers')).toBeNull();
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

    await user.type(screen.getByLabelText('Search sources'), 'drive');
    expect(screen.getByText('Google Drive')).toBeTruthy();
    expect(screen.queryByText('Slack')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open GitHub details' })).toBeNull();
    expect(screen.queryByText('No matching sources.')).toBeNull();
  });

  it('opens panel links with Enter without native anchor scrolling and preserves modified clicks', async () => {
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
    await openTab('Agent tools');
    const opener = screen.getByRole('link', { name: 'Open Agent MCP servers details' });
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    opener.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    let prevented = false;
    const recordDefault = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener('click', recordDefault);
    try {
      opener.focus();
      await user.keyboard('{Enter}');
      expect(await screen.findByRole('dialog', { name: 'Agent MCP servers' })).toBeTruthy();
      expect(prevented).toBe(true);
      expect(window.location.hash).toBe('#agent-mcp');
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(document.activeElement).toBe(opener);
      });
    } finally {
      document.removeEventListener('click', recordDefault);
    }
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
    expect(screen.queryByText('Notion')).toBeNull();

    await openTab('Agent tools');
    await user.click(screen.getByRole('link', { name: 'Open Agent MCP servers details' }));
    const agent = await screen.findByRole('dialog', { name: 'Agent MCP servers' });
    expect(within(agent).getByText('Notion')).toBeTruthy();
    expect(within(agent).queryByText('Linear')).toBeNull();
    await user.keyboard('{Escape}');

    await openTab('Sources');
    await user.click(screen.getByRole('link', { name: 'Open Linear details' }));
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
    expect(screen.getByRole('link', { name: 'Open Linear details' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect: linear' })).toBeNull();

    await openTab('Agent tools');
    expect(screen.queryByText('https://mcp.linear.app')).toBeNull();
    await openTab('Sources');

    await user.click(screen.getByRole('link', { name: 'Open Linear details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Linear' });
    expect(within(dialog).getByText('MCP')).toBeTruthy();
    expect(within(dialog).getByText('https://mcp.linear.app')).toBeTruthy();
  });

  it('opens and switches provider sheets on fragment-only navigation', async () => {
    window.history.replaceState(null, '', '/app/connections/sources');
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

    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      window.history.pushState(null, '', '/app/connections/sources#telegram');
    });
    const telegram = await screen.findByRole('dialog', { name: 'Telegram' });
    expect(within(telegram).getByText('Link a personal DM')).toBeTruthy();

    act(() => {
      window.history.pushState(null, '', '/app/connections/sources#email');
    });
    const email = await screen.findByRole('dialog', { name: 'Email' });
    expect(within(email).getByLabelText('Additional senders')).toBeTruthy();

    act(() => {
      window.location.hash = 'github';
      window.dispatchEvent(new Event('hashchange'));
    });
    const github = await screen.findByRole('dialog', { name: 'GitHub' });
    expect(within(github).getByText('Accounts')).toBeTruthy();

    act(() => {
      window.history.pushState(null, '', '/app/connections/sources#agent-mcp');
    });
    const agent = await screen.findByRole('dialog', { name: 'Agent MCP servers' });
    expect(within(agent).getByText(/live tool access/i)).toBeTruthy();
    expect(within(agent).getByText(/team-visible evidence/i)).toBeTruthy();
    expect(
      within(agent).getByText(/personal-server results stay private to the owner/i),
    ).toBeTruthy();
    expect(within(agent).queryByText(/captured as private evidence/i)).toBeNull();
    expect(within(agent).queryByText(/team-server results are captured as private/i)).toBeNull();
    expect(
      screen.getByRole('tab', { name: 'Agent tools', hidden: true }).getAttribute('aria-selected'),
    ).toBe('true');

    act(() => {
      window.history.pushState(null, '', '/app/connections/sources#github-team-sources');
    });
    const githubSection = await screen.findByRole('dialog', { name: 'GitHub' });
    expect(within(githubSection).getByRole('heading', { name: 'Team sync' })).toBeTruthy();
    expect(document.getElementById('github-team-sources')).toBeTruthy();
  });

  it('lists Figma and other local-only MCP entries as Coming soon without a connect action', async () => {
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary()}
        model={model({
          mcpCatalogAvailable: [
            {
              id: 'figma',
              label: 'Figma',
              description: 'Design file activity.',
              logo: '/connectors/figma.svg',
              category: 'productivity',
              kind: 'mcp',
              status: 'mcp_local',
              ingestStatus: 'coming_soon',
              featured: true,
              examplePrompt: 'Show recent design changes.',
            },
            {
              id: 'hubspot',
              label: 'HubSpot',
              description: 'CRM ingestion is planned.',
              logo: '/connectors/hubspot.svg',
              category: 'crm',
              kind: 'mcp',
              status: 'coming_soon',
              ingestStatus: 'coming_soon',
              featured: true,
              examplePrompt: 'Which deals slipped?',
            },
          ],
        })}
      />,
    );

    expect(screen.queryByText('Figma')).toBeNull();
    expect(screen.queryByText('Local setup only')).toBeNull();
    const user = await openTab('Agent tools');
    expect(screen.getByLabelText('Search agent tools')).toBeTruthy();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(screen.getByText('Figma')).toBeTruthy();
    expect(screen.getByText('HubSpot')).toBeTruthy();
    await user.type(screen.getByLabelText('Search agent tools'), 'figma');
    expect(screen.getByText('Figma')).toBeTruthy();
    expect(screen.queryByText('HubSpot')).toBeNull();
    await user.clear(screen.getByLabelText('Search agent tools'));
    expect(screen.queryByText('Local setup only')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Local setup only' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Open Agent MCP servers details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Agent MCP servers' });
    expect(within(dialog).queryByText('Figma')).toBeNull();
    expect(within(dialog).queryByText('Local setup only')).toBeNull();
  });

  it('keeps Agent MCP servers when search matches a catalog tool or connected server', async () => {
    const user = userEvent.setup();
    renderPage(
      <SourcesPageView
        params={{}}
        active={{ teamName: 'Acme Labs' }}
        isAdmin
        summary={summary({ attention: 0 })}
        model={model({
          blockingAttentionCount: 0,
          mcpCatalogAvailable: [
            {
              id: 'notion',
              label: 'Notion',
              description: 'Workspace pages and databases.',
              logo: '/connectors/notion.svg',
              category: 'productivity',
              kind: 'mcp',
              status: 'mcp_available',
              ingestStatus: 'coming_soon',
              featured: false,
              examplePrompt: 'What is in the runbook?',
            },
          ],
          mcpServerRows: [
            {
              id: 'mcp-stripe',
              name: 'Stripe MCP',
              url: 'https://mcp.stripe.com',
              authType: 'oauth',
              enabled: true,
              cachedTools: [],
              disabledTools: [],
              toolsCachedAt: null,
              lastError: null,
            },
          ],
        })}
      />,
    );

    await openTab('Agent tools');
    expect(screen.getByText('Agent MCP servers')).toBeTruthy();
    expect(screen.getByText('Timeline MCP endpoint')).toBeTruthy();

    await user.type(screen.getByLabelText('Search agent tools'), 'notion');
    expect(screen.getByText('Agent MCP servers')).toBeTruthy();
    expect(screen.queryByText('Timeline MCP endpoint')).toBeNull();
    expect(screen.queryByText('No matching tools.')).toBeNull();

    await user.clear(screen.getByLabelText('Search agent tools'));
    await user.type(screen.getByLabelText('Search agent tools'), 'stripe');
    expect(screen.getByText('Agent MCP servers')).toBeTruthy();
    expect(screen.queryByText('Timeline MCP endpoint')).toBeNull();
    expect(screen.queryByText('No matching tools.')).toBeNull();

    await user.clear(screen.getByLabelText('Search agent tools'));
    await user.type(screen.getByLabelText('Search agent tools'), 'figma-not-a-tool');
    expect(screen.getByText('No matching tools.')).toBeTruthy();
    expect(screen.queryByText('Agent MCP servers')).toBeNull();
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

    await user.click(screen.getByRole('link', { name: 'Open Linear details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Linear' });
    expect(within(dialog).getByText('Accounts')).toBeTruthy();
    expect(within(dialog).getByText('Team sync')).toBeTruthy();
    expect(
      within(dialog).getByRole('combobox', { name: 'Default visibility for Linear' }),
    ).toBeTruthy();
    expect(within(dialog).getAllByText('Linear — Acme').length).toBeGreaterThan(0);
  });

  it('opens Google Drive details with accounts, team sync, and the resource picker', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          resources: [{ kind: 'drive.folder', externalId: 'folder-1', label: 'Clients' }],
          shares: [],
        }),
        { status: 200 },
      ),
    );
    const pageModel = model();
    try {
      renderPage(
        <SourcesPageView
          params={{}}
          active={{ teamName: 'Acme Labs' }}
          isAdmin
          summary={summary()}
          model={model({
            ownedConnections: [
              ...pageModel.ownedConnections,
              {
                id: 'conn-drive',
                provider: 'google_drive',
                displayName: 'Google Drive — Tim',
                lastError: null,
                lastConnectedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
            teamSourceRows: [
              ...pageModel.teamSourceRows,
              {
                share: {
                  id: 'share-drive',
                  providerConnectionId: 'conn-drive',
                  resourceKind: 'drive.folder',
                  externalId: 'folder-1',
                  externalLabel: 'Clients',
                  revokedAt: null,
                },
                connection: {
                  id: 'conn-drive',
                  provider: 'google_drive',
                  displayName: 'Google Drive — Tim',
                  lastError: null,
                  lastConnectedAt: '2026-06-01T00:00:00.000Z',
                  ownerLabel: 'Tim',
                  ownerUserId: 'user-1',
                },
              },
            ],
            connectedRows: [
              ...pageModel.connectedRows,
              {
                ...baseConnectedRow,
                id: 'integration-drive',
                provider: 'google_drive',
                displayName: 'Google Drive — Tim',
                attention: [],
              },
            ],
          })}
        />,
      );

      await user.click(screen.getByRole('link', { name: 'Open Google Drive details' }));
      const dialog = await screen.findByRole('dialog', { name: 'Google Drive' });
      expect(within(dialog).getByText('Accounts')).toBeTruthy();
      expect(within(dialog).getByText('Team sync')).toBeTruthy();
      expect(
        within(dialog).getByRole('combobox', { name: 'Default visibility for Google Drive' }),
      ).toBeTruthy();
      const picker = dialog.querySelector(
        '[data-slot="provider-resource-picker"][data-provider="google_drive"]',
      );
      expect(picker).toBeTruthy();
      if (!(picker instanceof HTMLElement)) throw new Error('Expected Drive resource picker');
      expect(await within(picker).findByRole('checkbox', { name: /Clients/i })).toBeTruthy();
      expect(within(dialog).getByText('Team sync')).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('moves Telegram and Email setup into provider sheets and keeps agent MCP, webhooks, audit, and jobs on their tabs', async () => {
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
    expect(screen.queryByRole('button', { name: /^Advanced / })).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Open Telegram details' }));
    const telegram = await screen.findByRole('dialog', { name: 'Telegram' });
    expect(within(telegram).getByText('Link a personal DM')).toBeTruthy();
    expect(within(telegram).getByText('Bind a group chat')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('link', { name: 'Open Email details' }));
    const email = await screen.findByRole('dialog', { name: 'Email' });
    expect(within(email).getByLabelText('Additional senders')).toBeTruthy();
    expect(within(email).getByText('vendor@example.test')).toBeTruthy();
    expect(within(email).getByDisplayValue('acme+archive@inbound.timeline.test')).toBeTruthy();
    await user.keyboard('{Escape}');

    await openTab('Agent tools');
    expect(screen.queryByLabelText('Additional senders')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Telegram' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Provider accounts' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Personal MCP' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Open Timeline MCP endpoint details' }));
    const timelineMcp = await screen.findByRole('dialog', { name: 'Timeline MCP endpoint' });
    expect(
      within(timelineMcp).getByRole('link', { name: 'Agent install guide' }).getAttribute('href'),
    ).toBe('/help/agents');
    await user.keyboard('{Escape}');

    await openTab('Developer');
    expect(screen.getByText('Admin tools')).toBeTruthy();
    expect(screen.queryByLabelText('Search sources')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Integration audit' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Job recovery' })).toBeTruthy();
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
    expect(container.innerHTML).toContain('@container/collection-row');
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
    await openTab('Developer');
    expect(screen.getByText('Admin tools')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Integration audit' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Job recovery' })).toBeTruthy();

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
    await openTab('Developer');
    expect(screen.queryByRole('link', { name: 'Open Integration audit' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Job recovery' })).toBeNull();
    expect(screen.getByText('Developer tools are admin-only')).toBeTruthy();
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

    await user.click(screen.getByRole('link', { name: 'Open GitHub details' }));
    const dialog = await screen.findByRole('dialog', { name: 'GitHub' });
    expect(within(dialog).getByText(/No shared provider sources yet/i)).toBeTruthy();
    expect(
      within(dialog).getByRole('link', { name: 'Choose replacement' }).getAttribute('href'),
    ).toBe('#github-team-sources');

    await user.click(within(dialog).getByRole('link', { name: 'Choose replacement' }));
    const stillOpen = await screen.findByRole('dialog', { name: 'GitHub' });
    expect(window.location.hash).toBe('#github-team-sources');
    expect(within(stillOpen).getByRole('heading', { name: 'Team sync' })).toBeTruthy();
    expect(document.getElementById('github-team-sources')).toBeTruthy();
  });

  it('does not reopen a ?integrationId= sheet after Escape from an in-sheet section', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      null,
      '',
      '/app/connections/sources?integrationId=integration-needs-help',
    );
    const pageModel = model();
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
        params={{ integrationId: 'integration-needs-help' }}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={pageModel}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'GitHub' });
    await user.click(within(dialog).getByRole('link', { name: 'Choose replacement' }));
    expect(window.location.hash).toBe('#github-team-sources');
    expect(
      within(await screen.findByRole('dialog', { name: 'GitHub' })).getByRole('heading', {
        name: 'Team sync',
      }),
    ).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash === '' || window.location.hash === '#').toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not reopen a ?integrationId= sheet after the close button dismisses it', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      null,
      '',
      '/app/connections/sources?integrationId=integration-needs-help',
    );
    renderPage(
      <SourcesPageView
        params={{ integrationId: 'integration-needs-help' }}
        active={{ teamName: 'Acme' }}
        isAdmin
        summary={summary()}
        model={model()}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'GitHub' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
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
    await user.click(screen.getByRole('link', { name: 'Open GitHub details' }));
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
