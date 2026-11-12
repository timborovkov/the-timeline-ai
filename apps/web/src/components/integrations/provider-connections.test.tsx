import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { ReactElement } from 'react';
// Test environment: happy-dom

const notify = vi.hoisted(() => ({
  notifyAction: vi.fn(
    async ({ run }: { run: () => Promise<{ error?: string }>; success?: string }) => {
      try {
        return await run();
      } catch {
        return { error: 'failed' };
      }
    },
  ),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  () => notify,
  () => import('@/lib/notify'),
);

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { PersonalConnectionsUi, TeamSourcesUi } =
  await import('@/components/integrations/provider-connections');

function installNotifyAction() {
  notify.notifyAction.mockImplementation(
    async ({ run }: { run: () => Promise<{ error?: string }> }) => {
      try {
        return await run();
      } catch {
        return { error: 'failed' };
      }
    },
  );
}

beforeEach(() => {
  installNotifyAction();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  notify.notifyAction.mockClear();
  cleanup();
});

function fetchHref(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function renderWithQueryClient(ui: ReactElement, options?: { staleTime?: number }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: options?.staleTime ?? 0 } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const baseConnection = {
  provider: 'github',
  displayName: 'GitHub',
  lastError: null,
  lastConnectedAt: '2026-06-01T00:00:00.000Z',
};

function row(input: {
  id: string;
  connectionId: string;
  ownerLabel: string;
  sourceExternalId?: string;
  provider?: string;
  resourceKind?: string;
  externalLabel?: string;
  driveLink?: {
    integrationId: string;
    selectionId: string;
    linkedObjectId: string | null;
  };
}) {
  return {
    share: {
      id: input.id,
      providerConnectionId: input.connectionId,
      resourceKind: input.resourceKind ?? 'github.repo',
      externalId: input.sourceExternalId ?? 'repo-1',
      externalLabel: input.externalLabel ?? 'Acme Repo',
      revokedAt: null,
    },
    connection: {
      ...baseConnection,
      ...(input.provider ? { provider: input.provider } : {}),
      id: input.connectionId,
      ownerLabel: input.ownerLabel,
      ownerUserId: `${input.connectionId}-owner`,
    },
    ...(input.driveLink ? { driveLink: input.driveLink } : {}),
  };
}

describe('PersonalConnectionsUi', () => {
  it('labels each provider account region with its provider and account name', async () => {
    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          { ...baseConnection, id: 'connection-region', displayName: 'GitHub — Avery' },
        ]}
      />,
    );

    expect(
      await screen.findByRole('region', { name: 'GitHub account GitHub — Avery' }),
    ).toBeTruthy();
  });
  it('explains GitHub source sharing before team activation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          resources: [
            { kind: 'github.org', externalId: 'acme', label: 'acme (all accessible repos)' },
            { kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' },
          ],
          shares: [],
        }),
        { status: 200 },
      ),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-a',
            provider: 'github',
            displayName: 'GitHub — taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText('2. Shared sources')).toBeTruthy();
    expect(screen.queryByText(/add another Monday\.com account/i)).toBeNull();
    expect(screen.getByText(/choose a GitHub organization/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /GitHub access/i })).toBeTruthy();
  });

  it('explains source sharing for Monday.com, Slack, and Sentry connections', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url =
        input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
      const resourcesByConnection: Record<
        string,
        { kind: string; externalId: string; label: string }[]
      > = {
        monday: [{ kind: 'monday.board', externalId: 'board-1', label: 'Launch' }],
        slack: [{ kind: 'slack.channel', externalId: 'C123', label: '#leadership' }],
        sentry: [{ kind: 'sentry.project', externalId: 'acme/web', label: 'acme/web' }],
      };
      const connectionId = url.split('/').at(-2) ?? '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            resources: resourcesByConnection[connectionId] ?? [],
            shares: [],
          }),
          { status: 200 },
        ),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'monday',
            provider: 'monday',
            displayName: 'Monday.com — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
          {
            id: 'slack',
            provider: 'slack',
            displayName: 'Slack — Acme',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
          {
            id: 'sentry',
            provider: 'sentry',
            displayName: 'Sentry — Acme',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText(/Choose Monday.com boards/i)).toBeTruthy();
    expect(screen.getByText(/To add another Monday\.com account/i)).toBeTruthy();
    expect(screen.getByText(/parent board already imports them/i)).toBeTruthy();
    expect(await screen.findByText(/Board items, updates, columns, and subitems/i)).toBeTruthy();
    expect(screen.getByText(/Choose the Slack channels/i)).toBeTruthy();
    expect(screen.getByText(/Choose individual Sentry projects/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /GitHub access/i })).toBeNull();
  });

  it('finds parent Monday.com boards when searching for subitems', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          resources: [
            {
              kind: 'monday.board',
              externalId: 'board-1',
              label: 'KIESI',
              searchText: 'KIESI monday.com board items updates columns subitems',
            },
            {
              kind: 'monday.doc',
              externalId: 'doc-1',
              label: 'Launch notes',
              searchText: 'Launch notes monday.com WorkDoc',
            },
          ],
          shares: [],
        }),
        { status: 200 },
      ),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'monday',
            provider: 'monday',
            displayName: 'Monday.com — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('KIESI');
    await user.type(screen.getByRole('textbox', { name: 'Search sources' }), 'subitems');

    expect(screen.getByText('KIESI')).toBeTruthy();
    expect(screen.queryByText('Launch notes')).toBeNull();
  });

  it('explains when a successful provider query returns no shareable sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ resources: [], shares: [] }), { status: 200 }),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-a',
            provider: 'github',
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText('No shareable sources found')).toBeTruthy();
    expect(
      screen.getByText(/does not currently expose any sources you can share with this team/i),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('gives an empty provider-account list a direct path to connect an account', () => {
    render(<PersonalConnectionsUi connections={[]} connectProviderHref="#connect-provider" />);

    expect(screen.getByText('No provider accounts yet')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Connect a provider account' }).getAttribute('href'),
    ).toBe('#connect-provider');
  });

  it('waits for shared sources before enabling save', async () => {
    let resolveResources: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResources = resolve;
        }),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-a',
            provider: 'github',
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByLabelText('Loading provider sources')).toBeTruthy();
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save sharing' });
    expect(save.disabled).toBe(true);

    resolveResources?.(
      new Response(
        JSON.stringify({
          resources: [{ kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' }],
          shares: [],
        }),
        { status: 200 },
      ),
    );

    await screen.findByText('acme/app');
    expect(save.disabled).toBe(false);
  });

  it('retries loading provider sources instead of only dismissing the error', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'request_failed' }), { status: 502 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resources: [{ kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' }],
            shares: [],
          }),
          { status: 200 },
        ),
      );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-a',
            provider: 'github',
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    const retry = await screen.findByRole('button', { name: 'Retry loading sources' });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save sharing' }).disabled).toBe(
      true,
    );

    await user.click(retry);

    expect(await screen.findByText('acme/app')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save sharing' }).disabled).toBe(
      false,
    );
  });

  it('keeps destructive-account confirmation keyboard reachable and cancellable', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          resources: [{ kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' }],
          shares: [],
        }),
        { status: 200 },
      ),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-a',
            provider: 'github',
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('acme/app');
    const accountActions = screen.getByRole('button', {
      name: 'Actions for this provider account',
    });
    accountActions.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Delete account' })).toBeTruthy();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('region', { name: 'Confirm provider account deletion' })).toBeTruthy();

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Delete provider account' }),
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));

    await user.keyboard('{Enter}');

    expect(accountActions.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(accountActions);
  });
  it('lets keyboard users clear a search with no matching sources', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          resources: [{ kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' }],
          shares: [],
        }),
        { status: 200 },
      ),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-a',
            provider: 'github',
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    const search = await screen.findByRole('textbox', { name: 'Search sources' });
    await user.type(search, 'missing');

    expect(await screen.findByText('No sources match “missing”')).toBeTruthy();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear search' }));

    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByText('acme/app')).toBeTruthy();
  });

  it('describes every known provider resource kind in the source picker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          resources: [
            { kind: 'drive.folder', externalId: 'root', label: 'My Drive (root)' },
            { kind: 'drive.shared_drive', externalId: 'drive-1', label: 'Engineering' },
            { kind: 'linear.team', externalId: 'team-1', label: 'Product' },
            { kind: 'sentry.org', externalId: 'acme', label: 'Acme (all projects)' },
          ],
          shares: [],
        }),
        { status: 200 },
      ),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-a',
            provider: 'google_drive',
            displayName: 'Google Drive — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText('Folder')).toBeTruthy();
    expect(screen.getByText('Shared drive')).toBeTruthy();
    expect(screen.getByText(/Team issues, projects, comments, and workflow changes/i)).toBeTruthy();
    expect(screen.getByText(/All accessible projects in this organization/i)).toBeTruthy();
  });

  it('keeps Drive sharing copy short and the save control next to the account header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          resources: [{ kind: 'drive.folder', externalId: 'root', label: 'My Drive (root)' }],
          shares: [],
        }),
        { status: 200 },
      ),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-drive',
            provider: 'google_drive',
            displayName: 'Google Drive — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    const region = await screen.findByRole('region', {
      name: 'Google Drive account Google Drive — Taylor',
    });
    expect(await screen.findByRole('checkbox', { name: /My Drive \(root\)/i })).toBeTruthy();
    expect(screen.getByText('0 sources shared')).toBeTruthy();
    expect(screen.getByText(/Choose My Drive, a folder, a shared drive/i)).toBeTruthy();
    expect(screen.queryByText(/changes\.watch/i)).toBeNull();
    expect(screen.queryByText(/quiet editing window/i)).toBeNull();
    expect(screen.queryByText(/Shared with me/i)).toBeNull();
    expect(region.querySelector('[class*="bg-signal-soft"]')).toBeNull();
    expect(region.querySelector('[class*="rounded-sm border"][class*="max-h-72"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save sharing' })).toBeTruthy();
  });

  it('browses Drive folders through parentId', async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = fetchHref(input);
      requests.push(url);
      const resources = url.includes('parentId=folder-1')
        ? [{ kind: 'drive.file', externalId: 'doc-1', label: 'SOW' }]
        : [{ kind: 'drive.folder', externalId: 'folder-1', label: 'Clients' }];
      return Promise.resolve(
        new Response(JSON.stringify({ resources, shares: [] }), { status: 200 }),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-drive',
            provider: 'google_drive',
            displayName: 'Google Drive — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText('Clients')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(requests.some((url) => url.includes('parentId=folder-1'))).toBe(true);
    });
    expect(await screen.findByText('SOW')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Google Drive folders' })).toBeTruthy();
    expect(
      document.querySelector(
        '[data-slot="provider-resource-picker"][data-provider="google_drive"]',
      ),
    ).toBeTruthy();
  });

  it('keeps the Drive resource picker in the compact details-sheet slot', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = fetchHref(input);
      const resources = url.includes('parentId=folder-1')
        ? [{ kind: 'drive.file', externalId: 'doc-1', label: 'SOW' }]
        : [{ kind: 'drive.folder', externalId: 'folder-1', label: 'Clients' }];
      return Promise.resolve(
        new Response(JSON.stringify({ resources, shares: [] }), { status: 200 }),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        compact
        connections={[
          {
            id: 'conn-drive',
            provider: 'google_drive',
            displayName: 'Google Drive — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText('Clients')).toBeTruthy();
    expect(
      document.querySelector(
        '[data-slot="provider-resource-picker"][data-provider="google_drive"]',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('SOW')).toBeTruthy();
  });

  it('keeps an unsaved Drive folder selection after opening another folder', async () => {
    const user = userEvent.setup();
    const requests: { method: string; url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = fetchHref(input);
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        const bodyText = typeof init?.body === 'string' ? init.body : null;
        requests.push({ method, url, body: bodyText ? JSON.parse(bodyText) : null });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      requests.push({ method, url, body: null });
      const resources = url.includes('parentId=folder-1')
        ? [{ kind: 'drive.file', externalId: 'doc-1', label: 'SOW' }]
        : [{ kind: 'drive.folder', externalId: 'folder-1', label: 'Clients' }];
      return Promise.resolve(
        new Response(JSON.stringify({ resources, shares: [] }), { status: 200 }),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-drive',
            provider: 'google_drive',
            displayName: 'Google Drive — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText('Clients')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /Clients/i }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('SOW')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Save sharing/i }));

    await waitFor(() => {
      expect(requests.some((request) => request.method === 'PUT')).toBe(true);
    });
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
      resources: [{ kind: 'drive.folder', externalId: 'folder-1', label: 'Clients' }],
    });
  });

  it('invalidates every Drive picker query after saving shares', async () => {
    const user = userEvent.setup();
    const gets: string[] = [];
    let saved = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = fetchHref(input);
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        saved = true;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      gets.push(url);
      const isFolder = url.includes('parentId=folder-1');
      const shares = saved
        ? [
            {
              id: 'share-doc',
              providerConnectionId: 'conn-drive',
              resourceKind: 'drive.file',
              externalId: 'doc-1',
              externalLabel: 'SOW',
              revokedAt: null,
            },
          ]
        : [];
      const resources = isFolder
        ? [{ kind: 'drive.file', externalId: 'doc-1', label: 'SOW' }]
        : [{ kind: 'drive.folder', externalId: 'folder-1', label: 'Clients' }];
      return Promise.resolve(new Response(JSON.stringify({ resources, shares }), { status: 200 }));
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-drive',
            provider: 'google_drive',
            displayName: 'Google Drive — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
      { staleTime: 30_000 },
    );

    expect(await screen.findByText('Clients')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('SOW')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /SOW/i }));
    const rootGetsBeforeSave = gets.filter(
      (url) => url.includes('/resources') && !url.includes('parentId') && !url.includes('query='),
    ).length;
    await user.click(screen.getByRole('button', { name: /Save sharing/i }));
    await user.click(screen.getByRole('button', { name: 'Google Drive' }));
    await waitFor(() => {
      const rootGets = gets.filter(
        (url) => url.includes('/resources') && !url.includes('parentId') && !url.includes('query='),
      );
      expect(rootGets.length).toBeGreaterThan(rootGetsBeforeSave);
    });
  });

  it('drops stale monday helper-board shares that are absent from live resources', async () => {
    const user = userEvent.setup();
    const requests: { method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        const bodyText = typeof init?.body === 'string' ? init.body : null;
        requests.push({
          method,
          body: bodyText ? JSON.parse(bodyText) : null,
        });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      requests.push({ method, body: null });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            resources: [{ kind: 'monday.board', externalId: 'board-1', label: 'KIESI' }],
            shares: [
              {
                id: 'share-hidden',
                providerConnectionId: 'monday',
                resourceKind: 'monday.board',
                externalId: 'subitems-board-1',
                externalLabel: 'Subitems of KIESI',
                revokedAt: null,
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'monday',
            provider: 'monday',
            displayName: 'Monday.com — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('KIESI');
    await user.click(screen.getByRole('button', { name: /Save sharing/i }));

    await waitFor(() => {
      expect(requests.some((request) => request.method === 'PUT')).toBe(true);
    });
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({ resources: [] });
  });

  it('preserves monday WorkDoc shares when document discovery is temporarily incomplete', async () => {
    const user = userEvent.setup();
    const requests: { method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        const bodyText = typeof init?.body === 'string' ? init.body : null;
        requests.push({ method, body: bodyText ? JSON.parse(bodyText) : null });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            resources: [{ kind: 'monday.board', externalId: 'board-1', label: 'KIESI' }],
            shares: [
              {
                id: 'share-doc',
                providerConnectionId: 'monday',
                resourceKind: 'monday.doc',
                externalId: 'doc-1',
                externalLabel: 'Launch notes',
                revokedAt: null,
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'monday',
            provider: 'monday',
            displayName: 'Monday.com — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('KIESI');
    await user.click(screen.getByRole('button', { name: /Save sharing/i }));

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]?.body).toEqual({
      resources: [{ kind: 'monday.doc', externalId: 'doc-1', label: 'Launch notes' }],
    });
  });

  it('lets users revoke active shares that are hidden from the live resource list', async () => {
    const user = userEvent.setup();
    const requests: { method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        const bodyText = typeof init?.body === 'string' ? init.body : null;
        requests.push({
          method,
          body: bodyText ? JSON.parse(bodyText) : null,
        });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      requests.push({ method, body: null });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            resources: [{ kind: 'github.repo', externalId: 'acme/current', label: 'acme/current' }],
            shares: [
              {
                id: 'share-hidden',
                providerConnectionId: 'github',
                resourceKind: 'github.repo',
                externalId: 'acme/legacy',
                externalLabel: 'acme/legacy',
                revokedAt: null,
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'github',
            provider: 'github',
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('acme/current');
    const hiddenShare = await screen.findByLabelText(/acme\/legacy/i);
    await user.click(hiddenShare);
    await user.click(screen.getByRole('button', { name: /Save sharing/i }));

    await waitFor(() => {
      expect(requests.some((request) => request.method === 'PUT')).toBe(true);
    });
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
      resources: [],
    });
  });

  it('keeps internal provider details out of JSON error displays', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Monday GraphQL errors: Unauthorized field or type' }), {
        status: 502,
      }),
    );

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'monday',
            provider: 'monday',
            displayName: 'Monday.com — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Request failed (502)');
    expect(alert.textContent).not.toContain('Monday GraphQL errors: Unauthorized field or type');
  });

  it('maps provider account delete JSON errors to readable copy', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'disconnect_failed' }), { status: 500 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ resources: [], shares: [] }), { status: 200 }),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'github',
            provider: 'github',
            displayName: 'GitHub — Taylor',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('GitHub — Taylor');
    await user.click(screen.getByRole('button', { name: 'Actions for this provider account' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Delete provider account' }));

    await waitFor(() => {
      expect(notify.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'connection:github:delete',
          error: 'Couldn’t delete provider account',
        }),
      );
    });
    expect(screen.queryByText(/Could not disconnect this connection/i)).toBeNull();
  });

  it('shows Google Drive Limited Use before reconnect OAuth starts', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (fetchHref(input).includes('/api/integrations/google_drive/start')) {
        return Promise.resolve(
          new Response(JSON.stringify({ url: 'https://accounts.google.com/o' }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ resources: [], shares: [] }), { status: 200 }),
      );
    });

    renderWithQueryClient(
      <PersonalConnectionsUi
        connections={[
          {
            id: 'conn-drive',
            provider: 'google_drive',
            displayName: 'Google Drive — Taylor',
            lastError: 'token_revoked',
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByRole('button', { name: 'Reconnect' });
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(screen.getByRole('dialog', { name: 'Connect Google Drive' })).toBeTruthy();
    expect(
      fetchMock.mock.calls.some((call) =>
        fetchHref(call[0]).includes('/api/integrations/google_drive/start'),
      ),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Continue to Google' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          fetchHref(call[0]).includes('/api/integrations/google_drive/start'),
        ),
      ).toBe(true);
    });
  });

  it('lets admins link an active Drive source to a Timeline object', async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = fetchHref(input);
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') {
        patches.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (url.includes('/api/objects/search')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [{ id: 'object-1', canonicalName: 'Northstar', type: 'project' }],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    renderWithQueryClient(
      <TeamSourcesUi
        isAdmin
        activeShareIds={['share-drive']}
        rows={[
          row({
            id: 'share-drive',
            connectionId: 'conn-drive',
            ownerLabel: 'Taylor',
            provider: 'google_drive',
            resourceKind: 'drive.file',
            sourceExternalId: 'file-1',
            externalLabel: 'SOW',
            driveLink: {
              integrationId: 'integration-drive',
              selectionId: 'selection-drive',
              linkedObjectId: null,
            },
          }),
        ]}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'Link Drive source to a Timeline object' }),
      'North',
    );
    expect(await screen.findByRole('button', { name: 'Northstar' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Northstar' }));
    await waitFor(() => {
      expect(patches).toEqual([{ linkedObjectId: 'object-1' }]);
    });
  });

  it('explains that admins activate shared team sources', () => {
    render(
      <TeamSourcesUi
        isAdmin
        activeShareIds={[]}
        rows={[row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Taylor' })]}
      />,
    );

    expect(screen.getByText(/Shared sources are not syncing yet/i)).toBeTruthy();
    expect(screen.getByText(/Select the sources this team should import/i)).toBeTruthy();
  });

  it('confirms that an initial backfill was queued after team activation', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          integrationId: 'integration-1',
          syncRequired: true,
          syncQueued: true,
        }),
        { status: 200 },
      ),
    );
    render(
      <TeamSourcesUi
        isAdmin
        activeShareIds={[]}
        rows={[row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Taylor' })]}
      />,
    );

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Activate team sync' }));

    await waitFor(() => {
      expect(notify.notifyAction).toHaveBeenCalled();
    });
    const success = notify.notifyAction.mock.calls.at(-1)?.[0]?.success;
    expect(typeof success === 'string' ? success : String(success)).toBe(
      'Initial import queued. Older items will be available after the first sync completes.',
    );
    expect(screen.queryByText(/Initial import queued/i)).toBeNull();
  });

  it('does not tell non-admins to select and save shared team sources', () => {
    render(
      <TeamSourcesUi
        isAdmin={false}
        activeShareIds={[]}
        rows={[row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Taylor' })]}
      />,
    );

    expect(
      screen.getByText(/A team admin chooses which shared sources this team imports/i),
    ).toBeTruthy();
    expect(screen.queryByText(/then activate team sync/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Activate team sync|Save team sync/i })).toBeNull();
  });

  it('shows owner labels and replacement action for another active source owner', async () => {
    const user = userEvent.setup();
    render(
      <TeamSourcesUi
        isAdmin
        activeShareIds={['share-a']}
        rows={[
          row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Taylor' }),
          row({ id: 'share-b', connectionId: 'conn-b', ownerLabel: 'Ada' }),
        ]}
      />,
    );

    expect(screen.getByText('Provider account owner: Taylor')).toBeTruthy();
    expect(screen.getByText('Provider account owner: Ada')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save team sync' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activate team sync' })).toBeTruthy();
    expect(screen.getAllByText('Shared, not syncing')).toHaveLength(1);

    const checkboxes = screen.getAllByRole('checkbox');
    const replacementCheckbox = checkboxes[1];
    if (!replacementCheckbox) throw new Error('Expected replacement checkbox');
    await user.click(replacementCheckbox);

    expect(screen.getByRole('button', { name: 'Replace active import' })).toBeTruthy();
  });

  it('updates selected sources when refreshed active shares change', () => {
    const rows = [
      row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Taylor' }),
      row({ id: 'share-b', connectionId: 'conn-b', ownerLabel: 'Ada', sourceExternalId: 'repo-2' }),
    ];
    const { rerender } = render(<TeamSourcesUi isAdmin activeShareIds={['share-a']} rows={rows} />);

    let checkboxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);

    rerender(<TeamSourcesUi isAdmin activeShareIds={['share-b']} rows={rows} />);

    checkboxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(checkboxes[0]?.checked).toBe(false);
    expect(checkboxes[1]?.checked).toBe(true);
  });
});
