import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  assertTaskCategoryBackfillCost,
  assertTaskCategoryBackfillModeEnabled,
  closeTaskCategoryBackfillResources,
  enqueueTaskCategoryBackfillBatch,
  loadTaskCategoryBackfillEnv,
  parseMaxQueueAgeSeconds,
  TASK_CATEGORY_BACKFILL_MAX_BATCH_COST_USD,
} from '#src/scripts/task-category-backfill.js';
describe('task category backfill script', () => {
  it('allows a dry run while operational flags are disabled', () => {
    const disabled = {
      TASK_CATEGORY_CLASSIFICATION_ENABLED: false,
      TASK_CATEGORY_BACKFILL_ENABLED: false,
      TASK_CATEGORY_WORKER_ENABLED: false,
    };

    expect(() => {
      assertTaskCategoryBackfillModeEnabled(false, disabled);
    }).not.toThrow();
    expect(() => {
      assertTaskCategoryBackfillModeEnabled(true, disabled);
    }).toThrow('Task category backfill execution is disabled by an operational kill switch');
  });

  it('bounds enqueue spend and allows a dry run without a cost cap', () => {
    expect(() => {
      assertTaskCategoryBackfillCost({
        execute: false,
        estimatedCostUsd: 10,
        maxCostUsd: null,
      });
    }).not.toThrow();
    expect(() => {
      assertTaskCategoryBackfillCost({
        execute: true,
        estimatedCostUsd: 0.1,
        maxCostUsd: null,
      });
    }).toThrow('Enqueue requires --max-cost-usd <amount>');
    expect(() => {
      assertTaskCategoryBackfillCost({
        execute: true,
        estimatedCostUsd: 0.2,
        maxCostUsd: 0.1,
      });
    }).toThrow('Projected cost $0.2 exceeds --max-cost-usd $0.1');
    expect(() => {
      assertTaskCategoryBackfillCost({
        execute: true,
        estimatedCostUsd: 0.1,
        maxCostUsd: TASK_CATEGORY_BACKFILL_MAX_BATCH_COST_USD + 1,
      });
    }).toThrow(
      `--max-cost-usd $${TASK_CATEGORY_BACKFILL_MAX_BATCH_COST_USD + 1} exceeds the $${TASK_CATEGORY_BACKFILL_MAX_BATCH_COST_USD} batch ceiling`,
    );
    expect(() => {
      assertTaskCategoryBackfillCost({
        execute: true,
        estimatedCostUsd: TASK_CATEGORY_BACKFILL_MAX_BATCH_COST_USD,
        maxCostUsd: TASK_CATEGORY_BACKFILL_MAX_BATCH_COST_USD,
      });
    }).not.toThrow();
  });

  it('loads an explicit environment file before reading flags or database configuration', () => {
    const load = vi.fn();

    loadTaskCategoryBackfillEnv({ TIMELINE_ENV_FILE: '/secure/timeline.env' }, load);

    expect(load).toHaveBeenCalledWith('/secure/timeline.env');
  });

  it('requires the queue-age safety limit to be finite and positive', () => {
    expect(parseMaxQueueAgeSeconds(null)).toBe(300);
    expect(parseMaxQueueAgeSeconds('45')).toBe(45);
    expect(() => parseMaxQueueAgeSeconds('30O')).toThrow('finite positive number');
    expect(() => parseMaxQueueAgeSeconds('Infinity')).toThrow('finite positive number');
    expect(() => parseMaxQueueAgeSeconds('0')).toThrow('finite positive number');
  });

  it('sets a failing exit code when any task cannot be enqueued', async () => {
    const setExitCode = vi.fn();
    const writeError = vi.fn();

    await expect(
      enqueueTaskCategoryBackfillBatch(['task-1', 'task-2'], {
        enqueue: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('queue unavailable')),
        writeError,
        setExitCode,
      }),
    ).resolves.toEqual({ enqueued: 1, failed: 1 });
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(writeError).toHaveBeenCalledWith(
      `${JSON.stringify({ taskId: 'task-2', error: 'queue unavailable' })}\n`,
    );
  });

  it('closes the queue, Redis connection, and database after a run', async () => {
    const closeQueue = vi.fn().mockResolvedValue(undefined);
    const closeRedis = vi.fn().mockResolvedValue(undefined);
    const closeDatabase = vi.fn().mockResolvedValue(undefined);

    await closeTaskCategoryBackfillResources({ closeQueue, closeRedis, closeDatabase });

    expect(closeQueue).toHaveBeenCalledOnce();
    expect(closeRedis).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });
});
