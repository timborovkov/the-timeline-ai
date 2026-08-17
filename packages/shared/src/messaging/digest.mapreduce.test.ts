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
        returning: vi.fn().mockResolvedValue([{ id: 'digest-new' }]),
      })),
    })),
  };
}

function makeEventBrief(index: number) {
  return {
    id: `event-${String(index).padStart(4, '0')}`,
    teamId: 'team-1',
    authorUserId: null,
    source: 'slack',
    occurredAt: new Date(`2026-06-14T10:${String(index % 60).padStart(2, '0')}:00Z`),
    createdAt: new Date(`2026-06-14T10:${String(index % 60).padStart(2, '0')}:00Z`),
    sourceMetadata: { slack_channel_name: `general-${index}` },
    contentText: `Event ${index} content text here.`,
    contentAudioUrl: null,
  };
}

function makeScope(events: unknown[]) {
  return {
    requireMembership: vi.fn().mockResolvedValue('member'),
    timeline: {
      team: vi.fn().mockResolvedValue({ name: 'TestTeam' }),
      listAllEventsInWindow: vi.fn().mockResolvedValue(events),
      listMomentPresentations: vi.fn().mockResolvedValue({}),
    },
    suggestions: {
      getApprovalItemCounts: vi.fn().mockResolvedValue({ failed: 0, pending: 0 }),
      listSuggestions: vi.fn().mockResolvedValue([]),
    },
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

function makeDigestResult(
  summary: string,
  sections: { title: string; body?: string; items?: string[] }[] = [],
) {
  return {
    object: {
      summary,
      sections: sections.map((section) => ({
        title: section.title,
        body: section.body ?? section.items?.join(' ') ?? '',
      })),
    },
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
    const firstCall = fakes.chatStructured.mock.calls[0]?.[0] as { system?: string };
    expect(firstCall.system).toContain('Pull-request numbers');
    expect(firstCall.system).toContain('banned');
    expect(firstCall.system).toContain('Status');
    expect(firstCall.system).not.toContain('Product status');
    expect(firstCall.system).toContain('4-7 sentences');
    expect(result.payload.summary).toBe('Single batch summary.');
    expect(result.payload.eventCount).toBe(10);
    expect(result.payload.momentCount).toBe(10);
  });

  it('summarizes bundled moments instead of raw event rows', async () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      ...makeEventBrief(i),
      sourceMetadata: {
        slack_channel_name: 'general',
        slack_channel_id: 'C-general',
        slack_thread_ts: '1780000000.000000',
      },
    }));
    fakes.withTeam.mockReturnValue(makeScope(events));
    fakes.chatStructured.mockResolvedValue(makeDigestResult('Bundled conversation summary.'));

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

    expect(result.payload.eventCount).toBe(10);
    expect(result.payload.momentCount).toBe(1);
    const calls = fakes.chatStructured.mock.calls as unknown as [{ prompt: string }, unknown][];
    const prompt = calls[0]?.[0]?.prompt;
    expect(prompt).toBeDefined();
    const packet = JSON.parse(prompt ?? '{}') as {
      metrics?: { eventCount?: number; momentCount?: number };
      visibleEvents?: unknown;
      visibleMoments?: { rawEventCount: number; title: string }[];
    };
    expect(packet.metrics).toMatchObject({ eventCount: 10, momentCount: 1 });
    expect(packet.visibleEvents).toBeUndefined();
    expect(packet.visibleMoments).toHaveLength(1);
    expect(packet.visibleMoments?.[0]).toMatchObject({ rawEventCount: 10 });
    expect(packet.visibleMoments?.[0]).not.toHaveProperty('rawEventIds');
    expect(packet.visibleMoments?.[0]?.title).not.toMatch(/#\d{2,}/);
  });

  it('splits into batches and reduces when events exceed the batch size', async () => {
    const events = Array.from({ length: 120 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(
        makeDigestResult('Batch 1 summary.', [{ title: 'Highlights', items: ['A'] }]),
      )
      .mockResolvedValueOnce(
        makeDigestResult('Batch 2 summary.', [{ title: 'Highlights', items: ['B'] }]),
      )
      .mockResolvedValueOnce(
        makeDigestResult('Batch 3 summary.', [{ title: 'Completed', items: ['C'] }]),
      )
      .mockResolvedValueOnce(
        makeDigestResult('Reduced final summary.', [
          { title: 'Highlights', items: ['A', 'B'] },
          { title: 'Completed', items: ['C'] },
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

    expect(fakes.chatStructured).toHaveBeenCalledTimes(4);
    expect(result.payload.summary).toBe('Reduced final summary.');
    expect(result.payload.eventCount).toBe(120);
    expect(result.payload.sections).toHaveLength(2);
    expect(result.payload.sections?.[0]?.title).toBe('Highlights');
    expect(result.payload.sections?.[0]?.body).toBe('A B');
  });

  it('falls back to merged batch summaries when reduce fails', async () => {
    const events = Array.from({ length: 60 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(
        makeDigestResult('Batch 1 summary.', [{ title: 'Highlights', items: ['A'] }]),
      )
      .mockResolvedValueOnce(
        makeDigestResult('Batch 2 summary.', [{ title: 'Highlights', items: ['B'] }]),
      )
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
    expect(result.payload.sections?.[0]?.body).toBe('A B');
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

    expect(result.payload.summary).toMatch(/60 new moments/);
    expect(result.payload.summary).not.toMatch(/from 60 source events/);
    expect(result.payload.eventCount).toBe(60);
    expect(result.payload.sections).toEqual([]);
  });

  it('uses a single LLM call at exactly the batch size boundary (50 events)', async () => {
    const events = Array.from({ length: 50 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));
    fakes.chatStructured.mockResolvedValue(
      makeDigestResult('Boundary summary.', [{ title: 'Highlights', items: ['Edge case.'] }]),
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
    expect(result.payload.summary).toBe('Boundary summary.');
    expect(result.payload.eventCount).toBe(50);
  });

  it('triggers map-reduce at 51 events (one past the boundary)', async () => {
    const events = Array.from({ length: 51 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(makeDigestResult('Batch 1 summary.'))
      .mockResolvedValueOnce(makeDigestResult('Batch 2 summary.'))
      .mockResolvedValueOnce(makeDigestResult('Reduced summary.'));

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
    expect(result.payload.summary).toBe('Reduced summary.');
    expect(result.payload.eventCount).toBe(51);
  });

  it('returns fallback when the single-batch LLM call fails', async () => {
    const events = Array.from({ length: 5 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));
    fakes.chatStructured.mockRejectedValue(new Error('Single call failed'));

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
    expect(result.payload.summary).toMatch(/5 new moments/);
    expect(result.payload.summary).not.toMatch(/from 5 source events/);
    expect(result.payload.eventCount).toBe(5);
    expect(result.payload.sections).toEqual([]);
  });

  it('reduces only successful batches when some fail', async () => {
    const events = Array.from({ length: 120 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(
        makeDigestResult('Batch 1 summary.', [{ title: 'Highlights', items: ['A'] }]),
      )
      .mockRejectedValueOnce(new Error('Batch 2 failed'))
      .mockResolvedValueOnce(
        makeDigestResult('Batch 3 summary.', [{ title: 'Completed', items: ['C'] }]),
      )
      .mockResolvedValueOnce(
        makeDigestResult('Reduced from 2 of 3.', [
          { title: 'Highlights', items: ['A'] },
          { title: 'Completed', items: ['C'] },
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

    expect(fakes.chatStructured).toHaveBeenCalledTimes(4);
    expect(result.payload.summary).toBe('Reduced from 2 of 3.');
    expect(result.payload.sections).toHaveLength(2);
  });

  it('returns the single successful batch without reduce when only one survives', async () => {
    const events = Array.from({ length: 120 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockRejectedValueOnce(new Error('Batch 1 failed'))
      .mockResolvedValueOnce(
        makeDigestResult('Only batch 2 succeeded.', [{ title: 'Highlights', items: ['B'] }]),
      )
      .mockRejectedValueOnce(new Error('Batch 3 failed'));

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
    expect(result.payload.summary).toBe('Only batch 2 succeeded.');
    expect(result.payload.sections?.[0]?.body).toBe('B');
  });

  it('bypasses map-reduce when summarize injection is provided, even with many events', async () => {
    const events = Array.from({ length: 200 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));
    const summarize = vi.fn().mockResolvedValue('Injected summary.');

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
      summarize,
    });

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(fakes.chatStructured).not.toHaveBeenCalled();
    expect(result.payload.summary).toBe('Injected summary.');
    expect(result.payload.eventCount).toBe(200);
  });

  it('deduplicates overlapping items and orders sections canonically in mergeSections', async () => {
    const events = Array.from({ length: 60 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(
        makeDigestResult('Batch 1.', [
          { title: 'Risks', items: ['Risk A', 'Risk B'] },
          { title: 'Highlights', items: ['Shared highlight'] },
        ]),
      )
      .mockResolvedValueOnce(
        makeDigestResult('Batch 2.', [
          { title: 'Highlights', items: ['Shared highlight', 'Unique highlight'] },
          { title: 'Completed', items: ['Done thing'] },
        ]),
      )
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

    expect(result.payload.sections).toEqual([
      {
        title: 'Highlights',
        body: 'Shared highlight Shared highlight Unique highlight',
        items: [],
      },
      { title: 'Completed', body: 'Done thing', items: [] },
      { title: 'Risks', body: 'Risk A Risk B', items: [] },
    ]);
  });

  it('includes batch index and total in batch prompts but not in single-batch prompts', async () => {
    const events = Array.from({ length: 120 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));

    fakes.chatStructured
      .mockResolvedValueOnce(makeDigestResult('B1.'))
      .mockResolvedValueOnce(makeDigestResult('B2.'))
      .mockResolvedValueOnce(makeDigestResult('B3.'))
      .mockResolvedValueOnce(makeDigestResult('Reduced.'));

    const db = makeDb([
      chainResult([{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]),
      chainResult([]),
      chainResult([{ name: 'Tim', email: 'tim@example.test' }]),
      chainResult([]),
    ]);

    await generateDailyDigest({
      db: db as never,
      teamId: 'team-1',
      userId: 'user-1',
      windowStart: new Date('2026-06-13T11:00:00Z'),
      windowEnd: new Date('2026-06-14T12:00:00Z'),
      now: new Date('2026-06-14T12:05:00Z'),
    });

    const calls = fakes.chatStructured.mock.calls as unknown as [{ prompt: string }, unknown][];
    const batch1Prompt = calls[0]?.[0]?.prompt;
    const batch2Prompt = calls[1]?.[0]?.prompt;
    const reducePrompt = calls[3]?.[0]?.prompt;

    expect(batch1Prompt).toContain('"batch"');
    expect(batch1Prompt).toContain('batch 1 of 3');
    expect(batch2Prompt).toContain('batch 2 of 3');
    expect(reducePrompt).toContain('batchSummaries');
    expect(reducePrompt).not.toContain('"batch"');
  });

  it('handles actionable context with zero events in a single LLM call', async () => {
    const scope = makeScope([]);
    scope.suggestions.getApprovalItemCounts.mockResolvedValue({ failed: 0, pending: 1 });
    fakes.withTeam.mockReturnValue(scope);
    fakes.chatStructured.mockResolvedValue(makeDigestResult('No activity today.', []));

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
    expect(result.payload.summary).toBe('No activity today.');
    expect(result.payload.eventCount).toBe(0);
    expect(result.payload.sections).toEqual([]);
  });

  it('retries once when the model lists pull-request numbers, then keeps the clean rewrite', async () => {
    const events = [
      {
        ...makeEventBrief(0),
        source: 'github',
        contentText: 'Merged login timeout fix #412',
      },
    ];
    fakes.withTeam.mockReturnValue(makeScope(events));
    fakes.chatStructured
      .mockResolvedValueOnce(makeDigestResult('Merged #412, #413, and #414.'))
      .mockResolvedValueOnce(
        makeDigestResult('The login timeout fix shipped after review.', [
          { title: 'Highlights', body: 'The timeout bug is gone from the invite flow.' },
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

    expect(fakes.chatStructured).toHaveBeenCalledTimes(2);
    const retryPrompt = (fakes.chatStructured.mock.calls[1]?.[0] as { prompt?: string }).prompt;
    expect(retryPrompt).toContain('Those identifiers are banned');
    expect(result.payload.summary).toBe('The login timeout fix shipped after review.');
    expect(result.payload.summary).not.toMatch(/#\d+/);
  });

  it('falls back when a rewrite still lists pull-request numbers', async () => {
    const events = Array.from({ length: 3 }, (_, i) => makeEventBrief(i));
    fakes.withTeam.mockReturnValue(makeScope(events));
    fakes.chatStructured.mockResolvedValue(makeDigestResult('PRs merged: #12, #15, and #18.'));

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

    expect(fakes.chatStructured).toHaveBeenCalledTimes(2);
    expect(result.payload.summary).toMatch(/3 new moments/);
    expect(result.payload.summary).not.toMatch(/#\d+/);
    expect(result.payload.sections).toEqual([]);
  });
});
