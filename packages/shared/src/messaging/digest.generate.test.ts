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
    orderBy: vi.fn(() => thenable),
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
        listAllEventsInWindow: vi.fn().mockResolvedValue([
          {
            id: 'event-1',
            teamId: 'team-1',
            authorUserId: null,
            source: 'slack',
            occurredAt: new Date('2026-06-14T10:00:00Z'),
            createdAt: new Date('2026-06-14T10:00:00Z'),
            sourceMetadata: { slack_channel_name: 'general' },
            contentText: 'We decided to ship the pilot invite flow.',
            contentAudioUrl: null,
          },
        ]),
        listMomentPresentations: vi.fn().mockResolvedValue({}),
      },
      suggestions: {
        getApprovalItemCounts: vi.fn().mockResolvedValue({ failed: 0, pending: 2 }),
        listSuggestions: vi.fn().mockResolvedValue([]),
      },
      objects: { listObjects: vi.fn().mockResolvedValue([]) },
      calendar: { listCalendarEvents: vi.fn().mockResolvedValue([]) },
    });
  });

  it('replaces a previous preference-skipped row with a generated digest payload', async () => {
    const updates: unknown[] = [];
    const db = {
      select: vi
        .fn(() => chainResult([]))
        .mockReturnValueOnce(
          chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
        )
        .mockReturnValueOnce(chainResult([{ id: 'digest-1', status: 'skipped', payload: {} }]))
        .mockReturnValueOnce(chainResult([{ name: 'Tim', email: 'tim@example.test' }]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([])),
      insert: vi.fn(() => insertConflict()),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: 'digest-1' }]),
            })),
          };
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
        sections: [],
        eventCount: 1,
        momentCount: 1,
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
    expect(generatedUpdate?.payload).toMatchObject({
      teamName: 'AuditAI',
      eventCount: 1,
      momentCount: 1,
      sections: [],
    });
  });

  it('uses the team timezone when no digest preference row exists', async () => {
    const updates: unknown[] = [];
    const db = {
      select: vi
        .fn(() => chainResult([]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{ defaultTimezone: 'Europe/Helsinki' }]))
        .mockReturnValueOnce(chainResult([{ id: 'digest-1', status: 'skipped', payload: {} }]))
        .mockReturnValueOnce(chainResult([{ name: 'Tim', email: 'tim@example.test' }]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([])),
      insert: vi.fn(() => insertConflict()),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: 'digest-1' }]),
            })),
          };
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
        timezone: 'Europe/Helsinki',
      },
    });

    const generatedUpdate = updates.find(
      (update): update is { status: unknown; payload: unknown } =>
        typeof update === 'object' &&
        update !== null &&
        'status' in update &&
        update.status === 'generated',
    );
    expect(generatedUpdate?.payload).toMatchObject({ timezone: 'Europe/Helsinki' });
  });

  it('stores uncapped activity counts and completed tasks from applied status changes', async () => {
    const createdTask = {
      id: 'task-new',
      type: 'task',
      canonicalName: 'Write launch recap',
      metadata: {},
      status: 'todo',
      dueAt: null,
    };
    const completedTask = {
      id: 'task-done',
      type: 'task',
      canonicalName: 'Close review',
      metadata: {},
      status: 'done',
      dueAt: null,
    };
    const listObjects = vi
      .fn()
      .mockResolvedValueOnce([createdTask])
      .mockResolvedValueOnce([completedTask]);
    fakes.withTeam.mockReturnValue({
      requireMembership: vi.fn().mockResolvedValue('member'),
      timeline: {
        team: vi.fn().mockResolvedValue({ name: 'AuditAI' }),
        listAllEventsInWindow: vi.fn().mockResolvedValue([]),
        listMomentPresentations: vi.fn().mockResolvedValue({}),
      },
      suggestions: {
        getApprovalItemCounts: vi.fn().mockResolvedValue({ failed: 0, pending: 3 }),
        listSuggestions: vi.fn().mockResolvedValue([]),
      },
      objects: { listObjects },
      calendar: { listCalendarEvents: vi.fn().mockResolvedValue([]) },
    });
    const updates: unknown[] = [];
    const db = {
      select: vi
        .fn(() => chainResult([]))
        .mockReturnValueOnce(
          chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
        )
        .mockReturnValueOnce(chainResult([{ id: 'digest-1', status: 'skipped', payload: {} }]))
        .mockReturnValueOnce(chainResult([{ name: 'Tim', email: 'tim@example.test' }]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(
          chainResult([
            { type: 'task', total: 40 },
            { type: 'project', total: 2 },
            { type: 'deal', total: 5 },
          ]),
        )
        .mockReturnValueOnce(chainResult([{ total: 7 }]))
        .mockReturnValueOnce(chainResult([{ entityId: 'task-done' }]))
        .mockReturnValueOnce(chainResult([{ total: 17 }])),
      insert: vi.fn(() => insertConflict()),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: 'digest-1' }]),
            })),
          };
        }),
      })),
    };

    const result = await generateDailyDigest({
      db: db as never,
      teamId: 'team-1',
      userId: 'user-1',
      windowStart: new Date('2026-06-13T12:00:00Z'),
      windowEnd: new Date('2026-06-14T12:00:00Z'),
      now: new Date('2026-06-14T12:05:00Z'),
      summarize: vi.fn().mockResolvedValue('Task changes landed in the briefing window.'),
    });

    expect(result.payload.activity).toMatchObject({
      newMoments: 0,
      newProposals: 17,
      pendingApprovals: 3,
      newTasks: 40,
      completedTasks: 7,
      newProjects: 2,
      newObjectsByType: { task: 40, project: 2, deal: 5 },
    });
    expect(result.payload.tasks).toEqual([
      expect.objectContaining({ id: 'task-new', title: 'Write launch recap' }),
    ]);
    expect(result.payload.completedTasks).toEqual([
      expect.objectContaining({ id: 'task-done', title: 'Close review', status: 'done' }),
    ]);
    expect(listObjects).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: ['task', 'follow_up'],
        createdAfter: expect.any(Date),
        createdBefore: expect.any(Date),
        limit: 12,
      }),
    );
    expect(listObjects).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: ['task-done'],
        type: ['task', 'follow_up'],
        limit: 12,
      }),
    );
    expect(listObjects.mock.calls.some((call) => 'updatedAfter' in (call[0] ?? {}))).toBe(false);
    expect(listObjects.mock.calls.some((call) => 'status' in (call[0] ?? {}))).toBe(false);
    const generatedUpdate = updates.find(
      (update): update is { status: unknown; payload: { activity?: unknown } } =>
        typeof update === 'object' &&
        update !== null &&
        'status' in update &&
        update.status === 'generated',
    );
    expect(generatedUpdate?.payload.activity).toMatchObject({
      newTasks: 40,
      completedTasks: 7,
      newProposals: 17,
      pendingApprovals: 3,
    });
  });

  it('returns an existing generated digest without rebuilding the summary', async () => {
    const summarize = vi.fn().mockResolvedValue('Should not be used.');
    const db = {
      select: vi
        .fn(() => chainResult([]))
        .mockReturnValueOnce(
          chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
        )
        .mockReturnValueOnce(
          chainResult([
            {
              id: 'digest-1',
              status: 'generated',
              payload: {
                teamName: 'AuditAI',
                summary: 'Existing digest.',
                windowStart: '2026-06-13T12:00:00.000Z',
                windowEnd: '2026-06-14T12:00:00.000Z',
              },
            },
          ]),
        ),
      insert: vi.fn(() => insertConflict()),
      update: vi.fn(),
    };

    await expect(
      generateDailyDigest({
        db: db as never,
        teamId: 'team-1',
        userId: 'user-1',
        windowStart: new Date('2026-06-13T12:00:00Z'),
        windowEnd: new Date('2026-06-14T12:00:00Z'),
        now: new Date('2026-06-14T12:05:00Z'),
        summarize,
      }),
    ).resolves.toMatchObject({
      digestId: 'digest-1',
      skipped: false,
      payload: { summary: 'Existing digest.' },
    });

    expect(summarize).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('skips generation when the digest window is already past the current cycle', async () => {
    const summarize = vi.fn().mockResolvedValue('Should not be used.');
    const db = {
      select: vi
        .fn(() => chainResult([]))
        .mockReturnValueOnce(
          chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
        )
        .mockReturnValueOnce(chainResult([])),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'digest-expired' }]),
          })),
        })),
      })),
      update: vi.fn(),
    };

    await expect(
      generateDailyDigest({
        db: db as never,
        teamId: 'team-1',
        userId: 'user-1',
        windowStart: new Date('2026-06-13T12:00:00Z'),
        windowEnd: new Date('2026-06-14T12:00:00Z'),
        now: new Date('2026-06-16T15:00:00Z'),
        summarize,
      }),
    ).resolves.toMatchObject({
      digestId: 'digest-expired',
      skipped: true,
      payload: { summary: 'Daily digest window expired.' },
    });

    expect(summarize).not.toHaveBeenCalled();
    expect(fakes.withTeam).not.toHaveBeenCalled();
  });
});
