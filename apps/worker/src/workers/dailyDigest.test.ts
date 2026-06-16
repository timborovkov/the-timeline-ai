import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  defaultDigestWindow: vi.fn(),
  listDailyDigestRecipients: vi.fn(),
  generateDailyDigest: vi.fn(),
  sendDailyDigest: vi.fn(),
  enqueueDailyDigestRecipientJob: vi.fn(),
  enqueueDailyDigestSendJob: vi.fn(),
}));

vi.mock('@timeline/shared', () => ({
  childLogger: () => ({ info: vi.fn(), error: vi.fn() }),
  messaging: {
    defaultDigestWindow: fakes.defaultDigestWindow,
    listDailyDigestRecipients: fakes.listDailyDigestRecipients,
    generateDailyDigest: fakes.generateDailyDigest,
    sendDailyDigest: fakes.sendDailyDigest,
  },
  queue: {
    QUEUE_NAMES: { dailyDigest: 'daily-digest' },
    getRedisConnection: vi.fn(),
    enqueueDailyDigestRecipientJob: fakes.enqueueDailyDigestRecipientJob,
    enqueueDailyDigestSendJob: fakes.enqueueDailyDigestSendJob,
  },
}));

vi.mock('bullmq', () => ({ Worker: vi.fn() }));
vi.mock('#src/monitoring.js', () => ({ captureWorkerJobFailure: vi.fn() }));

const { processDailyDigestJob } = await import('#src/workers/dailyDigest.js');

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
  });

  it('fans out one recipient job per active member', async () => {
    fakes.listDailyDigestRecipients.mockResolvedValue([
      { teamId: 'team-1', userId: 'user-1', email: 'a@example.test' },
      { teamId: 'team-1', userId: 'user-2', email: 'b@example.test' },
    ]);

    await expect(processDailyDigestJob({ db: {} as never }, { kind: 'tick' })).resolves.toEqual({
      recipients: 2,
    });
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

  it('uses the explicit catch-up window when one is queued', async () => {
    fakes.listDailyDigestRecipients.mockResolvedValue([
      { teamId: 'team-1', userId: 'user-1', email: 'a@example.test' },
    ]);

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        {
          kind: 'tick',
          reason: 'catchup',
          windowStart: '2026-06-15T12:00:00.000Z',
          windowEnd: '2026-06-16T12:00:00.000Z',
        },
      ),
    ).resolves.toEqual({ recipients: 1 });

    expect(fakes.defaultDigestWindow).not.toHaveBeenCalled();
    expect(fakes.enqueueDailyDigestRecipientJob).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStart: '2026-06-15T12:00:00.000Z',
        windowEnd: '2026-06-16T12:00:00.000Z',
      }),
    );
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

  it('does not enqueue email when preferences skip the digest', async () => {
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
      digestUrl: 'https://timeline-preview.vercel.app/app',
    });
  });

  it('throws on digest send failure so BullMQ retries the job', async () => {
    fakes.sendDailyDigest.mockResolvedValue({ ok: false, error: 'Postmark timeout' });

    await expect(
      processDailyDigestJob(
        { db: {} as never },
        { kind: 'send', digestId: 'digest-1', email: 'a@example.test' },
      ),
    ).rejects.toThrow('Postmark timeout');
  });
});
