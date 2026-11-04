import { ResendError } from '@timeline/shared/email';
import { expect, vi } from '@timeline/test-support';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { describe, it } from 'bun:test';

import type { Db } from '@timeline/db';
import type { EmailInboundJobData } from '@timeline/shared/queue';

import { processInboundJob } from '#src/workers/emailInbound.js';

function job(attemptsStarted = 1) {
  const moveToDelayed = vi.fn().mockResolvedValue(undefined);
  return {
    value: {
      data: { emailId: 'email-id' },
      attemptsStarted,
      moveToDelayed,
    } as unknown as Job<EmailInboundJobData>,
    moveToDelayed,
  };
}
describe('inbound worker retry policy', () => {
  it('preserves transient ingestion failures for exponential queue retries', async () => {
    const failure = new Error('partial_team_failure');
    const process = vi.fn().mockRejectedValue(failure);
    await expect(processInboundJob({} as Db, job().value, 'lock', process)).rejects.toBe(failure);
  });
  it('delays throttled work until Retry-After without exposing content in jobs', async () => {
    const current = job();
    const before = Date.now();
    await expect(
      processInboundJob(
        {} as Db,
        current.value,
        'lock',
        vi.fn().mockRejectedValue(new ResendError('rate_limit', true, 60_000)),
      ),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(current.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'lock');
    expect(current.moveToDelayed.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(before + 60_000);
    expect(current.value.data).toEqual({ emailId: 'email-id' });
  });
  it('terminates invalid configuration and bounds repeated throttling attempts', async () => {
    for (const [attempts, error] of [
      [1, new ResendError('not_configured', false)],
      [8, new ResendError('rate_limit', true, 60_000)],
      [8, new Error('partial_team_failure_after_throttling')],
    ] as const) {
      const current = job(attempts);
      await expect(
        processInboundJob({} as Db, current.value, 'lock', vi.fn().mockRejectedValue(error)),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      expect(current.moveToDelayed).not.toHaveBeenCalled();
    }
  });
});
