import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

interface SchedulerCall {
  id: string;
  repeatOpts: unknown;
  template?: unknown;
}

class FakeJob {
  constructor(
    private queue: FakeQueue,
    public id: string,
  ) {}

  getState = vi.fn(() => {
    if (this.queue.stateReadFailures.has(this.id)) {
      return Promise.reject(new Error('state read failed'));
    }
    return Promise.resolve(this.queue.jobStates.get(this.id) ?? 'waiting');
  });
  remove = vi.fn(() => {
    if (this.queue.removeFailures.has(this.id)) {
      return Promise.reject(new Error('remove failed'));
    }
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
  stateReadFailures = new Set<string>();
  removeFailures = new Set<string>();
  add = vi.fn<
    (name: string, data: unknown, opts?: { delay?: number; jobId?: string }) => Promise<void>
  >((name, data, opts) => {
    this.addCalls.push({ name, data, opts });
    if (opts?.jobId) {
      this.jobs.add(opts.jobId);
      this.jobStates.set(opts.jobId, opts.delay ? 'delayed' : 'waiting');
    }
    return Promise.resolve();
  });
  upsertJobScheduler = vi.fn((id: string, repeatOpts: unknown, template?: unknown) => {
    this.schedulerCalls.push({ id, repeatOpts, template });
    return Promise.resolve();
  });
  removeRepeatable = vi.fn(() => Promise.resolve(true));
  getJob = vi.fn((jobId: string) =>
    Promise.resolve(this.jobs.has(jobId) ? new FakeJob(this, jobId) : null),
  );
  addCalls: AddCall[] = [];
  schedulerCalls: SchedulerCall[] = [];
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

afterEach(() => {
  delete process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED;
  delete process.env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED;
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
  }, 20_000);

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

  it('dedupes webhook delivery processing by delivery id', async () => {
    const queues = await importQueues();

    await queues.enqueueWebhookDeliveryJob({
      deliveryId: '11111111-1111-4111-8111-111111111111',
    });

    expect(fakes.queues[0]?.name).toBe('webhook-delivery');
    expect(fakes.queues[0]?.options).toMatchObject({
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    });
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'webhook-delivery',
      data: { deliveryId: '11111111-1111-4111-8111-111111111111' },
      opts: { jobId: 'webhook-delivery|11111111-1111-4111-8111-111111111111' },
    });
  });

