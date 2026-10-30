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
const { McpOAuthGrants } = await import('@/components/mcp-oauth-grants');

afterEach(() => {
  cleanup();
});

describe('McpOAuthGrants', () => {
  it('explains the empty authorized-app list', () => {
    render(<McpOAuthGrants grants={[]} teamId="11111111-1111-4111-8111-111111111111" />);

    expect(screen.getByText('No AI apps have access')).toBeTruthy();
    expect(screen.getByText(/Apps you authorize through Timeline/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke access' })).toBeNull();
  });

  it('shows client identity, scopes, and a grant-scoped revoke form', () => {
    render(
      <McpOAuthGrants
        teamId="11111111-1111-4111-8111-111111111111"
        grants={[
          {
            id: '22222222-2222-4222-8222-222222222222',
            clientId: 'https://claude.ai/api/mcp/auth',
            clientName: 'Claude',
            scopes: ['read', 'agent:ask'],
            createdAt: new Date('2026-10-01T00:00:00.000Z'),
            lastUsedAt: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Claude' })).toBeTruthy();
    expect(screen.getByText('claude.ai')).toBeTruthy();
    expect(screen.getByText('Read Timeline data')).toBeTruthy();
    expect(screen.getByText('Ask Timeline agent')).toBeTruthy();
    expect(screen.getByText(/Not used yet/)).toBeTruthy();

    const form = screen.getByRole('button', { name: 'Revoke access' }).closest('form');
    expect(form?.getAttribute('action')).toBe('/test/revoke-grant');
    expect(form?.querySelector('input[name="grant_id"]')?.getAttribute('value')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(form?.querySelector('input[name="team_id"]')?.getAttribute('value')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });
});
