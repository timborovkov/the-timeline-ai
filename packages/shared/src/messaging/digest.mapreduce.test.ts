import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  withTeam: vi.fn(),
  chatStructured: vi.fn(),
}));

vi.mock('#src/team-scope.js', () => ({ withTeam: fakes.withTeam }));
vi.mock('#src/llm/chat.js', () => ({ chatStructured: fakes.chatStructured }));

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
        returning: vi.fn().mockResolvedValue([{ id: 'digest-new' }]),
      })),
    })),
  };
}

function makeEventBrief(index: number) {
  return {
    source: 'slack',
    occurredAt: new Date(`2026-06-14T10:${String(index % 60).padStart(2, '0')}:00Z`),
    sourceMetadata: { slack_channel_name: 'general' },
    contentText: `Event ${index} content text here.`,
  };
}

function makeScope(events: unknown[]) {
  return {
    requireMembership: vi.fn().mockResolvedValue('member'),
    timeline: {
      team: vi.fn().mockResolvedValue({ name: 'TestTeam' }),
      listAllEventsInWindow: vi.fn().mockResolvedValue(events),
    },
    suggestions: { countPendingSuggestions: vi.fn().mockResolvedValue(0) },
    objects: { listObjects: vi.fn().mockResolvedValue([]) },
    calendar: { listCalendarEvents: vi.fn().mockResolvedValue([]) },
  };
}

function makeDb(selectMocks: unknown[]) {
  let selectIndex = 0;
  return {
    select: vi.fn(() => {
      const mock = selectMocks[selectIndex] ?? chainResult([]);
      selectIndex++;
      return mock;
    }),
    insert: vi.fn(() => insertConflict()),
    update: vi.fn(),
  };
}

function makeDigestResult(summary: string, sections: { title: string; items: string[] }[] = []) {
  return {
    object: { summary, sections },
    model: 'test-model',
  };
}

describe('digest map-reduce summarization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a single LLM call when events fit in one batch', async () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));
    fakes.chatStructured.mockResolvedValue(
      makeDigestResult('Single batch summary.', [
        { title: 'Highlights', items: ['One highlight.'] },
      ]),
    );

    const db = makeDb([
      chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
      chainResult([]),
      chainResult([{ name: 'Tim', email: 'tim@example.test' }]),
      chainResult([]),
    ]);

    const result = await generateDailyDigest({
      db: db as never,
      teamId: 'team-1',
      userId: 'user-1',
      windowStart: new Date('2026-06-13T11:00:00Z'),
      windowEnd: new Date('2026-06-14T12:00:00Z'),
      now: new Date('2026-06-14T12:05:00Z'),
    });

    expect(fakes.chatStructured).toHaveBeenCalledTimes(1);
    expect(result.payload.summary).toBe('Single batch summary.');
    expect(result.payload.eventCount).toBe(10);
  });

  it('splits into batches and reduces when events exceed the batch size', async () => {
    const events = Array.from({ length: 120 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(makeDigestResult('Batch 1 summary.', [{ title: 'Highlights', items: ['A'] }]))
      .mockResolvedValueOnce(makeDigestResult('Batch 2 summary.', [{ title: 'Highlights', items: ['B'] }]))
      .mockResolvedValueOnce(makeDigestResult('Batch 3 summary.', [{ title: 'Completed', items: ['C'] }]))
      .mockResolvedValueOnce(makeDigestResult('Reduced final summary.', [{ title: 'Highlights', items: ['A', 'B'] }, { title: 'Completed', items: ['C'] }]));

    const db = makeDb([
      chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
      chainResult([]),
      chainResult([{ name: 'Tim', email: 'tim@example.test' }]),
      chainResult([]),
    ]);

    const result = await generateDailyDigest({
      db: db as never,
      teamId: 'team-1',
      userId: 'user-1',
      windowStart: new Date('2026-06-13T11:00:00Z'),
      windowEnd: new Date('2026-06-14T12:00:00Z'),
      now: new Date('2026-06-14T12:05:00Z'),
    });

    expect(fakes.chatStructured).toHaveBeenCalledTimes(4);
    expect(result.payload.summary).toBe('Reduced final summary.');
    expect(result.payload.eventCount).toBe(120);
    expect(result.payload.sections).toHaveLength(2);
    expect(result.payload.sections?.[0]?.title).toBe('Highlights');
    expect(result.payload.sections?.[0]?.items).toEqual(['A', 'B']);
  });

  it('falls back to merged batch summaries when reduce fails', async () => {
    const events = Array.from({ length: 60 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(makeDigestResult('Batch 1 summary.', [{ title: 'Highlights', items: ['A'] }]))
      .mockResolvedValueOnce(makeDigestResult('Batch 2 summary.', [{ title: 'Highlights', items: ['B'] }]))
      .mockRejectedValueOnce(new Error('Reduce failed'));

    const db = makeDb([
      chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
      chainResult([]),
      chainResult([{ name: 'Tim', email: 'tim@example.test' }]),
      chainResult([]),
    ]);

    const result = await generateDailyDigest({
      db: db as never,
      teamId: 'team-1',
      userId: 'user-1',
      windowStart: new Date('2026-06-13T11:00:00Z'),
      windowEnd: new Date('2026-06-14T12:00:00Z'),
      now: new Date('2026-06-14T12:05:00Z'),
    });

    expect(fakes.chatStructured).toHaveBeenCalledTimes(3);
    expect(result.payload.summary).toContain('Batch 1 summary.');
    expect(result.payload.summary).toContain('Batch 2 summary.');
    expect(result.payload.sections?.[0]?.title).toBe('Highlights');
    expect(result.payload.sections?.[0]?.items).toEqual(['A', 'B']);
  });

  it('returns fallback when all batches fail', async () => {
    const events = Array.from({ length: 60 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured.mockRejectedValue(new Error('All batches failed'));

    const db = makeDb([
      chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
      chainResult([]),
      chainResult([{ name: 'Tim', email: 'tim@example.test' }]),
      chainResult([]),
    ]);

    const result = await generateDailyDigest({
      db: db as never,
      teamId: 'team-1',
      userId: 'user-1',
      windowStart: new Date('2026-06-13T11:00:00Z'),
      windowEnd: new Date('2026-06-14T12:00:00Z'),
      now: new Date('2026-06-14T12:05:00Z'),
    });

    expect(result.payload.summary).toMatch(/timeline event/);
    expect(result.payload.eventCount).toBe(60);
    expect(result.payload.sections).toEqual([]);
  });
});
