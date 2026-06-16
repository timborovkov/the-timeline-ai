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

class FakeJob {
  constructor(
    private queue: FakeQueue,
    public id: string,
  ) {}

  getState = vi.fn(() => Promise.resolve(this.queue.jobStates.get(this.id) ?? 'waiting'));
  remove = vi.fn(() => {
    this.queue.jobs.delete(this.id);
    this.queue.jobStates.delete(this.id);
    return Promise.resolve();
  });
}

class FakeQueue {
  name: string;
  options: Record<string, unknown>;
  jobs = new Set<string>();
  jobStates = new Map<string, string>();
  add = vi.fn<(name: string, data: unknown, opts?: { jobId?: string }) => Promise<void>>(
    (name, data, opts) => {
      this.addCalls.push({ name, data, opts });
      if (opts?.jobId) {
        this.jobs.add(opts.jobId);
        this.jobStates.set(opts.jobId, 'waiting');
      }
      return Promise.resolve();
    },
  );
  getJob = vi.fn((jobId: string) =>
    Promise.resolve(this.jobs.has(jobId) ? new FakeJob(this, jobId) : null),
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
    expect(fakes.queues[1]?.options).toMatchObject({
      defaultJobOptions: {
        attempts: 6,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    });
    expect(fakes.queues[2]?.addCalls[0]).toMatchObject({
      name: 'team-export',
      opts: { jobId: '44444444-4444-4444-8444-444444444444' },
    });
  });

