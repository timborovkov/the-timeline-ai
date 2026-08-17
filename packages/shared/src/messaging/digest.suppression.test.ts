import { beforeEach, describe, expect, it, vi } from 'vitest';

// A daily digest should only consume summarization and email capacity when the
// recipient has fresh activity or useful actionable context to catch up on.
const fakes = vi.hoisted(() => ({
  withTeam: vi.fn(),
  chatStructured: vi.fn(),
}));

vi.mock('#src/team-scope.js', () => ({ withTeam: fakes.withTeam }));
vi.mock('#src/llm/chat.js', () => ({ chatStructured: fakes.chatStructured }));

const { generateDailyDigest } = await import('#src/messaging/digest.js');

const WINDOW_START = new Date('2026-06-13T11:00:00Z');
const FRESH_CUTOFF = new Date('2026-06-13T12:00:00Z');
const WINDOW_END = new Date('2026-06-14T12:00:00Z');
const NOW = new Date('2026-06-14T12:05:00Z');

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

function makeEvent(input: { id: string; occurredAt: Date; createdAt: Date }) {
  return {
    id: input.id,
    teamId: 'team-1',
    authorUserId: null,
    source: 'slack' as const,
    occurredAt: input.occurredAt,
    createdAt: input.createdAt,
    sourceMetadata: { slack_channel_name: 'general' },
    contentText: `Activity from ${input.id}.`,
    contentAudioUrl: null,
  };
}

function makeScope(
  input: {
    events?: ReturnType<typeof makeEvent>[];
    pendingApprovals?: number;
    tasks?: unknown[];
    createdTasks?: unknown[];
    completedTasks?: unknown[];
    suggestions?: unknown[];
    upcomingCalendar?: unknown[];
  } = {},
) {
  return {
    requireMembership: vi.fn().mockResolvedValue('member'),
    timeline: {
      team: vi.fn().mockResolvedValue({ name: 'TestTeam' }),
      listAllEventsInWindow: vi.fn().mockResolvedValue(input.events ?? []),
      listMomentPresentations: vi.fn().mockResolvedValue({}),
    },
    suggestions: {
      getApprovalItemCounts: vi
        .fn()
        .mockResolvedValue({ failed: 0, pending: input.pendingApprovals ?? 0 }),
      listSuggestions: vi.fn().mockResolvedValue(input.suggestions ?? []),
    },
    objects: {
      listObjects: vi.fn().mockImplementation((filter: { createdAfter?: Date; status?: unknown } = {}) => {
        if (filter.status) return Promise.resolve(input.completedTasks ?? []);
        if (filter.createdAfter) return Promise.resolve(input.createdTasks ?? []);
        return Promise.resolve(input.tasks ?? []);
      }),
    },
    calendar: { listCalendarEvents: vi.fn().mockResolvedValue(input.upcomingCalendar ?? []) },
  };
}

function makeDb(input: {
  preference?: { dailyDigestEnabled: boolean; dailyDigestHour: number; timezone: string };
  existing?: { id: string; status: string; payload: unknown }[];
  conflict?: { id: string; status: string; payload: unknown }[];
  newMembers?: unknown[];
  changedObjects?: unknown[];
  insertId?: string | null;
  updateId?: string | null;
}) {
  const insertedValues: unknown[] = [];
  const updatedValues: unknown[] = [];
  const returnedUpdateId =
    input.updateId === null ? null : (input.updateId ?? input.existing?.[0]?.id ?? 'digest-1');
  const selectRows = [
    [
      input.preference ?? {
        dailyDigestEnabled: true,
        dailyDigestHour: 12,
        timezone: 'UTC',
      },
    ],
    input.existing ?? [],
    [{ name: 'Tim', email: 'tim@example.test' }],
    input.newMembers ?? [],
    input.changedObjects ?? [],
    input.conflict ?? [],
  ];
  let selectIndex = 0;
  return {
    insertedValues,
    updatedValues,
    select: vi.fn(() => chainResult(selectRows[selectIndex++] ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        insertedValues.push(values);
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi
              .fn()
              .mockResolvedValue(
                input.insertId === null ? [] : [{ id: input.insertId ?? 'digest-new' }],
              ),
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        updatedValues.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi
              .fn()
              .mockResolvedValue(returnedUpdateId ? [{ id: returnedUpdateId }] : []),
          })),
        };
      }),
    })),
  };
}

