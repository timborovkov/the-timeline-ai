// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectedIntegrations } from '@/components/integrations/connected';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/visibility', () => ({
  setIntegrationVisibilityDefaultAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock('@/components/ui/app-dialog', () => ({
  useAppDialog: () => ({ confirm: vi.fn(), node: null }),
}));

afterEach(() => {
  vi.restoreAllMocks();
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
});
