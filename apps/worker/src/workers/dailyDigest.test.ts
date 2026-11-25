import { PlatformAccessError } from '@timeline/shared/platform-admin';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  defaultDigestWindow: vi.fn(),
  generateScheduledUpdate: vi.fn(),
  listUpdateDispatchCandidates: vi.fn(),
  latestUpdateTime: vi.fn(),
  enqueueScheduledUpdateJob: vi.fn(),
  enqueueScheduledUpdateSendJob: vi.fn(),
  getDigestPreference: vi.fn(),
  getWorkspaceDigestSchedule: vi.fn(),
  listDailyDigestRecipients: vi.fn(),
  listWorkspaceDigestTeamIds: vi.fn(),
  generateDailyDigest: vi.fn(),
  sendDailyDigest: vi.fn(),
  sendWorkspaceDailyDigest: vi.fn(),
  enqueueDailyDigestRecipientJob: vi.fn(),
  enqueueDailyDigestSendJob: vi.fn(),
  enqueueDailyDigestWorkspaceSendJob: vi.fn(),
  log: { info: vi.fn(), error: vi.fn() },
  Worker: vi.fn((..._args: unknown[]) => ({ on: vi.fn() })),
  guardWorkerProcessor: vi.fn((_db: unknown, processor: unknown) => processor),
  captureWorkerJobFailure: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared'),
  () => ({
    childLogger: () => fakes.log,
    messaging: {
      defaultDigestWindow: fakes.defaultDigestWindow,
      HOME_UPDATE_KEY: 'home',
      UPDATE_DISPATCH_GRACE_MS: 7_200_000,
      generateScheduledUpdate: fakes.generateScheduledUpdate,
      listUpdateDispatchCandidates: fakes.listUpdateDispatchCandidates,
      latestUpdateTime: fakes.latestUpdateTime,
      getDigestPreference: fakes.getDigestPreference,
      listDailyDigestRecipients: fakes.listDailyDigestRecipients,
      generateDailyDigest: fakes.generateDailyDigest,
      sendDailyDigest: fakes.sendDailyDigest,
      sendWorkspaceDailyDigest: fakes.sendWorkspaceDailyDigest,
      listWorkspaceDigestTeamIds: fakes.listWorkspaceDigestTeamIds,
      getWorkspaceDigestSchedule: fakes.getWorkspaceDigestSchedule,
    },
    queue: {
      QUEUE_NAMES: { dailyDigest: 'daily-digest' },
      getRedisConnection: vi.fn(),
      enqueueScheduledUpdateJob: fakes.enqueueScheduledUpdateJob,
      enqueueScheduledUpdateSendJob: fakes.enqueueScheduledUpdateSendJob,
      enqueueDailyDigestRecipientJob: fakes.enqueueDailyDigestRecipientJob,
      enqueueDailyDigestSendJob: fakes.enqueueDailyDigestSendJob,
      enqueueDailyDigestWorkspaceSendJob: fakes.enqueueDailyDigestWorkspaceSendJob,
    },
  }),
  () => import('@timeline/shared'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({ withTeam: () => ({}) }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('bullmq'),
  async () => ({
    ...(await import('bullmq')),
    Worker: fakes.Worker,
  }),
  () => import('bullmq'),
);
await vi.mock(
  import.meta.resolve('#src/monitoring.js'),
  () => ({ captureWorkerJobFailure: fakes.captureWorkerJobFailure }),
  () => import('#src/monitoring.js'),
);
await vi.mock(
  import.meta.resolve('#src/platform-worker.js'),
  () => ({ guardWorkerProcessor: fakes.guardWorkerProcessor }),
  () => import('#src/platform-worker.js'),
);

const { processDailyDigestJob, skipSuspendedDigestAccess, startDailyDigestWorker } =
  await import('#src/workers/dailyDigest.js');

describe('daily digest worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTH_URL;
    delete process.env.VERCEL_URL;
    delete process.env.NEXTAUTH_URL;
    fakes.defaultDigestWindow.mockReturnValue({
      start: new Date('2026-06-13T12:00:00Z'),
      end: new Date('2026-06-14T12:00:00Z'),
    });
    fakes.getDigestPreference.mockResolvedValue({
      enabled: true,
      hour: 12,
      timezone: 'Europe/Helsinki',
    });
    fakes.listWorkspaceDigestTeamIds.mockResolvedValue([]);
    fakes.getWorkspaceDigestSchedule.mockResolvedValue({
      hour: 12,
      timezone: 'Europe/Helsinki',
    });
    fakes.guardWorkerProcessor.mockImplementation((_db: unknown, processor: unknown) => processor);
    fakes.Worker.mockImplementation((..._args: unknown[]) => ({ on: vi.fn() }));
  });

  it('fans out one recipient job per active member using their digest timezone', async () => {
    fakes.listDailyDigestRecipients.mockResolvedValue([
      { teamId: 'team-1', userId: 'user-1', email: 'a@example.test' },
      { teamId: 'team-1', userId: 'user-2', email: 'b@example.test' },
    ]);

    await expect(processDailyDigestJob({ db: {} as never }, { kind: 'tick' })).resolves.toEqual({
      recipients: 2,
    });
    expect(fakes.getDigestPreference).toHaveBeenCalledWith({
      db: {},
      teamId: 'team-1',
      userId: 'user-1',
    });
    expect(fakes.defaultDigestWindow).toHaveBeenCalledWith(expect.any(Date), 'Europe/Helsinki', 12);
    expect(fakes.enqueueDailyDigestRecipientJob).toHaveBeenCalledTimes(2);
    expect(fakes.enqueueDailyDigestRecipientJob).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        userId: 'user-1',
        email: 'a@example.test',
        windowStart: '2026-06-13T12:00:00.000Z',
        windowEnd: '2026-06-14T12:00:00.000Z',
      }),
    );
  });

  it('keeps legacy catch-up on shared destinations so personal updates are not duplicated', async () => {
    fakes.listWorkspaceDigestTeamIds.mockResolvedValue(['team-1']);
    await expect(
      processDailyDigestJob({ db: {} as never }, { kind: 'tick', reason: 'catchup' }),
    ).resolves.toEqual({ recipients: 0 });
    expect(fakes.enqueueDailyDigestRecipientJob).not.toHaveBeenCalled();
    expect(fakes.enqueueDailyDigestWorkspaceSendJob).toHaveBeenCalledOnce();
  });

  it('uses an explicit window for non-catch-up tick jobs', async () => {
    fakes.listDailyDigestRecipients.mockResolvedValue([
      { teamId: 'team-1', userId: 'user-1', email: 'a@example.test' },
    ]);

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        {
          kind: 'tick',
          windowStart: '2026-06-15T12:00:00.000Z',
          windowEnd: '2026-06-16T12:00:00.000Z',
        },
      ),
    ).resolves.toEqual({ recipients: 1 });

    expect(fakes.defaultDigestWindow).not.toHaveBeenCalled();
    expect(fakes.getDigestPreference).not.toHaveBeenCalled();
    expect(fakes.enqueueDailyDigestRecipientJob).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStart: '2026-06-15T12:00:00.000Z',
        windowEnd: '2026-06-16T12:00:00.000Z',
      }),
    );
  });

  it('queues currently due profiles and leaves future or newly edited slots alone', async () => {
    const due = new Date(Date.now() - 60_000);
    fakes.latestUpdateTime.mockReturnValue(due);
    const candidate = {
      teamId: 'team-1',
      userId: 'user-1',
      revision: 'initial',
      key: 'default',
      settings: {},
      timezone: 'UTC',
      joinedAt: new Date('2020-01-01'),
      changedAt: null,
    };
    fakes.listUpdateDispatchCandidates.mockResolvedValue([
      candidate,
      { ...candidate, key: 'home' },
      { ...candidate, key: 'edited', changedAt: new Date() },
      { ...candidate, key: 'new-membership', joinedAt: new Date() },
    ]);
    await expect(
      processDailyDigestJob({ db: {} as never }, { kind: 'updates-tick' }),
    ).resolves.toEqual({ recipients: 2 });
    expect(fakes.enqueueScheduledUpdateJob).toHaveBeenCalledWith({
      kind: 'update',
      teamId: 'team-1',
      userId: 'user-1',
      revision: 'initial',
      scheduleKey: 'default',
      windowEnd: due.toISOString(),
    });
    expect(fakes.enqueueScheduledUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleKey: 'home' }),
    );
  });

  it('hands a generated personal update to delivery and keeps the Home brief in app', async () => {
    fakes.generateScheduledUpdate.mockResolvedValue('digest-1');
    const data = {
      kind: 'update' as const,
      teamId: 'team-1',
      userId: 'user-1',
      scheduleKey: 'default',
      revision: 'initial',
      windowEnd: '2026-06-14T12:00:00.000Z',
    };
    await expect(processDailyDigestJob({ db: {} as never }, data)).resolves.toEqual({
      digestId: 'digest-1',
      skipped: false,
    });
    expect(fakes.enqueueScheduledUpdateSendJob).toHaveBeenCalledWith({
      kind: 'update-send',
      digestId: 'digest-1',
      teamId: 'team-1',
      userId: 'user-1',
    });
    await processDailyDigestJob({ db: {} as never }, { ...data, scheduleKey: 'home' });
    expect(fakes.enqueueScheduledUpdateSendJob).toHaveBeenCalledOnce();
  });

  it('enqueues a send job after generating a digest', async () => {
    fakes.generateDailyDigest.mockResolvedValue({ digestId: 'digest-1', skipped: false });

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        {
          kind: 'recipient',
          teamId: 'team-1',
          userId: 'user-1',
          email: 'a@example.test',
          windowStart: '2026-06-13T12:00:00.000Z',
          windowEnd: '2026-06-14T12:00:00.000Z',
        },
      ),
    ).resolves.toEqual({ digestId: 'digest-1', skipped: false });
    expect(fakes.enqueueDailyDigestSendJob).toHaveBeenCalledWith({
      kind: 'send',
      digestId: 'digest-1',
      email: 'a@example.test',
    });
  });

  it('does not enqueue email when digest generation skips the window', async () => {
    fakes.generateDailyDigest.mockResolvedValue({ digestId: 'digest-1', skipped: true });

    await processDailyDigestJob(
      { db: {} as never },
      {
        kind: 'recipient',
        teamId: 'team-1',
        userId: 'user-1',
        email: 'a@example.test',
        windowStart: '2026-06-13T12:00:00.000Z',
        windowEnd: '2026-06-14T12:00:00.000Z',
      },
    );
    expect(fakes.enqueueDailyDigestSendJob).not.toHaveBeenCalled();
  });

  it('enqueues one workspace send job per team with a shared digest destination', async () => {
    fakes.listDailyDigestRecipients.mockResolvedValue([
      { teamId: 'team-1', userId: 'user-1', email: 'a@example.test' },
    ]);
    fakes.listWorkspaceDigestTeamIds.mockResolvedValue(['team-1']);

    await expect(processDailyDigestJob({ db: {} as never }, { kind: 'tick' })).resolves.toEqual({
      recipients: 1,
    });
    expect(fakes.getWorkspaceDigestSchedule).toHaveBeenCalledWith({}, 'team-1');
    expect(fakes.enqueueDailyDigestWorkspaceSendJob).toHaveBeenCalledWith({
      kind: 'workspace-send',
      teamId: 'team-1',
      windowStart: '2026-06-13T12:00:00.000Z',
      windowEnd: '2026-06-14T12:00:00.000Z',
    });
  });

  it('sends a workspace digest through the shared bot destinations', async () => {
    fakes.sendWorkspaceDailyDigest.mockResolvedValue({ ok: true });

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        {
          kind: 'workspace-send',
          teamId: 'team-1',
          windowStart: '2026-06-13T12:00:00.000Z',
          windowEnd: '2026-06-14T12:00:00.000Z',
        },
      ),
    ).resolves.toEqual({ sent: true });
    expect(fakes.sendWorkspaceDailyDigest).toHaveBeenCalledWith({
      db: {},
      teamId: 'team-1',
      windowStart: new Date('2026-06-13T12:00:00.000Z'),
      windowEnd: new Date('2026-06-14T12:00:00.000Z'),
      digestUrl: 'http://localhost:3000/app',
    });
  });

  it('uses VERCEL_URL for digest links when explicit auth URLs are absent', async () => {
    process.env.VERCEL_URL = 'timeline-preview.vercel.app';
    process.env.NEXTAUTH_URL = 'https://production.timeline.example';
    fakes.sendDailyDigest.mockResolvedValue({ ok: true });

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        { kind: 'send', digestId: 'digest-1', email: 'a@example.test' },
      ),
    ).resolves.toEqual({ digestId: 'digest-1', sent: true });

    expect(fakes.sendDailyDigest).toHaveBeenCalledWith({
      db: {},
      digestId: 'digest-1',
      to: 'a@example.test',
      digestUrl: 'https://timeline-preview.vercel.app/app/digests?digest=digest-1',
    });
  });

  it('throws on digest send failure so BullMQ retries the job', async () => {
    fakes.sendDailyDigest.mockResolvedValue({ ok: false, error: 'Resend timeout' });

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        { kind: 'send', digestId: 'digest-1', email: 'a@example.test' },
      ),
    ).rejects.toThrow('Resend timeout');
  });

  it('completes without throwing when Resend marks the recipient inactive', async () => {
    fakes.sendDailyDigest.mockResolvedValue({
      ok: false,
      error:
        'You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: a@example.test.',
      retryable: false,
    });

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        { kind: 'send', digestId: 'digest-1', email: 'a@example.test' },
      ),
    ).resolves.toEqual({ digestId: 'digest-1', sent: false, permanentFailure: true });
  });

  it('completes suspended workspace jobs as skipped without retrying', async () => {
    const recipientJob = {
      id: 'job-1',
      data: {
        kind: 'recipient' as const,
        teamId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        email: 'a@example.test',
        windowStart: '2026-06-13T12:00:00.000Z',
        windowEnd: '2026-06-14T12:00:00.000Z',
      },
    };

    await expect(
      skipSuspendedDigestAccess(recipientJob, () =>
        Promise.reject(new PlatformAccessError('Workspace is suspended')),
      ),
    ).resolves.toEqual({ skipped: true });
    expect(fakes.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        kind: 'recipient',
        teamId: '11111111-1111-4111-8111-111111111111',
        err: 'Workspace is suspended',
      }),
      'skipping digest job for suspended principal',
    );
  });

  it('rethrows non-suspension errors so BullMQ can retry', async () => {
    await expect(
      skipSuspendedDigestAccess(
        { id: 'job-2', data: { kind: 'send', digestId: 'digest-1', email: 'a@example.test' } },
        () => Promise.reject(new Error('Resend timeout')),
      ),
    ).rejects.toThrow('Resend timeout');
    expect(fakes.log.info).not.toHaveBeenCalled();
  });

  it('does not fail or report the worker when admission rejects a suspended workspace', async () => {
    fakes.guardWorkerProcessor.mockImplementation(
      () => () => Promise.reject(new PlatformAccessError('Workspace is suspended')),
    );
    startDailyDigestWorker({ db: {} as never });
    const processor = fakes.Worker.mock.calls[0]?.[1] as
      | ((job: { id: string; data: { kind: string; teamId?: string } }) => Promise<unknown>)
      | undefined;
    if (!processor) throw new Error('daily digest worker did not register a processor');

    await expect(
      processor({
        id: 'job-3',
        data: {
          kind: 'workspace-send',
          teamId: '11111111-1111-4111-8111-111111111111',
        },
      }),
    ).resolves.toEqual({ skipped: true });
    expect(fakes.captureWorkerJobFailure).not.toHaveBeenCalled();
    expect(fakes.log.error).not.toHaveBeenCalled();
  });
});
