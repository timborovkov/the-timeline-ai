import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { startWorkerGroup } from '#src/worker-lifecycle.js';

// Shutdown must drain jobs before closing the producers they use for downstream work.
describe('worker lifecycle', () => {
  it('starts every consumer before scheduling work and drains before closing producers', async () => {
    const events: string[] = [];
    let finishJob!: () => void;
    const runningJob = new Promise<void>((resolve) => {
      finishJob = resolve;
    });
    const workers = await startWorkerGroup([
      {
        name: 'first',
        start() {
          events.push('start first');
          return {
            async close() {
              await runningJob;
              events.push('drained first');
            },
          };
        },
        schedule() {
          events.push('schedule first');
          return Promise.resolve();
        },
        closeQueue() {
          events.push('close first producer');
          return Promise.resolve();
        },
      },
      {
        name: 'second',
        start() {
          events.push('start second');
          return {
            close() {
              events.push('drained second');
              return Promise.resolve();
            },
          };
        },
        closeQueue() {
          events.push('close second producer');
          return Promise.resolve();
        },
      },
    ]);
    expect(events).toEqual(['start first', 'start second', 'schedule first']);
    const closing = workers.close();
    await Promise.resolve();
    expect(events).not.toContain('close first producer');
    expect(events).not.toContain('close second producer');
    finishJob();
    await closing;
    expect(events.slice(-3)).toEqual([
      'drained first',
      'close first producer',
      'close second producer',
    ]);
    expect(workers.activeNames).toEqual(['first', 'second']);
  });

  it('still closes the producer when a rollout gate disables its consumer', async () => {
    let producerClosed = false;
    const workers = await startWorkerGroup([
      {
        name: 'disabled',
        start: () => null,
        closeQueue() {
          producerClosed = true;
          return Promise.resolve();
        },
      },
    ]);
    expect(workers.activeNames).toEqual([]);
    await workers.close();
    expect(producerClosed).toBe(true);
  });

  it('reports drain failures without closing producers that active jobs may still need', async () => {
    let producerClosed = false;
    const workers = await startWorkerGroup([
      {
        name: 'failing',
        start: () => ({
          close() {
            return Promise.reject(new Error('drain failed'));
          },
        }),
        closeQueue() {
          producerClosed = true;
          return Promise.resolve();
        },
      },
    ]);
    await expect(workers.close()).rejects.toThrow('drain failed');
    expect(producerClosed).toBe(false);
  });
});
