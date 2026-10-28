import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
/**
 * Deleting a provider connection is a personal action: the route only locates
 * the active team and delegates to the scoped owner-only integration API.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  deleteOwnedProviderConnection: vi.fn(),
  loggerWarn: vi.fn(),
  reportCaughtError: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/logger'),
  () => ({
    childLogger: () => ({ warn: fakes.loggerWarn, error: vi.fn(), info: vi.fn() }),
  }),
  () => import('@timeline/shared/logger'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      integrations: {
        deleteOwnedProviderConnection: fakes.deleteOwnedProviderConnection,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);

const { DELETE } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'member' } });
  fakes.deleteOwnedProviderConnection.mockResolvedValue(true);
});

describe('DELETE /api/connections/[id]', () => {
  it('requires a signed-in user with an active team', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await DELETE(new Request('https://timeline.test'), {
      params: Promise.resolve({ id: CONNECTION_ID }),
    });
    expect(unauthenticated.status).toBe(401);

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await DELETE(new Request('https://timeline.test'), {
      params: Promise.resolve({ id: CONNECTION_ID }),
    });
    expect(noTeam.status).toBe(400);
  });

  it('deletes only an owned provider connection through the scoped integration API', async () => {
    const response = await DELETE(new Request('https://timeline.test'), {
      params: Promise.resolve({ id: CONNECTION_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.deleteOwnedProviderConnection).toHaveBeenCalledWith(CONNECTION_ID);
  });

  it('returns not found when the connection is missing or not owned', async () => {
    fakes.deleteOwnedProviderConnection.mockResolvedValueOnce(false);

    const response = await DELETE(new Request('https://timeline.test'), {
      params: Promise.resolve({ id: CONNECTION_ID }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('returns a JSON error when provider connection deletion fails', async () => {
    const error = new Error('database unavailable');
    fakes.deleteOwnedProviderConnection.mockRejectedValueOnce(error);

    const response = await DELETE(new Request('https://timeline.test'), {
      params: Promise.resolve({ id: CONNECTION_ID }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'disconnect_failed' });
    expect(fakes.loggerWarn).toHaveBeenCalledWith(
      { err: error, connectionId: CONNECTION_ID },
      'provider connection delete failed',
    );
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(error, {
      surface: 'api',
      operation: 'provider_connection_delete',
    });
  });
});
