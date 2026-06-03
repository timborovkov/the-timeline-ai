import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  whereArgs: [] as unknown[],
  queryResults: [] as unknown[][],
  requireRedisQueue: vi.fn(),
}));

function queryResult(rows: unknown[]) {
  return {
    limit: vi.fn(() => Promise.resolve(rows)),
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
}

vi.mock('@timeline/db', () => ({
  facts: { rawEventId: 'fact_raw_event_id' },
  rawEvents: {
    id: 'id',
    teamId: 'team_id',
    contentAudioUrl: 'content_audio_url',
    contentText: 'content_text',
    createdAt: 'created_at',
    sourceMetadata: 'source_metadata',
    visibility: 'visibility',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  isNotNull: (arg: unknown) => ({ op: 'isNotNull', arg }),
  isNull: (arg: unknown) => ({ op: 'isNull', arg }),
  lt: (...args: unknown[]) => ({ op: 'lt', args }),
  notExists: (arg: unknown) => ({ op: 'notExists', arg }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    strings: Array.from(strings),
    values,
  }),
}));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: fakes.requireRedisQueue }));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (arg: unknown) => {
          fakes.whereArgs.push(arg);
          return queryResult(fakes.queryResults.shift() ?? []);
        },
      }),
    }),
  },
}));

const { reconcileOrphanedJobs } = await import('./reconcile-jobs.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.whereArgs = [];
  fakes.queryResults = [[{ count: 0 }], [], [], []];
  fakes.requireRedisQueue.mockResolvedValue({
    getTranscribeQueue: () => ({ getJobs: vi.fn(() => Promise.resolve([])) }),
    getExtractQueue: () => ({ getJobs: vi.fn(() => Promise.resolve([])) }),
    getEmbedQueue: () => ({ getJobs: vi.fn(() => Promise.resolve([])) }),
  });
});

describe('reconcileOrphanedJobs', () => {
  it('does not select privacy-skipped raw events for extract or embed recovery', async () => {
    await reconcileOrphanedJobs({ now: new Date('2026-06-03T12:00:00.000Z') });

    const serializedWheres = JSON.stringify(fakes.whereArgs);
    expect(serializedWheres).toContain('extraction_skipped_at');
    expect(serializedWheres).toContain('embedding_skipped_at');
    expect(serializedWheres).toContain('visibility');
  });
});