  it('coalesces targeted integration sync bursts by resource while leaving broad syncs undeduped', async () => {
    const queues = await importQueues();
    const targeted = {
      kind: 'targeted' as const,
      integrationId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: 'webhook',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      reason: 'github_repo_webhook',
    };

    await queues.enqueueIntegrationSyncJob(targeted);
    await queues.enqueueIntegrationSyncJob({ ...targeted, reason: 'duplicate_delivery' });
    await queues.enqueueIntegrationSyncJob({
      kind: 'incremental',
      integrationId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: 'tick',
    });
    await queues.enqueueIntegrationSyncJob({
      kind: 'incremental',
      integrationId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: 'tick',
    });

    expect(fakes.queues[0]?.name).toBe('integration-sync');
    expect(fakes.queues[0]?.addCalls).toHaveLength(3);
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'integration-sync',
      data: targeted,
      opts: {
        jobId:
          'integration-targeted|11111111-1111-4111-8111-111111111111|github.repo|acme%2Fapp|all',
      },
    });
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      name: 'integration-sync',
    });
    expect(fakes.queues[0]?.addCalls[1]?.data).toMatchObject({ kind: 'incremental' });
    expect(fakes.queues[0]?.addCalls[1]?.opts).toBeUndefined();
    expect(fakes.queues[0]?.addCalls[2]).toMatchObject({
      name: 'integration-sync',
    });
    expect(fakes.queues[0]?.addCalls[2]?.data).toMatchObject({ kind: 'incremental' });
    expect(fakes.queues[0]?.addCalls[2]?.opts).toBeUndefined();
  });

  it('coalesces provider-policy reconciliation while a matching job is pending', async () => {
    const queues = await importQueues();
    const reconcile = {
      kind: 'incremental' as const,
      integrationId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: 'reconcile',
    };

    await queues.enqueueIntegrationSyncJob(reconcile);
    await queues.enqueueIntegrationSyncJob(reconcile);

    expect(fakes.queues[0]?.addCalls).toHaveLength(1);
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'integration-sync',
      data: reconcile,
      opts: {
        jobId: 'integration-reconcile|11111111-1111-4111-8111-111111111111',
      },
    });
  });

  it('allows later provider-policy reconciliation after a retained completed job is removed', async () => {
    const queues = await importQueues();
    const reconcile = {
      kind: 'incremental' as const,
      integrationId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: 'reconcile',
    };

    await queues.enqueueIntegrationSyncJob(reconcile);
    const jobId = (
      fakes.queues[0]?.addCalls[0]?.opts as {
        jobId: string;
      }
    ).jobId;
    fakes.queues[0]?.jobStates.set(jobId, 'completed');
    await queues.enqueueIntegrationSyncJob(reconcile);

    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      opts: { jobId },
    });
  });

  it('allows a later targeted integration sync after a retained completed job is removed', async () => {
    const queues = await importQueues();
    const targeted = {
      kind: 'targeted' as const,
      integrationId: '11111111-1111-4111-8111-111111111111',
      teamId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: 'webhook',
      resourceType: 'monday.board',
      externalId: '123456789',
      surface: 'items',
    };

    await queues.enqueueIntegrationSyncJob(targeted);
    const jobId = (
      fakes.queues[0]?.addCalls[0]?.opts as {
        jobId: string;
      }
    ).jobId;
    fakes.queues[0]?.jobStates.set(jobId, 'completed');
    await queues.enqueueIntegrationSyncJob({ ...targeted, triggeredBy: 'reconcile' });

    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      opts: { jobId },
    });
    expect(fakes.queues[0]?.addCalls[1]?.data).toMatchObject({ triggeredBy: 'reconcile' });
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
        jobId: 'object-cleanup|22222222-2222-4222-8222-222222222222|team|manual|manual',
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

  it('queues reconciliation audit and backfill jobs with stable encoded ids', async () => {
    const queues = await importQueues();

    await queues.enqueueReconciliationJob({
      kind: 'evidence_audit',
      teamId: '22222222-2222-4222-8222-222222222222',
      source: 'email',
      limit: 500,
      triggeredBy: 'manual',
    });
    await queues.enqueueReconciliationJob({
      kind: 'evidence_backfill',
      teamId: '22222222-2222-4222-8222-222222222222',
      source: 'email',
      limit: 500,
      pageSize: 100,
      dryRun: true,
      missingOnly: true,
      triggeredBy: 'manual',
    });
    await queues.enqueueReconciliationJob({
      kind: 'scope_reconcile',
      teamId: '22222222-2222-4222-8222-222222222222',
      scope: 'object',
      targetId: '33333333-3333-4333-8333-333333333333',
      triggeredBy: 'manual',
      reason: 'admin_dashboard',
    });

    expect(fakes.queues[0]?.name).toBe('reconciliation');
    expect(fakes.queues[0]?.options).toMatchObject({
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    });
    expect(fakes.queues[0]?.addCalls).toEqual([
      expect.objectContaining({
        name: 'reconciliation',
        opts: {
          jobId:
            'evidence_audit|22222222-2222-4222-8222-222222222222|email|500|default-page|audit|audit|manual',
        },
      }),
      expect.objectContaining({
        name: 'reconciliation',
        opts: {
          jobId:
            'evidence_backfill|22222222-2222-4222-8222-222222222222|email|500|100|true|true|manual',
        },
      }),
      expect.objectContaining({
        name: 'reconciliation',
        opts: {
          jobId:
            'scope_reconcile|22222222-2222-4222-8222-222222222222|object|33333333-3333-4333-8333-333333333333|manual|admin_dashboard|default-planner-replay|missing|all-sources|unbounded-start|unbounded-end',
        },
      }),
    ]);
  });

  it('coalesces reconciliation jobs while a matching job is pending', async () => {
    const queues = await importQueues();
    const audit = {
      kind: 'evidence_audit' as const,
      teamId: '22222222-2222-4222-8222-222222222222',
      source: 'email' as const,
      limit: 500,
      triggeredBy: 'manual',
    };

    await queues.enqueueReconciliationJob(audit);
    await queues.enqueueReconciliationJob(audit);

    expect(fakes.queues[0]?.addCalls).toHaveLength(1);
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'reconciliation',
      data: audit,
    });
  });

  it('allows later reconciliation after a retained completed job is removed', async () => {
    const queues = await importQueues();
    const audit = {
      kind: 'evidence_audit' as const,
      teamId: '22222222-2222-4222-8222-222222222222',
      source: 'email' as const,
      limit: 500,
      triggeredBy: 'manual',
    };

    await queues.enqueueReconciliationJob(audit);
    const jobId = (
      fakes.queues[0]?.addCalls[0]?.opts as {
        jobId: string;
      }
    ).jobId;
    fakes.queues[0]?.jobStates.set(jobId, 'completed');
    await queues.enqueueReconciliationJob(audit);

    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      name: 'reconciliation',
      data: audit,
      opts: { jobId },
    });
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

  it('dedupes task category jobs by packet hash and replaces retained terminal jobs', async () => {
    process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'true';
    process.env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED = 'true';
    const queues = await importQueues();
    const data = {
      teamId: '22222222-2222-4222-8222-222222222222',
      taskId: '77777777-7777-4777-8777-777777777777',
      inputHash: 'packet-hash-v1',
      trigger: 'create' as const,
    };

    const first = await queues.enqueueTaskCategoryJob(data);
    const duplicate = await queues.enqueueTaskCategoryJob(data);
    expect(first).toMatchObject({ enqueued: true });
    expect(duplicate).toMatchObject({ enqueued: false, jobId: first.jobId });
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'task-category',
      data,
      opts: {
        jobId:
          'task-category|22222222-2222-4222-8222-222222222222|77777777-7777-4777-8777-777777777777|packet-hash-v1',
      },
    });

    fakes.queues[0]?.jobStates.set(first.jobId, 'failed');
    const retry = await queues.enqueueTaskCategoryJob({ ...data, trigger: 'retry' });
    expect(retry).toMatchObject({ enqueued: true, jobId: first.jobId });
    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
  });

  it('fails a task category retry when terminal job removal fails', async () => {
    process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'true';
    process.env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED = 'true';
    const queues = await importQueues();
    const data = {
      teamId: '22222222-2222-4222-8222-222222222222',
      taskId: '77777777-7777-4777-8777-777777777777',
      inputHash: 'packet-hash-v1',
      trigger: 'retry' as const,
    };

    const first = await queues.enqueueTaskCategoryJob(data);
    const fakeQueue = fakes.queues[0];
    fakeQueue?.jobStates.set(first.jobId, 'failed');
    fakeQueue?.removeFailures.add(first.jobId);

    await expect(queues.enqueueTaskCategoryJob(data)).rejects.toThrow('remove failed');
    expect(fakeQueue?.addCalls).toHaveLength(1);
  });

  it('fails a task category retry when retained job state is unreadable or unknown', async () => {
    process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'true';
    process.env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED = 'true';
    const queues = await importQueues();
    const data = {
      teamId: '22222222-2222-4222-8222-222222222222',
      taskId: '77777777-7777-4777-8777-777777777777',
      inputHash: 'packet-hash-v1',
      trigger: 'retry' as const,
    };

    const first = await queues.enqueueTaskCategoryJob(data);
    const fakeQueue = fakes.queues[0];
    fakeQueue?.stateReadFailures.add(first.jobId);
    await expect(queues.enqueueTaskCategoryJob(data)).rejects.toThrow('state read failed');

    fakeQueue?.stateReadFailures.delete(first.jobId);
    fakeQueue?.jobStates.set(first.jobId, 'unknown');
    await expect(queues.enqueueTaskCategoryJob(data)).rejects.toThrow('unknown');
    expect(fakeQueue?.addCalls).toHaveLength(1);
  });

  it('lets manual object summary jobs replace delayed automatic refreshes', async () => {
    const queues = await importQueues();
    const autoData = {
      teamId: '22222222-2222-4222-8222-222222222222',
      objectId: '77777777-7777-4777-8777-777777777777',
      trigger: 'auto' as const,
    };
    const manualData = { ...autoData, trigger: 'manual' as const };

    const delayed = await queues.enqueueObjectSummaryJob(autoData, { delayMs: 120_000 });
    const manual = await queues.enqueueObjectSummaryJob(manualData);

    expect(delayed).toMatchObject({ enqueued: true });
    expect(manual).toMatchObject({ enqueued: true, jobId: delayed.jobId });
    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      name: 'object-summary',
      data: manualData,
      opts: { jobId: delayed.jobId },
    });
    expect(fakes.queues[0]?.addCalls[1]?.opts).not.toMatchObject({ delay: 120_000 });
  });

  it('queues one follow-up object summary refresh when an object summary job is active', async () => {
    const queues = await importQueues();
    const data = {
      teamId: '22222222-2222-4222-8222-222222222222',
      objectId: '77777777-7777-4777-8777-777777777777',
      trigger: 'auto' as const,
    };

    const first = await queues.enqueueObjectSummaryJob(data);
    if (!first.jobId) throw new Error('expected stable object summary job id');
    fakes.queues[0]?.jobStates.set(first.jobId, 'active');
    const followup = await queues.enqueueObjectSummaryJob(data, { delayMs: 120_000 });
    const duplicateFollowup = await queues.enqueueObjectSummaryJob(data, { delayMs: 120_000 });

    expect(first).toMatchObject({ enqueued: true });
    expect(followup).toMatchObject({
      enqueued: true,
      jobId:
        'object-summary|22222222-2222-4222-8222-222222222222|77777777-7777-4777-8777-777777777777|followup',
    });
    expect(duplicateFollowup).toMatchObject({ enqueued: false, jobId: followup.jobId });
    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      name: 'object-summary',
      data,
      opts: { delay: 120_000, jobId: followup.jobId },
    });
  });

  it('queues a manual follow-up object summary refresh when a generation is active', async () => {
    const queues = await importQueues();
    const activeData = {
      teamId: '22222222-2222-4222-8222-222222222222',
      objectId: '77777777-7777-4777-8777-777777777777',
      trigger: 'auto' as const,
    };
    const manualData = { ...activeData, trigger: 'manual' as const };

    const active = await queues.enqueueObjectSummaryJob(activeData);
    if (!active.jobId) throw new Error('expected stable object summary job id');
    fakes.queues[0]?.jobStates.set(active.jobId, 'active');
    const followup = await queues.enqueueObjectSummaryJob(manualData);

    expect(followup).toMatchObject({
      enqueued: true,
      jobId:
        'object-summary|22222222-2222-4222-8222-222222222222|77777777-7777-4777-8777-777777777777|followup',
    });
    expect(fakes.queues[0]?.addCalls).toHaveLength(2);
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      name: 'object-summary',
      data: manualData,
      opts: { jobId: followup.jobId },
    });
  });

  it('dedupes timeline moment presentation jobs by cache provenance', async () => {
    const queues = await importQueues();
    const data = {
      teamId: '22222222-2222-4222-8222-222222222222',
      userId: '55555555-5555-4555-8555-555555555555',
      rawEventIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      cacheKey: {
        teamId: '22222222-2222-4222-8222-222222222222',
        momentKey: 'moment:telegram:chat-a:2026-06-27:18:00',
        visibilityScopeHash: 'visibility-hash',
        visibleSourceEventIdsHash: 'ids-hash',
        visibleSourceContentHash: 'content-hash',
        impactHydrationHash: 'impact-hash',
        artifactClusterHash: 'artifact-hash',
        promptVersion: 'timeline_moment_presentation.v1',
        model: 'test/model',
      },
    };

    const first = await queues.enqueueTimelineMomentPresentationJob(data, { delayMs: 30_000 });
    const duplicate = await queues.enqueueTimelineMomentPresentationJob(data, { delayMs: 30_000 });

    expect(fakes.queues[0]?.name).toBe('timeline-moment-presentation');
    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'timeline-moment-presentation',
      data,
      opts: {
        delay: 30_000,
        jobId:
          'timeline-moment-presentation|22222222-2222-4222-8222-222222222222|moment%3Atelegram%3Achat-a%3A2026-06-27%3A18%3A00|ids-hash|content-hash|visibility-hash|timeline_moment_presentation.v1|test%2Fmodel',
      },
    });
    expect(first).toMatchObject({ enqueued: true });
    expect(duplicate).toMatchObject({ enqueued: false, jobId: first.jobId });

    await queues.closeTimelineMomentPresentationQueue();
    expect(fakes.queues[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('registers repeatable jobs with stable job ids and closes singleton queues', async () => {
    const queues = await importQueues();

    await queues.scheduleOverdueScan();
    await queues.scheduleCalendarRecurrenceMaterialization();
    await queues.scheduleJanitorSweep();
    await queues.scheduleMcpHealthPing();
    await queues.scheduleDailyDigest();

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
    expect(fakes.queues[4]?.removeRepeatable).toHaveBeenCalledWith(
      'tick',
      { pattern: '0 12 * * *' },
      'daily-digest-1200-utc',
    );
    expect(fakes.queues[4]?.schedulerCalls[0]).toMatchObject({
      id: 'daily-digest-1200-utc',
      repeatOpts: { pattern: '0 12 * * *' },
      template: { name: 'tick', data: { kind: 'tick', reason: 'scheduled' } },
    });
    expect(fakes.queues[4]?.addCalls[0]).toMatchObject({
      name: 'tick',
      data: { kind: 'tick', reason: 'catchup' },
    });
    expect(fakes.queues[4]?.addCalls[0]?.data).not.toHaveProperty('windowStart');
    expect(fakes.queues[4]?.addCalls[0]?.data).not.toHaveProperty('windowEnd');
    const catchupJobId = fakes.queues[4]?.addCalls[0]?.opts as { jobId?: string };
    expect(catchupJobId.jobId).toMatch(/^daily-digest-catchup\|/);
    expect(catchupJobId.jobId).not.toContain(':');

    await queues.closeOverdueScanQueue();
    await queues.closeCalendarRecurrenceQueue();
    await queues.closeJanitorQueue();
    await queues.closeMcpHealthQueue();
    await queues.closeDailyDigestQueue();
    expect(fakes.queues.every((queue) => queue.close.mock.calls.length === 1)).toBe(true);

    await queues.scheduleOverdueScan();
    expect(fakes.queues.filter((queue) => queue.name === 'overdue-scan')).toHaveLength(2);
  });

  it('uses BullMQ-safe ids for daily digest recipient and send jobs', async () => {
    const queues = await importQueues();

    await queues.enqueueDailyDigestRecipientJob({
      kind: 'recipient',
      teamId: '22222222-2222-4222-8222-222222222222',
      userId: '55555555-5555-4555-8555-555555555555',
      email: 'tim@example.test',
      windowStart: '2026-06-15T12:00:00.000Z',
      windowEnd: '2026-06-16T12:00:00.000Z',
    });
    await queues.enqueueDailyDigestSendJob({
      kind: 'send',
      digestId: '33333333-3333-4333-8333-333333333333',
      email: 'tim@example.test',
    });

    expect(fakes.queues[0]?.addCalls[0]).toMatchObject({
      name: 'recipient',
      opts: {
        jobId:
          'daily-digest|22222222-2222-4222-8222-222222222222|55555555-5555-4555-8555-555555555555|2026-06-15T12%3A00%3A00.000Z|2026-06-16T12%3A00%3A00.000Z',
      },
    });
    expect(fakes.queues[0]?.addCalls[1]).toMatchObject({
      name: 'send',
      opts: { jobId: 'daily-digest-send|33333333-3333-4333-8333-333333333333' },
    });
    for (const call of fakes.queues[0]?.addCalls ?? []) {
      const opts = call.opts as { jobId?: string } | undefined;
      expect(opts?.jobId).not.toContain(':');
    }
  });

  it('requires Redis configuration before constructing queues', async () => {
    process.env.AUTH_SECRET = 'test-secret-at-least-sixteen-characters';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    delete process.env.REDIS_URL;
    const queues = await import('./index.js');

    expect(() => queues.getExtractQueue()).toThrow('REDIS_URL is required');
  });
});
