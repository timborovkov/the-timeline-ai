import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for outbound Timeline-as-MCP-server bearer keys. The
 * shared key helper owns key generation; this route owns admin gates, active
 * key serialization, transaction/audit intent, and one-time plaintext return.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  mintKey: vi.fn(),
  loggerError: vi.fn(),
  selectRows: [] as unknown[],
  insertValues: [] as unknown[],
  returningRow: null as Record<string, unknown> | null,
  transactionError: null as Error | null,
}));

vi.mock('@timeline/db', () => ({
  auditLog: { table: 'audit_log' },
  mcpOutboundKeys: {
    table: 'mcp_outbound_keys',
    teamId: 'team_id',
    revokedAt: 'revoked_at',
    createdAt: 'created_at',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  desc: (arg: unknown) => ({ op: 'desc', arg }),
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  isNull: (arg: unknown) => ({ op: 'isNull', arg }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: fakes.loggerError, warn: vi.fn(), info: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ requireMembership: fakes.requireMembership }),
}));
vi.mock('@timeline/shared/mcp-server', () => ({ mintKey: fakes.mintKey }));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: vi.fn().mockImplementation(() => Promise.resolve(fakes.selectRows)),
        }),
      }),
    }),
    transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      if (fakes.transactionError) throw fakes.transactionError;
      const tx = {
        insert: (table: unknown) => ({
          values: (value: unknown) => {
            fakes.insertValues.push({ table, value });
            return {
              returning: vi.fn().mockResolvedValue(fakes.returningRow ? [fakes.returningRow] : []),
            };
          },
        }),
      };
      return callback(tx);
    }),
  },
}));

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
  fakes.mintKey.mockReturnValue({
    plaintext: 'tla_plaintext_once',
    hash: 'hashed',
    prefix: 'tla_pref',
  });
  fakes.selectRows = [
    {
      id: 'key-1',
      name: 'Claude',
      keyPrefix: 'tla_pref',
      scopes: ['tools:list'],
      lastUsedAt: new Date('2026-06-01T00:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      keyHash: 'not serialized',
    },
  ];
  fakes.returningRow = {
    id: 'key-2',
    name: 'Cursor',
    keyPrefix: 'tla_cur',
    scopes: [],
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
  };
  fakes.insertValues = [];
  fakes.transactionError = null;
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
    expect(fakes.mintKey).not.toHaveBeenCalled();
  });

  it('mints keys, writes the key row plus audit intent, and returns plaintext once', async () => {
    const response = await POST(request({ name: 'Cursor' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'key-2',
      name: 'Cursor',
      prefix: 'tla_cur',
      plaintext: 'tla_plaintext_once',
      createdAt: '2026-06-02T00:00:00.000Z',
    });
    expect(fakes.insertValues[0]).toMatchObject({
      value: {
        teamId: TEAM_ID,
        createdByUserId: USER_ID,
        name: 'Cursor',
        keyHash: 'hashed',
        keyPrefix: 'tla_pref',
      },
    });
    expect(fakes.insertValues[1]).toMatchObject({
      value: {
        teamId: TEAM_ID,
        actorUserId: USER_ID,
        action: 'mcp.connect',
        targetType: 'mcp_outbound_key',
        targetId: 'key-2',
        targetVisibility: 'team',
      },
    });
  });

  it('maps transaction failures to create_failed without leaking key material', async () => {
    fakes.transactionError = new Error('db down');

    const response = await POST(request({ name: 'Cursor' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'create_failed' });
    expect(fakes.loggerError).toHaveBeenCalled();
  });
});
