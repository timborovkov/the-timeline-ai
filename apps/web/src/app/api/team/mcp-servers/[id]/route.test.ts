import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for updating and deleting MCP server rows. The MCP
 * scope owns authorization details; this route owns auth/team gates, input
 * validation, status mapping, and parameter forwarding.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    mcp: {
      updateServer: fakes.updateServer,
      deleteServer: fakes.deleteServer,
    },
  }),
}));

const { DELETE, PATCH } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_ID = '44444444-4444-4444-8444-444444444444';

function patchRequest(body: unknown): Request {
  return new Request(`https://timeline.test/api/team/mcp-servers/${SERVER_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function ctx(id = SERVER_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.updateServer.mockResolvedValue(undefined);
  fakes.deleteServer.mockResolvedValue(undefined);
});

describe('/api/team/mcp-servers/[id]', () => {
  it('guards auth and active team for mutations', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await PATCH(patchRequest({ enabled: false }), ctx());
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await DELETE(new Request('https://timeline.test'), ctx());
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });
  });

  it('validates patch payloads and forwards successful updates', async () => {
    const invalid = await PATCH(patchRequest({ name: '', disabledTools: [1] }), ctx());
    expect(invalid.status).toBe(400);
    const payload = (await invalid.json()) as { error: string };
    expect(payload.error).toBe('bad_request');

    const response = await PATCH(
      patchRequest({ name: 'Renamed', enabled: false, disabledTools: ['write'] }),
      ctx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.updateServer).toHaveBeenCalledWith(SERVER_ID, {
      name: 'Renamed',
      enabled: false,
      disabledTools: ['write'],
    });
  });

  it('maps update and delete failures to bounded 400 responses', async () => {
    fakes.updateServer.mockRejectedValueOnce(new Error('MCP server not found'));
    const update = await PATCH(patchRequest({ enabled: true }), ctx());
    expect(update.status).toBe(400);
    await expect(update.json()).resolves.toEqual({ error: 'MCP server not found' });

    fakes.deleteServer.mockRejectedValueOnce(new Error('delete_failed'));
    const deleted = await DELETE(new Request('https://timeline.test'), ctx());
    expect(deleted.status).toBe(400);
    await expect(deleted.json()).resolves.toEqual({ error: 'delete_failed' });
  });

  it('deletes server rows through the scoped MCP module', async () => {
    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.deleteServer).toHaveBeenCalledWith(SERVER_ID);
  });
});
