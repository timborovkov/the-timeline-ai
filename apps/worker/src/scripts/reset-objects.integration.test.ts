import { queue } from '@timeline/shared';
import { closeAllRedisConnections } from '@timeline/shared/redis';
import { Queue } from 'bullmq';
import { describe, expect, it } from 'bun:test';

import { removeQueuedDevelopmentJobs } from '#src/scripts/reset-objects.js';

// A real Redis queue proves paused/prioritized old work cannot survive a local reset.
const integration = process.env.ENGINE_INFRA_EVAL === '1' ? describe : describe.skip;
integration('development reset queue isolation', () => {
  it('removes paused and prioritized target jobs while preserving another team', async () => {
    const q = new Queue<{ teamId?: string }>(`engine-reset-eval-${crypto.randomUUID()}`, {
      connection: queue.getRedisConnection(),
    });
    try {
      const target = await q.add('target', { teamId: 'target' });
      const priority = await q.add('priority', { teamId: 'target' }, { priority: 1 });
      await q.add('other', { teamId: 'other' }, { jobId: 'other' });
      await q.pause();
      await removeQueuedDevelopmentJobs(q, 'target');
      expect(await q.getJob('other')).toBeDefined();
      expect(await q.getJob(required(target.id))).toBeUndefined();
      expect(await q.getJob(required(priority.id))).toBeUndefined();
      expect(await q.isPaused()).toBe(true);
      expect(await q.getPrioritizedCount()).toBe(0);
    } finally {
      await q.obliterate({ force: true });
      await q.close();
      await closeAllRedisConnections();
    }
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture value');
  return value;
}