  it('dedupes delayed conversation review suggestion jobs by review id and suffix', async () => {
    const queues = await importQueues();

    const first = await queues.enqueueSuggestionJob(
      {
        scope: 'conversation_review',
        conversationReviewId: '66666666-6666-4666-8666-666666666666',
        teamId: '22222222-2222-4222-8222-222222222222',
      },
      { delayMs: 600_000, jobIdSuffix: '2026-05-27T10:10:00.000Z' },
    );
    const duplicate = await queues.enqueueSuggestionJob(
      {
        scope: 'conversation_review',
        conversationReviewId: '66666666-6666-4666-8666-666666666666',
        teamId: '22222222-2222-4222-8222-222222222222',
      },
      { delayMs: 600_000, jobIdSuffix: '2026-05-27T10:10:00.000Z' },
    );

    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'suggestions',
      opts: {
        delay: 600_000,
        jobId:
          'conversation-review|66666666-6666-4666-8666-666666666666|2026-05-27T10%3A10%3A00.000Z',
      },
    });
    const jobId = fakes.queues[0]?.addCalls[0]?.opts as { jobId?: string };
    expect(jobId.jobId).not.toContain(':');
    expect(fakes.queues[0]?.addCalls).toHaveLength(1);
    expect(first).toMatchObject({ enqueued: true });
    expect(duplicate).toMatchObject({ enqueued: false });
  });

  it('dedupes manual object cleanup suggestion scans by team and trigger', async () => {
    const queues = await importQueues();
    const data = {
      scope: 'object_cleanup' as const,
      teamId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: 'manual',
    };

    const first = await queues.enqueueSuggestionJob(data, { jobIdSuffix: 'manual' });
    const duplicate = await queues.enqueueSuggestionJob(data, { jobIdSuffix: 'manual' });

    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'suggestions',
      opts: {
        jobId: 'object-cleanup|22222222-2222-4222-8222-222222222222|manual|manual',
      },
    });
    expect(fakes.queues[0]?.addCalls).toHaveLength(1);
    expect(first).toMatchObject({ enqueued: true });
    expect(duplicate).toMatchObject({ enqueued: false });
  });

  it('replaces retained completed or failed suggestion jobs with the same recovery id', async () => {
    const queues = await importQueues();
    const data = {
      scope: 'conversation_review' as const,
      conversationReviewId: '66666666-6666-4666-8666-666666666666',
      teamId: '22222222-2222-4222-8222-222222222222',
    };

    const first = await queues.enqueueSuggestionJob(data, { jobIdSuffix: 'recovery' });
    const firstJobId = first.jobId;
    if (!firstJobId) throw new Error('expected stable job id');
    fakes.queues[0]?.jobStates.set(firstJobId, 'completed');
    const completedRerun = await queues.enqueueSuggestionJob(data, { jobIdSuffix: 'recovery' });
    fakes.queues[0]?.jobStates.set(firstJobId, 'failed');
    const failedRerun = await queues.enqueueSuggestionJob(data, { jobIdSuffix: 'recovery' });

    expect(first).toMatchObject({ enqueued: true, jobId: firstJobId });
    expect(completedRerun).toMatchObject({ enqueued: true, jobId: firstJobId });
    expect(failedRerun).toMatchObject({ enqueued: true, jobId: firstJobId });
    expect(fakes.queues[0]?.addCalls).toHaveLength(3);
  });

  it('removes a delayed conversation review suggestion job by suffix', async () => {
    const queues = await importQueues();
    const data = {
      scope: 'conversation_review' as const,
      conversationReviewId: '66666666-6666-4666-8666-666666666666',
      teamId: '22222222-2222-4222-8222-222222222222',
    };

    const queued = await queues.enqueueSuggestionJob(data, {
      delayMs: 600_000,
      jobIdSuffix: '2026-05-27T10:10:00.000Z',
    });
    const removed = await queues.removeSuggestionJob(data, {
      jobIdSuffix: '2026-05-27T10:10:00.000Z',
    });
    const rerun = await queues.enqueueSuggestionJob(data, {
      delayMs: 600_000,
      jobIdSuffix: '2026-05-27T10:10:00.000Z',
    });

    expect(removed).toEqual({ removed: true, jobId: queued.jobId });
    expect(rerun).toMatchObject({ enqueued: true, jobId: queued.jobId });
    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
  });

  it('dedupes delayed conversation review jobs queued with legacy colon ids', async () => {
    const queues = await importQueues();
    const data = {
      scope: 'conversation_review' as const,
      conversationReviewId: '66666666-6666-4666-8666-666666666666',
      teamId: '22222222-2222-4222-8222-222222222222',
    };
    const legacyJobId =
      'conversation-review:66666666-6666-4666-8666-666666666666:2026-05-27T10:10:00.000Z';
    const suggestionQueue = queues.getSuggestionQueue() as unknown as FakeQueue;
    suggestionQueue.jobs.add(legacyJobId);
    suggestionQueue.jobStates.set(legacyJobId, 'delayed');

    const duplicate = await queues.enqueueSuggestionJob(data, {
      delayMs: 600_000,
      jobIdSuffix: '2026-05-27T10:10:00.000Z',
    });

    expect(duplicate).toEqual({ enqueued: false, jobId: legacyJobId });
    expect(suggestionQueue.addCalls).toHaveLength(0);
  });

  it('removes delayed conversation review jobs queued with legacy colon ids', async () => {
    const queues = await importQueues();
    const data = {
      scope: 'conversation_review' as const,
      conversationReviewId: '66666666-6666-4666-8666-666666666666',
      teamId: '22222222-2222-4222-8222-222222222222',
    };
    const legacyJobId =
      'conversation-review:66666666-6666-4666-8666-666666666666:2026-05-27T10:10:00.000Z';
    const suggestionQueue = queues.getSuggestionQueue() as unknown as FakeQueue;
    suggestionQueue.jobs.add(legacyJobId);
    suggestionQueue.jobStates.set(legacyJobId, 'delayed');

    const removed = await queues.removeSuggestionJob(data, {
      jobIdSuffix: '2026-05-27T10:10:00.000Z',
    });
    const rerun = await queues.enqueueSuggestionJob(data, {
      delayMs: 600_000,
      jobIdSuffix: '2026-05-27T10:10:00.000Z',
    });

    expect(removed).toEqual({ removed: true, jobId: legacyJobId });
    expect(rerun).toMatchObject({
      enqueued: true,
      jobId:
        'conversation-review|66666666-6666-4666-8666-666666666666|2026-05-27T10%3A10%3A00.000Z',
    });
    expect(suggestionQueue.addCalls).toHaveLength(1);
  });

  it('dedupes raw suggestion jobs only when a suffix is provided', async () => {
    const queues = await importQueues();

    await queues.enqueueSuggestionJob({
      rawEventId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
    });
    await queues.enqueueSuggestionJob(
      {
        rawEventId: '11111111-1111-4111-8111-111111111111',
        teamId: '22222222-2222-4222-8222-222222222222',
      },
      { jobIdSuffix: 'recovery:30:all' },
    );

    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'suggestions',
      opts: {},
    });
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      name: 'suggestions',
      opts: {
        jobId: 'raw-event|11111111-1111-4111-8111-111111111111|recovery%3A30%3Aall',
      },
    });
    const jobId = fakes.queues[0]?.addCalls[1]?.opts as { jobId?: string };
    expect(jobId.jobId).not.toContain(':');
  });

  it('dedupes object summary jobs by team and object id', async () => {
    const queues = await importQueues();
    const data = {
      teamId: '22222222-2222-4222-8222-222222222222',
      objectId: '77777777-7777-4777-8777-777777777777',
      trigger: 'auto' as const,
    };

    const first = await queues.enqueueObjectSummaryJob(data, { delayMs: 120_000 });
    const duplicate = await queues.enqueueObjectSummaryJob(data, { delayMs: 120_000 });

    expect(fakes.queues[0]?.name).toBe('object-summary');
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'object-summary',
      data,
      opts: {
        delay: 120_000,
        jobId:
          'object-summary|22222222-2222-4222-8222-222222222222|77777777-7777-4777-8777-777777777777',
      },
    });
    expect(first).toMatchObject({ enqueued: true });
    expect(duplicate).toMatchObject({ enqueued: false, jobId: first.jobId });
  });

  it('registers repeatable jobs with stable job ids and closes singleton queues', async () => {
    const queues = await importQueues();

    await queues.scheduleOverdueScan();
    await queues.scheduleCalendarRecurrenceMaterialization();
    await queues.scheduleJanitorSweep();
    await queues.scheduleMcpHealthPing();

    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'scan',
      opts: { repeat: { pattern: '0 * * * *' }, jobId: 'overdue-scan-hourly' },
    });
    expect(fakes.queues[1]?.addCalls[0]).toMatchObject({
      name: 'materialize',
      opts: { repeat: { pattern: '0 * * * *' }, jobId: 'calendar-recurrence-hourly' },
    });
    expect(fakes.queues[2]?.addCalls[0]).toMatchObject({
      name: 'sweep',
      opts: { repeat: { pattern: '*/5 * * * *' }, jobId: 'janitor-tick' },
    });
    expect(fakes.queues[3]?.addCalls[0]).toMatchObject({
      name: 'mcp-health-tick',
      opts: { repeat: { pattern: '*/5 * * * *' }, jobId: 'mcp-health-tick-5min' },
    });

    await queues.closeOverdueScanQueue();
    await queues.closeCalendarRecurrenceQueue();
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
