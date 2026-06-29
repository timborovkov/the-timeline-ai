// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectedIntegrations } from '@/components/integrations/connected';

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock('@/app/actions/visibility', () => ({
  setIntegrationVisibilityDefaultAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

function connectedRow(
  overrides: Partial<Parameters<typeof ConnectedIntegrations>[0]['connected'][number]> = {},
) {
  return {
    id: 'integration-1',
    provider: 'monday',
    displayName: 'Monday.com — Acme',
    enabled: true,
    lastSyncedAt: null,
    lastError: null,
    syncPause: null,
    attention: [],
    visibilityDefault: 'team' as const,
    visibilityDefaultUserIds: null,
    ...overrides,
  };
}

describe('ConnectedIntegrations', () => {
  it('shows provider budget cooldowns without offering retry sync', () => {
    render(
      <ConnectedIntegrations
        connected={[
          connectedRow({
            lastError: 'Monday GraphQL 429: Daily limit exceeded',
            syncPause: {
              retryAt: '2026-06-28T12:00:00.000Z',
              reason: 'daily_limit_exceeded',
              scope: 'daily',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText(/Provider quota cooldown \(daily\)/i)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Paused' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Retry sync' })).toBeNull();
  });

  it('shows row-level reconnect attention instead of leading with raw sync errors', () => {
    render(
      <ConnectedIntegrations
        connected={[
          connectedRow({
            lastError: 'Monday GraphQL 429: {"errors":[{"message":"Daily limit exceeded"}]}',
            attention: [
              {
                id: 'attention-1',
                category: 'needs_reconnect',
                summary:
                  'Reconnect Monday.com to grant account:read and webhooks:write before webhook provisioning can resume.',
                lastSeenAt: '2026-06-28T12:00:00.000Z',
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Reconnect required:')).toBeTruthy();
    expect(screen.getByText(/Reconnect Monday\.com to grant account:read/i)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Action needed' }).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'Retry sync' })).toBeNull();
    expect(screen.queryByText(/Monday GraphQL 429/)).toBeNull();
  });

  it('dedupes identical attention rows from activation and worker checks', () => {
    render(
      <ConnectedIntegrations
        connected={[
          connectedRow({
            attention: [
              {
                id: 'attention-1',
                category: 'needs_reconnect',
                summary:
                  'monday connection is missing required OAuth scopes (account:read, webhooks:write); reconnect to enable webhook provisioning and account-scoped provider budgets.',
                lastSeenAt: '2026-06-28T12:00:00.000Z',
              },
              {
                id: 'attention-2',
                category: 'needs_reconnect',
                summary:
                  'monday connection is missing required OAuth scopes (account:read, webhooks:write); reconnect to enable webhook provisioning and account-scoped provider budgets.',
                lastSeenAt: '2026-06-28T12:01:00.000Z',
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getAllByText('Reconnect required:')).toHaveLength(1);
    expect(screen.getAllByText(/missing required OAuth scopes/i)).toHaveLength(1);
  });

  it('shows webhook degradation as non-blocking attention', () => {
    render(
      <ConnectedIntegrations
        connected={[
          connectedRow({
            attention: [
              {
                id: 'attention-1',
                category: 'webhook_degraded',
                summary: 'Webhook provisioning failed for monday: MONDAY_WEBHOOK_SECRET missing',
                lastSeenAt: '2026-06-28T12:00:00.000Z',
              },
            ],
          }),
        ]}
      />,
    );

    const title = screen.getByText('Webhook delivery degraded:');
    expect(title).toBeTruthy();
    expect(title.closest('div')?.className).toContain('border-signal');
    expect(title.closest('div')?.className).not.toContain('border-danger');
    expect(screen.getByText(/MONDAY_WEBHOOK_SECRET missing/i)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sync now' }).disabled).toBe(
      false,
    );
  });

  it('keeps mixed blocking and webhook attention in the blocking treatment', () => {
    render(
      <ConnectedIntegrations
        connected={[
          connectedRow({
            attention: [
              {
                id: 'attention-1',
                category: 'webhook_degraded',
                summary: 'Webhook provisioning failed for monday: MONDAY_WEBHOOK_SECRET missing',
                lastSeenAt: '2026-06-28T12:00:00.000Z',
              },
              {
                id: 'attention-2',
                category: 'needs_reconnect',
                summary: 'Reconnect Monday.com before sync can continue.',
                lastSeenAt: '2026-06-28T12:00:00.000Z',
              },
            ],
          }),
        ]}
      />,
    );

    const title = screen.getByText('Reconnect required:');
    expect(title.closest('div')?.className).toContain('border-danger');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Action needed' }).disabled).toBe(
      true,
    );
  });

  it('shows inline disconnect confirmation and removes the row after disconnect', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }))));
    vi.stubGlobal('fetch', fetchMock);

    render(<ConnectedIntegrations connected={[connectedRow()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText(/Future sync stops/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/integrations/manage/integration-1/disconnect', {
        method: 'POST',
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/Future sync stops/i)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Confirm disconnect' })).toBeNull();
      expect(screen.queryByText('Monday.com — Acme')).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(routerRefresh).toHaveBeenCalled();
  });

  it('shows a readable disconnect error when the server returns an empty failure body', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);

    render(<ConnectedIntegrations connected={[connectedRow()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));

    expect(await screen.findByText('Connection failed (500).')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm disconnect' })).toBeTruthy();
    expect(screen.getByText('Monday.com — Acme')).toBeTruthy();
  });

  it('maps JSON disconnect errors to user-facing copy', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ConnectedIntegrations connected={[connectedRow()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));

    expect(
      await screen.findByText('Only an admin can do this. Ask a team admin to help.'),
    ).toBeTruthy();
  });
});
