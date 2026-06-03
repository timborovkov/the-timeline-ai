import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Queue contract tests. The product relies on job payloads and retry policy
 * staying stable across web routes, workers, and recovery scripts; BullMQ and
 * Redis are mocked so these assertions cover our wrapper boundary only.
 */

const fakes = vi.hoisted(() => ({
  queues: [] as FakeQueue[],
  redisInstances: [] as unknown[],
}));

interface AddCall {
  name: string;
  data: unknown;
  opts?: unknown;
}

class FakeQueue {
  name: string;
  options: Record<string, unknown>;
  add = vi.fn<(name: string, data: unknown, opts?: unknown) => Promise<void>>(
    (name, data, opts) => {
      this.addCalls.push({ name, data, opts });
      return Promise.resolve();
    },
  );
  addCalls: AddCall[] = [];
  close = vi.fn(() => Promise.resolve());

  constructor(name: string, options: Record<string, unknown>) {
    this.name = name;
    this.options = options;
    fakes.queues.push(this);
  }
}

vi.mock('bullmq', () => ({ Queue: FakeQueue }));
vi.mock('ioredis', () => ({
  default: class FakeRedis {
    constructor(
      public url: string,
      public options: Record<string, unknown>,
    ) {
      fakes.redisInstances.push(this);
    }
    quit = vi.fn(() => Promise.resolve());
  },
}));

async function importQueues() {
  process.env.AUTH_SECRET = 'test-secret-at-least-sixteen-characters';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  return import('./index.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fakes.queues = [];
  fakes.redisInstances = [];
});

describe('queue wrappers', () => {
  it('constructs core queues with stable names and retry/backoff defaults', async () => {
    const queues = await importQueues();

    await queues.enqueueExtractJob({
      rawEventId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
    });
    await queues.enqueueSuggestionJob({
      rawEventId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
    });
    await queues.enqueueDocumentExtractJob({
      documentVersionId: '33333333-3333-4333-8333-333333333333',
      teamId: '22222222-2222-4222-8222-222222222222',
    });

    expect(fakes.queues.map((queue) => queue.name)).toEqual([
      'extract',
      'suggestions',
      'document-extract',
    ]);
    expect(fakes.queues[0]?.options).toMatchObject({
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    });
    expect(fakes.queues[1]?.options).toMatchObject({
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
    });
    expect(fakes.queues[2]?.options).toMatchObject({
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    });
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({ name: 'extract' });
    expect(fakes.queues[1]?.addCalls[0]).toMatchObject({ name: 'suggestions' });
    expect(fakes.queues[2]?.addCalls[0]).toMatchObject({ name: 'document-extract' });
  });

  it('keeps worker-idempotent queues free of jobId dedupe but uses explicit ids where required', async () => {
    const queues = await importQueues();

    await queues.enqueueTranscribeJob({
      rawEventId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      audioKey: 'audio/key.webm',
    });
    await queues.enqueueEmbedJob({
      rawEventId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
    });
    await queues.enqueueTeamExportJob({
      teamExportId: '44444444-4444-4444-8444-444444444444',
      teamId: '22222222-2222-4222-8222-222222222222',
      requestedByUserId: '55555555-5555-4555-8555-555555555555',
    });

    expect(fakes.queues[0]?.addCalls[0]?.opts).toBeUndefined();
    expect(fakes.queues[1]?.addCalls[0]?.opts).toBeUndefined();
    expect(fakes.queues[2]?.addCalls[0]).toMatchObject({
      name: 'team-export',
      opts: { jobId: '44444444-4444-4444-8444-444444444444' },
    });
  });

  it('registers repeatable jobs with stable job ids and closes singleton queues', async () => {
    const queues = await importQueues();

    await queues.scheduleOverdueScan();
    await queues.scheduleJanitorSweep();
    await queues.scheduleMcpHealthPing();

    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'scan',
      opts: { repeat: { pattern: '0 * * * *' }, jobId: 'overdue-scan-hourly' },
    });
    expect(fakes.queues[1]?.addCalls[0]).toMatchObject({
      name: 'sweep',
      opts: { repeat: { pattern: '*/5 * * * *' }, jobId: 'janitor-tick' },
    });
    expect(fakes.queues[2]?.addCalls[0]).toMatchObject({
      name: 'mcp-health-tick',
      opts: { repeat: { pattern: '*/5 * * * *' }, jobId: 'mcp-health-tick-5min' },
    });

    await queues.closeOverdueScanQueue();
    await queues.closeJanitorQueue();
    await queues.closeMcpHealthQueue();
    expect(fakes.queues.every((queue) => queue.close.mock.calls.length === 1)).toBe(true);

    await queues.scheduleOverdueScan();
    expect(fakes.queues.filter((queue) => queue.name === 'overdue-scan')).toHaveLength(2);
  });

  it('requires Redis configuration before constructing queues', async () => {
    process.env.AUTH_SECRET = 'test-secret-at-least-sixteen-characters';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    delete process.env.REDIS_URL;
    const queues = await import('./index.js');

    expect(() => queues.getExtractQueue()).toThrow('REDIS_URL is required');
  });
});
