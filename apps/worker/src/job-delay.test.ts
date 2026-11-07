import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { DelayedError } from 'bullmq';

import { delayWorkerJob } from '#src/job-delay.js';
import { finishIngestJob } from '#src/ingest-job-result.js';

// Deferral must preserve the BullMQ lock and must not masquerade as completion or failure.
describe('worker job deferral', () => {
  it('leaves completed ingest outcomes unchanged', async () => {
    const result = { extracted: 2 };
    const job = { moveToDelayed: () => Promise.reject(new Error('must not defer')) };
    expect(await finishIngestJob(job, result, 'lock')).toBe(result);
  });

  it('moves a throttled job to its retry boundary before signaling deferral', async () => {
    const moves: { at: number; token: string | undefined }[] = [];
    const before = Date.now();
    const job = {
      moveToDelayed(at: number, token?: string) {
        moves.push({ at, token });
        return Promise.resolve();
      },
    };
    await expect(
      finishIngestJob(job, { delayed: true, retryAfterMs: 2000 }, 'lock'),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.token).toBe('lock');
    expect(moves[0]?.at).toBeGreaterThanOrEqual(before + 2000);
    expect(moves[0]?.at).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it('propagates a rejected queue transition instead of claiming the job was deferred', async () => {
    const failure = new Error('lost lock');
    const job = { moveToDelayed: () => Promise.reject(failure) };
    await expect(finishIngestJob(job, { delayed: true, retryAfterMs: 1000 }, 'lock')).rejects.toBe(
      failure,
    );
  });

  it('allows the billing caller to own its admission-error handling after a successful move', async () => {
    let moved = false;
    await delayWorkerJob(
      {
        moveToDelayed() {
          moved = true;
          return Promise.resolve();
        },
      },
      15000,
    );
    expect(moved).toBe(true);
  });
});
