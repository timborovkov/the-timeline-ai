import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
/**
 * Route-handler tests for revoking outbound MCP bearer keys. The route owns
 * admin gates and maps withTeam.mcpOutbound.revokeKey onto HTTP.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  revokeKey: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({
    trackProductEventBestEffort: fakes.trackProductEventBestEffort,
  }),
  () => import('@/lib/analytics'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.requireMembership,
      mcpOutbound: { revokeKey: fakes.revokeKey },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);

const { DELETE } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const KEY_ID = '55555555-5555-4555-8555-555555555555';

function ctx(id = KEY_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.revokeKey.mockResolvedValue({ found: true, revokedNow: true });
});

describe('DELETE /api/team/mcp-keys/[id]', () => {
  it('guards auth, active team, and admin membership', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await DELETE(new Request('https://timeline.test'), ctx());
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await DELETE(new Request('https://timeline.test'), ctx());
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });

    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    const forbidden = await DELETE(new Request('https://timeline.test'), ctx());
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('returns not_found when the key is not in the active team', async () => {
    fakes.revokeKey.mockResolvedValueOnce({ found: false, revokedNow: false });

    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
  });

  it('treats already-revoked keys as idempotent success without a second audit write', async () => {
    fakes.revokeKey.mockResolvedValueOnce({ found: true, revokedNow: false });

    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
  });

  it('soft revokes open keys through withTeam', async () => {
    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.revokeKey).toHaveBeenCalledWith(KEY_ID);
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'integration_management_action_completed',
      { action: 'mcp_key_revoke', kind: 'mcp_outbound' },
    );
  });
});
