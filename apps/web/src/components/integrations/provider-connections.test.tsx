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

    expect(await screen.findByText('2. Share to this team')).toBeTruthy();
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

  it('preserves active shares that are hidden from the live resource list when saving', async () => {
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
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
      resources: [
        {
          kind: 'monday.board',
          externalId: 'subitems-board-1',
          label: 'Subitems of KIESI',
        },
      ],
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
    const hiddenShare = await screen.findByLabelText(/Subitems of KIESI/i);
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

  it('explains that admins activate shared team sources', () => {
    render(
      <TeamSourcesUi
        isAdmin
        activeShareIds={[]}
        rows={[row({ id: 'share-a', connectionId: 'conn-a', ownerLabel: 'Tim' })]}
      />,
    );

    expect(screen.getByText(/shared by connection owners/i)).toBeTruthy();
    expect(screen.getByText(/Select what this Timeline team should sync/i)).toBeTruthy();
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
      screen.getByText(/Team admins choose what this Timeline team should sync/i),
    ).toBeTruthy();
    expect(screen.queryByText(/then save/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Activate sources|Save sources/i })).toBeNull();
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

    expect(screen.getByText('Owner: Tim')).toBeTruthy();
    expect(screen.getByText('Owner: Ada')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save sources' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activate sources' })).toBeTruthy();
    expect(screen.getAllByText('Available, no sources syncing')).toHaveLength(1);

    const checkboxes = screen.getAllByRole('checkbox');
    const replacementCheckbox = checkboxes[1];
    if (!replacementCheckbox) throw new Error('Expected replacement checkbox');
    await user.click(replacementCheckbox);

    expect(screen.getByRole('button', { name: 'Replace connection' })).toBeTruthy();
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
