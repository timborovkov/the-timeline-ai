// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TeamSourcesUi } from '@/components/integrations/provider-connections';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
});