async function generate(input: {
  db: ReturnType<typeof makeDb>;
  summarize?: (prompt: string) => Promise<string>;
  windowStart?: Date;
  windowEnd?: Date;
  now?: Date;
}) {
  return generateDailyDigest({
    db: input.db as never,
    teamId: 'team-1',
    userId: 'user-1',
    windowStart: input.windowStart ?? WINDOW_START,
    windowEnd: input.windowEnd ?? WINDOW_END,
    now: input.now ?? NOW,
    ...(input.summarize ? { summarize: input.summarize } : {}),
  });
}

describe('daily digest useful-content suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('durably skips a quiet window without calling the summarizer', async () => {
    fakes.withTeam.mockReturnValue(makeScope());
    const db = makeDb({});
    const summarize = vi.fn().mockResolvedValue('Should not be used.');

    await expect(generate({ db, summarize })).resolves.toMatchObject({
      digestId: 'digest-new',
      skipped: true,
      payload: {
        summary: 'No useful activity for this digest window.',
        eventCount: 0,
        momentCount: 0,
      },
    });

    expect(summarize).not.toHaveBeenCalled();
    expect(fakes.chatStructured).not.toHaveBeenCalled();
    expect(db.insertedValues).toContainEqual(
      expect.objectContaining({
        status: 'skipped',
        summary: 'No useful activity for this digest window.',
        error: 'No useful digest content in this window.',
      }),
    );
  });

  it('does not let unchanged active tasks trigger a digest', async () => {
    fakes.withTeam.mockReturnValue(
      makeScope({
        tasks: [
          {
            id: 'task-1',
            type: 'task',
            canonicalName: 'Standing backlog task',
            status: 'todo',
            dueAt: null,
            metadata: {},
          },
        ],
      }),
    );
    const db = makeDb({});
    const summarize = vi.fn().mockResolvedValue('Should not be used.');

    const result = await generate({ db, summarize });

    expect(result.skipped).toBe(true);
    expect(result.payload.tasks).toHaveLength(0);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('treats the full fall-back local digest cycle as fresh', async () => {
    const windowStart = new Date('2026-10-24T09:00:00Z');
    const windowEnd = new Date('2026-10-25T10:00:00Z');
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'fall-back-event',
            occurredAt: new Date('2026-10-24T09:30:00Z'),
            createdAt: new Date('2026-10-24T09:31:00Z'),
          }),
        ],
      }),
    );
    const db = makeDb({
      preference: {
        dailyDigestEnabled: true,
        dailyDigestHour: 12,
        timezone: 'Europe/Helsinki',
      },
    });

    await expect(
      generate({
        db,
        windowStart,
        windowEnd,
        now: new Date('2026-10-25T10:05:00Z'),
        summarize: vi.fn().mockResolvedValue('Fall-back activity.'),
      }),
    ).resolves.toMatchObject({
      skipped: false,
      payload: { summary: 'Fall-back activity.' },
    });
  });

  it('does not replay spring-forward overlap activity from the prior local cycle', async () => {
    const windowStart = new Date('2026-03-28T08:00:00Z');
    const windowEnd = new Date('2026-03-29T09:00:00Z');
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'spring-forward-overlap',
            occurredAt: new Date('2026-03-28T09:30:00Z'),
            createdAt: new Date('2026-03-28T09:31:00Z'),
          }),
        ],
      }),
    );
    const db = makeDb({
      preference: {
        dailyDigestEnabled: true,
        dailyDigestHour: 12,
        timezone: 'Europe/Helsinki',
      },
    });
    const summarize = vi.fn().mockResolvedValue('Should not be used.');

    await expect(
      generate({
        db,
        windowStart,
        windowEnd,
        now: new Date('2026-03-29T09:05:00Z'),
        summarize,
      }),
    ).resolves.toMatchObject({
      skipped: true,
      payload: { summary: 'No useful activity for this digest window.' },
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  it('uses the configured hour for the previous boundary across a spring DST gap', async () => {
    const windowStart = new Date('2026-03-28T00:00:00Z');
    const windowEnd = new Date('2026-03-29T01:00:00Z');
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'spring-gap-cycle-event',
            occurredAt: new Date('2026-03-28T01:30:00Z'),
            createdAt: new Date('2026-03-28T01:31:00Z'),
          }),
        ],
      }),
    );
    const db = makeDb({
      preference: {
        dailyDigestEnabled: true,
        dailyDigestHour: 3,
        timezone: 'Europe/Helsinki',
      },
    });

    await expect(
      generate({
        db,
        windowStart,
        windowEnd,
        now: new Date('2026-03-29T01:05:00Z'),
        summarize: vi.fn().mockResolvedValue('Spring gap activity.'),
      }),
    ).resolves.toMatchObject({
      skipped: false,
      payload: { summary: 'Spring gap activity.' },
    });
  });

  it.each([
    {
      label: 'pending approvals',
      scope: makeScope({ pendingApprovals: 1 }),
      db: makeDb({}),
    },
    {
      label: 'an upcoming calendar item',
      scope: makeScope({
        upcomingCalendar: [
          {
            id: 'calendar-1',
            title: 'Planning review',
            startAt: new Date('2026-06-15T09:00:00Z'),
            endAt: new Date('2026-06-15T10:00:00Z'),
          },
        ],
      }),
      db: makeDb({}),
    },
    {
      label: 'a fresh object change',
      scope: makeScope(),
      db: makeDb({ changedObjects: [{ type: 'project', total: 1 }] }),
    },
    {
      label: 'a new team member',
      scope: makeScope(),
      db: makeDb({
        newMembers: [
          {
            userId: 'user-2',
            name: 'Ada',
            email: 'ada@example.test',
            createdAt: FRESH_CUTOFF,
          },
        ],
      }),
    },
  ])('generates a digest for $label', async ({ scope, db }) => {
    fakes.withTeam.mockReturnValue(scope);
    const summarize = vi.fn().mockResolvedValue('Useful digest.');

    await expect(generate({ db, summarize })).resolves.toMatchObject({
      skipped: false,
      payload: { summary: 'Useful digest.' },
    });
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('does not let an already-seen overlap event trigger another digest', async () => {
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'overlap-old',
            occurredAt: new Date('2026-06-13T11:30:00Z'),
            createdAt: new Date('2026-06-13T11:31:00Z'),
          }),
        ],
      }),
    );
    const db = makeDb({});
    const summarize = vi.fn().mockResolvedValue('Should not be used.');

    const result = await generate({ db, summarize });

    expect(result.skipped).toBe(true);
    expect(result.payload).toMatchObject({ eventCount: 1, momentCount: 1 });
    expect(summarize).not.toHaveBeenCalled();
  });

  it('generates for a late-ingested event from the overlap', async () => {
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'overlap-late',
            occurredAt: new Date('2026-06-13T11:30:00Z'),
            createdAt: new Date('2026-06-13T12:01:00Z'),
          }),
        ],
      }),
    );
    const db = makeDb({});
    const summarize = vi.fn().mockResolvedValue('Late evidence arrived.');

    await expect(generate({ db, summarize })).resolves.toMatchObject({
      skipped: false,
      payload: { summary: 'Late evidence arrived.' },
    });
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('defers post-boundary ingests even when another trigger generates the digest', async () => {
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'post-boundary-ingest',
            occurredAt: new Date('2026-06-14T11:30:00Z'),
            createdAt: new Date('2026-06-14T12:01:00Z'),
          }),
        ],
        pendingApprovals: 1,
      }),
    );
    const db = makeDb({});
    const summarize = vi.fn().mockResolvedValue('Approval needs attention.');

    await expect(generate({ db, summarize })).resolves.toMatchObject({
      skipped: false,
      payload: {
        summary: 'Approval needs attention.',
        eventCount: 0,
        momentCount: 0,
      },
    });
    expect(summarize).toHaveBeenCalledOnce();
    expect(summarize.mock.calls[0]?.[0]).not.toContain('Activity from post-boundary-ingest.');
  });

  it('generates for an event that occurred in the fresh window', async () => {
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'fresh-event',
            occurredAt: new Date('2026-06-13T12:01:00Z'),
            createdAt: new Date('2026-06-13T12:01:00Z'),
          }),
        ],
      }),
    );
    const db = makeDb({});
    const summarize = vi.fn().mockResolvedValue('Fresh activity.');

    await expect(generate({ db, summarize })).resolves.toMatchObject({
      skipped: false,
      payload: { summary: 'Fresh activity.' },
    });
  });

  it('upgrades a quiet skipped row when useful content later arrives', async () => {
    fakes.withTeam.mockReturnValue(makeScope({ pendingApprovals: 1 }));
    const db = makeDb({
      existing: [{ id: 'digest-quiet', status: 'skipped', payload: {} }],
      insertId: null,
    });
    const summarize = vi.fn().mockResolvedValue('Approval needs attention.');

    await expect(generate({ db, summarize })).resolves.toMatchObject({
      digestId: 'digest-quiet',
      skipped: false,
      payload: { summary: 'Approval needs attention.' },
    });
    expect(db.updatedValues).toContainEqual(
      expect.objectContaining({ status: 'generated', error: null }),
    );
  });

  it('keeps reprocessing of an existing quiet row idempotently skipped', async () => {
    fakes.withTeam.mockReturnValue(makeScope());
    const db = makeDb({
      existing: [{ id: 'digest-quiet', status: 'skipped', payload: {} }],
      insertId: null,
    });

    await expect(generate({ db })).resolves.toMatchObject({
      digestId: 'digest-quiet',
      skipped: true,
      payload: { summary: 'No useful activity for this digest window.' },
    });
    expect(db.updatedValues).toContainEqual(
      expect.objectContaining({
        status: 'skipped',
        error: 'No useful digest content in this window.',
      }),
    );
  });

  it('preserves a generated row that wins a concurrent quiet-window insert', async () => {
    fakes.withTeam.mockReturnValue(makeScope());
    const storedPayload = {
      summary: 'Concurrent useful digest.',
      eventCount: 1,
      momentCount: 1,
    };
    const db = makeDb({
      conflict: [{ id: 'digest-concurrent', status: 'generated', payload: storedPayload }],
      insertId: null,
    });

    await expect(generate({ db })).resolves.toMatchObject({
      digestId: 'digest-concurrent',
      skipped: false,
      payload: storedPayload,
    });
    expect(db.updatedValues).toEqual([]);
  });

  it('preserves a digest that becomes generated before quiet persistence', async () => {
    fakes.withTeam.mockReturnValue(makeScope());
    const generatedPayload = {
      summary: 'Useful digest won the retry race.',
      sections: [],
    };
    const db = makeDb({
      existing: [{ id: 'digest-existing', status: 'skipped', payload: {} }],
      conflict: [{ id: 'digest-existing', status: 'generated', payload: generatedPayload }],
      insertId: null,
      updateId: null,
    });

    await expect(generate({ db })).resolves.toMatchObject({
      digestId: 'digest-existing',
      payload: generatedPayload,
      skipped: false,
    });
  });

  it('preserves a digest that becomes sent before useful-content persistence', async () => {
    fakes.withTeam.mockReturnValue(
      makeScope({
        events: [
          makeEvent({
            id: 'fresh-event',
            occurredAt: new Date('2026-06-14T11:00:00Z'),
            createdAt: new Date('2026-06-14T11:01:00Z'),
          }),
        ],
      }),
    );
    const sentPayload = {
      summary: 'Already delivered digest.',
      sections: [],
    };
    const db = makeDb({
      existing: [{ id: 'digest-existing', status: 'skipped', payload: {} }],
      conflict: [{ id: 'digest-existing', status: 'sent', payload: sentPayload }],
      insertId: null,
      updateId: null,
    });

    await expect(
      generate({ db, summarize: vi.fn().mockResolvedValue('Fresh useful activity.') }),
    ).resolves.toMatchObject({
      digestId: 'digest-existing',
      payload: sentPayload,
      skipped: false,
    });
  });
});
