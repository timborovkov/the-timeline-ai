import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  requireMembership: vi.fn(),
  transaction: vi.fn(),
  reportCaughtError: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      transaction: fakes.transaction,
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.requireMembership,
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);

const { applyTeamRename, teamDisplayNameSchema } = await import('./team-rename.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.requireMembership.mockResolvedValue(undefined);
});

describe('teamDisplayNameSchema', () => {
  it('trims and enforces 1–80 characters', () => {
    expect(teamDisplayNameSchema.safeParse('  Acme  ').success).toBe(true);
    expect(teamDisplayNameSchema.safeParse('').success).toBe(false);
    expect(teamDisplayNameSchema.safeParse('   ').success).toBe(false);
    expect(teamDisplayNameSchema.safeParse('x'.repeat(81)).success).toBe(false);
  });
});

describe('applyTeamRename', () => {
  it('rejects invalid names before membership checks', async () => {
    await expect(
      applyTeamRename({ teamId: TEAM_ID, userId: USER_ID, name: '   ' }),
    ).resolves.toEqual({ error: 'Invalid team name' });
    expect(fakes.requireMembership).not.toHaveBeenCalled();
    expect(fakes.transaction).not.toHaveBeenCalled();
  });

  it('requires admin membership', async () => {
    fakes.requireMembership.mockRejectedValue(new Error('forbidden'));
    await expect(
      applyTeamRename({ teamId: TEAM_ID, userId: USER_ID, name: 'New name' }),
    ).resolves.toEqual({ error: 'Only admins can rename a team' });
    expect(fakes.transaction).not.toHaveBeenCalled();
  });

  it('updates the name only and writes team.name audit metadata', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    fakes.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      Promise.resolve(
        fn({
          update: vi.fn(() => ({
            set: vi.fn((values: { name: string }) => {
              expect(values).toEqual({ name: 'Northstar Labs' });
              return {
                where: vi.fn(() => ({
                  returning: vi.fn().mockResolvedValue([{ id: TEAM_ID }]),
                })),
              };
            }),
          })),
          insert: vi.fn(() => ({ values: insertValues })),
        }),
      ),
    );

    await expect(
      applyTeamRename({ teamId: TEAM_ID, userId: USER_ID, name: 'Northstar Labs' }),
    ).resolves.toEqual({ ok: true, changed: true });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_ID,
        actorUserId: USER_ID,
        action: 'settings.change',
        metadata: { setting: 'team.name' },
      }),
    );
  });

  it('returns changed=false when the name is unchanged', async () => {
    fakes.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      Promise.resolve(
        fn({
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
            })),
          })),
          insert: vi.fn(),
        }),
      ),
    );

    await expect(
      applyTeamRename({ teamId: TEAM_ID, userId: USER_ID, name: 'Same' }),
    ).resolves.toEqual({ ok: true, changed: false });
  });
});
