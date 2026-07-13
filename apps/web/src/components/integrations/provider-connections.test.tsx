// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReactElement } from 'react';

import {
  PersonalConnectionsUi,
  TeamSourcesUi,
} from '@/components/integrations/provider-connections';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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
}) {
  return {
    share: {
      id: input.id,
      providerConnectionId: input.connectionId,
      resourceKind: 'github.repo',
      externalId: input.sourceExternalId ?? 'repo-1',
      externalLabel: 'Acme Repo',
      revokedAt: null,
    },
    connection: {
      ...baseConnection,
      id: input.connectionId,
      ownerLabel: input.ownerLabel,
      ownerUserId: `${input.connectionId}-owner`,
    },
  };
}

describe('TeamSourcesUi', () => {
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
            displayName: 'GitHub — tim',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText('2. Shared sources')).toBeTruthy();
    expect(screen.getByText(/Need a second Monday\.com account/i)).toBeTruthy();
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
            displayName: 'Monday.com — Tim',
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
            displayName: 'Monday.com — Tim',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('KIESI');
    await user.type(screen.getByRole('textbox', { name: /Search provider sources/i }), 'subitems');

    expect(screen.getByText('KIESI')).toBeTruthy();
    expect(screen.queryByText('Launch notes')).toBeNull();
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
            displayName: 'Google Drive — Tim',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(await screen.findByText(/Folder files imported into the document drive/i)).toBeTruthy();
    expect(screen.getByText(/Shared drive files imported into the document drive/i)).toBeTruthy();
    expect(screen.getByText(/Team issues, projects, comments, and workflow changes/i)).toBeTruthy();
    expect(screen.getByText(/All accessible projects in this organization/i)).toBeTruthy();
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
            displayName: 'Monday.com — Tim',
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
            displayName: 'Monday.com — Tim',
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
            displayName: 'GitHub — Tim',
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

  it('surfaces provider resource errors from JSON responses', async () => {
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
            displayName: 'Monday.com — Tim',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(
      await screen.findByText(/Monday GraphQL errors: Unauthorized field or type/i),
    ).toBeTruthy();
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
            displayName: 'GitHub — Tim',
            lastError: null,
            lastConnectedAt: '2026-06-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    await screen.findByText('GitHub — Tim');
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Delete provider account' }));

    expect(await screen.findByText(/Could not disconnect this connection/i)).toBeTruthy();
  });

  it('explains that admins activate shared team sources', () => {
    render(
      <TeamSourcesUi
        isAdmin
        activeShareIds={[]}
        rows={[row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Tim' })]}
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
        rows={[row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Tim' })]}
      />,
    );

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Activate team sync' }));

    expect(await screen.findByText(/Initial import queued/i)).toBeTruthy();
    expect(screen.getByText(/Older items will be available after the first sync/i)).toBeTruthy();
  });

  it('does not tell non-admins to select and save shared team sources', () => {
    render(
      <TeamSourcesUi
        isAdmin={false}
        activeShareIds={[]}
        rows={[row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Tim' })]}
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
          row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Tim' }),
          row({ id: 'share-b', connectionId: 'conn-b', ownerLabel: 'Ada' }),
        ]}
      />,
    );

    expect(screen.getByText('Provider account owner: Tim')).toBeTruthy();
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
      row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Tim' }),
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
