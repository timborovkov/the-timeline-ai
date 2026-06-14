import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  withTeam: vi.fn(),
}));

vi.mock('#src/team-scope.js', () => ({ withTeam: fakes.withTeam }));

const { generateDailyDigest } = await import('#src/messaging/digest.js');

function chainResult(rows: unknown[]) {
  const thenable = {
    limit: vi.fn().mockResolvedValue(rows),
    groupBy: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  const chain = {
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => thenable),
  };
  return { from: vi.fn(() => chain) };
}

function insertConflict() {
  return {
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    })),
  };
}

describe('generateDailyDigest conflict handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.withTeam.mockReturnValue({
      requireMembership: vi.fn().mockResolvedValue('member'),
      timeline: {
        team: vi.fn().mockResolvedValue({ name: 'AuditAI' }),
        listEvents: vi.fn().mockResolvedValue([
          {
            source: 'slack',
            occurredAt: new Date('2026-06-14T10:00:00Z'),
            sourceMetadata: { slack_channel_name: 'general' },
            contentText: 'We decided to ship the pilot invite flow.',
          },
        ]),
      },
      suggestions: { countPendingSuggestions: vi.fn().mockResolvedValue(2) },
      objects: { listObjects: vi.fn().mockResolvedValue([]) },
      calendar: { listCalendarEvents: vi.fn().mockResolvedValue([]) },
    });
  });

  it('replaces a previous preference-skipped row with a generated digest payload', async () => {
    const updates: unknown[] = [];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
        )
        .mockReturnValueOnce(chainResult([{ name: 'Tim', email: 'tim@example.test' }]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{ id: 'digest-1', status: 'skipped', payload: {} }])),
      insert: vi.fn(() => insertConflict()),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };

    await expect(
      generateDailyDigest({
        db: db as never,
        teamId: 'team-1',
        userId: 'user-1',
        windowStart: new Date('2026-06-13T12:00:00Z'),
        windowEnd: new Date('2026-06-14T12:00:00Z'),
        now: new Date('2026-06-14T12:05:00Z'),
        summarize: vi.fn().mockResolvedValue('Pilot invite flow moved toward launch.'),
      }),
    ).resolves.toMatchObject({
      digestId: 'digest-1',
      skipped: false,
      payload: {
        teamName: 'AuditAI',
        summary: 'Pilot invite flow moved toward launch.',
        eventCount: 1,
      },
    });

    const generatedUpdate = updates.find(
      (update): update is { status: unknown; summary: unknown; payload: unknown } =>
        typeof update === 'object' &&
        update !== null &&
        'status' in update &&
        update.status === 'generated',
    );
    expect(generatedUpdate).toBeDefined();
    expect(generatedUpdate?.summary).toBe('Pilot invite flow moved toward launch.');
    expect(generatedUpdate?.payload).toMatchObject({ teamName: 'AuditAI', eventCount: 1 });
  });
});
