import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for MCP tool discovery and test calls. The shared MCP
 * client owns live protocol behavior; this route owns auth/team gates,
 * server ownership checks, input validation, filtering, and call status shape.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getServer: vi.fn(),
  requireMembership: vi.fn(),
  discoverTools: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    mcp: {
      getServer: fakes.getServer,
      discoverTools: fakes.discoverTools,
      callTool: fakes.callTool,
    },
  }),
}));

const { GET, POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_ID = '44444444-4444-4444-8444-444444444444';

function postRequest(body: unknown): Request {
  return new Request(`https://timeline.test/api/team/mcp-servers/${SERVER_ID}/tools`, {
    method: 'POST',
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
  fakes.getServer.mockResolvedValue({ id: SERVER_ID, userId: null });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.discoverTools.mockResolvedValue({
    tools: [
      {
        serverId: SERVER_ID,
        name: 'search',
        namespacedName: 'mcp__server__search',
        description: 'Search',
        inputSchema: { type: 'object' },
      },
      {
        serverId: 'other-server',
        name: 'other',
        namespacedName: 'mcp__other__search',
        description: null,
        inputSchema: null,
      },
    ],
  });
  fakes.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
});

describe('/api/team/mcp-servers/[id]/tools', () => {
  it('guards auth, active team, and missing servers', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await GET(new Request('https://timeline.test'), ctx());
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await GET(new Request('https://timeline.test'), ctx());
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });

    fakes.getServer.mockResolvedValueOnce(null);
    const missing = await POST(postRequest({ tool: 'x', args: {} }), ctx());
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('requires admin for team-shared servers and owner identity for personal servers', async () => {
    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    const forbiddenTeam = await GET(new Request('https://timeline.test'), ctx());
    expect(forbiddenTeam.status).toBe(403);
    await expect(forbiddenTeam.json()).resolves.toEqual({ error: 'forbidden' });

    fakes.getServer.mockResolvedValueOnce({ id: SERVER_ID, userId: OTHER_USER_ID });
    const forbiddenPersonal = await POST(postRequest({ tool: 'x', args: {} }), ctx());
    expect(forbiddenPersonal.status).toBe(403);
    await expect(forbiddenPersonal.json()).resolves.toEqual({ error: 'forbidden' });

    fakes.getServer.mockResolvedValueOnce({ id: SERVER_ID, userId: USER_ID });
    const allowedPersonal = await GET(new Request('https://timeline.test'), ctx());
    expect(allowedPersonal.status).toBe(200);
  });

  it('discovers tools and filters them to the requested server', async () => {
    const response = await GET(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      serverId: SERVER_ID,
      tools: [
        {
          name: 'search',
          namespacedName: 'mcp__server__search',
          description: 'Search',
          inputSchema: { type: 'object' },
        },
      ],
    });
  });

  it('validates test-call bodies and returns successful call results', async () => {
    const invalid = await POST(postRequest({ tool: '', args: [] }), ctx());
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: 'bad_request' });

    const response = await POST(
      postRequest({ tool: 'mcp__server__search', args: { q: 'launch' } }),
      ctx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'ok' }] },
    });
    expect(fakes.callTool).toHaveBeenCalledWith('mcp__server__search', { q: 'launch' });
  });

  it('returns failed tool calls as bounded public errors', async () => {
    fakes.callTool.mockRejectedValueOnce(new Error('remote unavailable'));

    const response = await POST(postRequest({ tool: 'mcp__server__search', args: {} }), ctx());

    expect(response.status).toBe(500);
    const payload = (await response.json()) as {
      ok: false;
      error: string;
      reference: string;
    };
    expect(payload).toMatchObject({ ok: false, error: 'call_failed' });
    expect(payload.reference).toMatch(/^[0-9a-f]{8}$/);
  });
});
