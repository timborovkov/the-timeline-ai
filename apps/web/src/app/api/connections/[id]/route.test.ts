import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deleting a provider connection is a personal action: the route only locates
 * the active team and delegates to the scoped owner-only integration API.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  deleteOwnedProviderConnection: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    integrations: {
      deleteOwnedProviderConnection: fakes.deleteOwnedProviderConnection,
    },
  }),
}));

const { DELETE } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'member' } });
  fakes.deleteOwnedProviderConnection.mockResolvedValue(undefined);
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
});
