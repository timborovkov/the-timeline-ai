// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          resources: [
            { kind: 'github.org', externalId: 'acme', label: 'acme (all accessible repos)' },
            { kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' },
          ],
          shares: [],
        }),
    } as Response);

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
