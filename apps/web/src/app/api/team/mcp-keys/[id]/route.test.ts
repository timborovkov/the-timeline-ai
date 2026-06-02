import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for revoking outbound MCP bearer keys. The route owns
 * admin gates, team-scoped lookup, idempotent soft revoke behavior, and audit
 * write intent.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  existingRow: null as { id: string; revokedAt: Date | null } | null,
  updateRows: [] as unknown[],
  insertValues: [] as unknown[],
}));

vi.mock('@timeline/db', () => ({
  auditLog: { table: 'audit_log' },
  mcpOutboundKeys: {
    table: 'mcp_outbound_keys',
    id: 'id',
    teamId: 'team_id',
    revokedAt: 'revoked_at',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ requireMembership: fakes.requireMembership }),
}));
vi.mock('@/lib/db', () => ({
  db: {
    transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => ({
                for: vi.fn().mockResolvedValue(fakes.existingRow ? [fakes.existingRow] : []),
              }),
            }),
          }),
        }),
        update: (table: unknown) => ({
          set: (value: unknown) => ({
            where: () => ({
              returning: vi.fn().mockResolvedValue(fakes.updateRows),
              _table: table,
              _value: value,
            }),
          }),
        }),
        insert: (table: unknown) => ({
          values: (value: unknown) => {
            fakes.insertValues.push({ table, value });
            return Promise.resolve();
          },
        }),
      };
      return callback(tx);
    }),
  },
}));

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
  fakes.existingRow = { id: KEY_ID, revokedAt: null };
  fakes.updateRows = [{ id: KEY_ID }];
  fakes.insertValues = [];
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
    fakes.existingRow = null;

    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
    expect(fakes.insertValues).toEqual([]);
  });

  it('treats already-revoked keys as idempotent success without a second audit write', async () => {
    fakes.existingRow = { id: KEY_ID, revokedAt: new Date('2026-06-01T00:00:00.000Z') };

    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.insertValues).toEqual([]);
  });

  it('soft revokes open keys and writes audit intent', async () => {
    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.insertValues).toHaveLength(1);
    expect(fakes.insertValues[0]).toMatchObject({
      value: {
        teamId: TEAM_ID,
        actorUserId: USER_ID,
        action: 'mcp.disconnect',
        targetType: 'mcp_outbound_key',
        targetId: KEY_ID,
        targetVisibility: 'team',
        metadata: { surface: 'timeline_as_mcp_server' },
      },
    });
  });

  it('returns not_found if the revoke update races and returns no row', async () => {
    fakes.updateRows = [];

    const response = await DELETE(new Request('https://timeline.test'), ctx());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });
});
