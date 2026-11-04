import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('@/app/oauth/actions'),
  () => ({
    revokeMcpOAuthGrantAction: '/test/revoke-grant',
  }),
  () => import('@/app/oauth/actions'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { ConnectAgentAgents } = await import('./connect-agent-agents.js');

const GRANT = {
  id: '22222222-2222-4222-8222-222222222222',
  clientId: 'https://claude.ai/api/mcp/auth',
  clientName: 'Claude',
  scopes: ['read', 'capture'],
  createdAt: '2026-10-01T00:00:00.000Z',
  lastUsedAt: '2026-10-02T00:00:00.000Z',
  ownerUserId: '33333333-3333-4333-8333-333333333333',
  ownerName: 'Jordan Member',
  ownerEmail: 'jordan@example.test',
};

afterEach(() => {
  cleanup();
});

describe('ConnectAgentAgents', () => {
  it('lists OAuth grants with last used and a revoke form that returns to connect-agent', () => {
    render(<ConnectAgentAgents teamId="11111111-1111-4111-8111-111111111111" grants={[GRANT]} />);

    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('Remember')).toBeTruthy();
    const form = screen.getByRole('button', { name: 'Revoke' }).closest('form');
    expect(form?.getAttribute('action')).toBe('/test/revoke-grant');
    expect(form?.querySelector('input[name="return_to"]')?.getAttribute('value')).toBe(
      '/app/connect-agent',
    );
    expect(screen.queryByText(/Jordan Member/)).toBeNull();
  });

  it('shows the consenting member next to the client on admin listings', () => {
    render(
      <ConnectAgentAgents teamId="11111111-1111-4111-8111-111111111111" isAdmin grants={[GRANT]} />,
    );

    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('Jordan Member · claude.ai')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Actions for Claude (Jordan Member)' })).toBeTruthy();
  });

  it('falls back to the owner email when the member has no name', () => {
    render(
      <ConnectAgentAgents
        teamId="11111111-1111-4111-8111-111111111111"
        isAdmin
        grants={[{ ...GRANT, ownerName: '  ', ownerEmail: 'nameless@example.test' }]}
      />,
    );

    expect(screen.getByText('nameless@example.test · claude.ai')).toBeTruthy();
  });

  it('explains the empty grant list without extra chrome', () => {
    render(<ConnectAgentAgents teamId="11111111-1111-4111-8111-111111111111" grants={[]} />);

    expect(screen.getByText(/No agents connected yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});
