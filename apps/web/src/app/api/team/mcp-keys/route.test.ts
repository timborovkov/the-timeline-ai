import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
/**
 * Route-handler tests for outbound Timeline-as-MCP-server bearer keys. Key
 * minting and audit writes live in withTeam.mcpOutbound; this route owns
 * admin gates, serialization, and one-time plaintext return.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  listKeys: vi.fn(),
  createKey: vi.fn(),
  loggerError: vi.fn(),
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
  import.meta.resolve('@timeline/shared/logger'),
  () => ({
    childLogger: () => ({ error: fakes.loggerError, warn: vi.fn(), info: vi.fn() }),
  }),
  () => import('@timeline/shared/logger'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.requireMembership,
      mcpOutbound: {
        listKeys: fakes.listKeys,
        createKey: fakes.createKey,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: vi.fn() }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);

const { GET, POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/team/mcp-keys', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.listKeys.mockResolvedValue([
    {
      id: 'key-1',
      name: 'Claude',
      prefix: 'tla_pref',
      scopes: ['tools:list'],
      lastUsedAt: new Date('2026-06-01T00:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    },
  ]);
  fakes.createKey.mockResolvedValue({
    id: 'key-2',
    name: 'Cursor',
    prefix: 'tla_cur',
    plaintext: 'tla_plaintext_once',
    scopes: ['read', 'capture'],
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
  });
});

describe('/api/team/mcp-keys', () => {
  it('guards auth, active team, and admin membership', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await GET();
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await POST(request({ name: 'Claude' }));
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });

    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    const forbidden = await GET();
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('lists active keys without returning hashes or plaintext', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      keys: [
        {
          id: 'key-1',
          name: 'Claude',
          prefix: 'tla_pref',
          scopes: ['tools:list'],
          lastUsedAt: '2026-06-01T00:00:00.000Z',
          expiresAt: null,
          createdAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('validates create bodies before minting keys', async () => {
    const response = await POST(request({ name: '' }));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe('bad_request');
    expect(fakes.createKey).not.toHaveBeenCalled();
  });

  it('mints keys through withTeam and returns plaintext once', async () => {
    const response = await POST(request({ name: 'Cursor' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'key-2',
      name: 'Cursor',
      prefix: 'tla_cur',
      plaintext: 'tla_plaintext_once',
      scopes: ['read', 'capture'],
      createdAt: '2026-06-02T00:00:00.000Z',
    });
    expect(fakes.createKey).toHaveBeenCalledWith({
      name: 'Cursor',
      allowCapture: true,
      allowAgent: false,
    });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'integration_management_action_completed',
      { action: 'mcp_key_mint', kind: 'mcp_outbound' },
    );
  });

  it('grants agent access only when an admin explicitly opts in', async () => {
    fakes.createKey.mockResolvedValueOnce({
      id: 'key-2',
      name: 'Operator',
      prefix: 'tla_cur',
      plaintext: 'tla_plaintext_once',
      scopes: ['read', 'capture', 'agent:ask'],
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
    });

    const response = await POST(request({ name: 'Operator', allowAgent: true }));

    expect(response.status).toBe(200);
    expect(fakes.createKey).toHaveBeenCalledWith({
      name: 'Operator',
      allowCapture: true,
      allowAgent: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      scopes: ['read', 'capture', 'agent:ask'],
    });
  });

  it('omits capture when an admin explicitly opts out', async () => {
    fakes.createKey.mockResolvedValueOnce({
      id: 'key-2',
      name: 'Readonly',
      prefix: 'tla_cur',
      plaintext: 'tla_plaintext_once',
      scopes: ['read'],
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
    });

    const response = await POST(request({ name: 'Readonly', allowCapture: false }));

    expect(response.status).toBe(200);
    expect(fakes.createKey).toHaveBeenCalledWith({
      name: 'Readonly',
      allowCapture: false,
      allowAgent: false,
    });
    await expect(response.json()).resolves.toMatchObject({
      scopes: ['read'],
    });
  });

  it('maps create failures without leaking key material', async () => {
    fakes.createKey.mockRejectedValueOnce(new Error('db down'));

    const response = await POST(request({ name: 'Cursor' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'create_failed' });
    expect(fakes.loggerError).toHaveBeenCalled();
  });
});
