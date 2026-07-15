import { describe, expect, it, vi } from 'vitest';

import {
  assertTaskCategoryBackfillModeEnabled,
  enqueueTaskCategoryBackfillBatch,
} from '#src/scripts/task-category-backfill.js';

describe('task category backfill script', () => {
  it('allows a dry run while operational flags are disabled', () => {
    const disabled = {
      TASK_CATEGORY_CLASSIFICATION_ENABLED: false,
      TASK_CATEGORY_BACKFILL_ENABLED: false,
      TASK_CATEGORY_WORKER_ENABLED: false,
    };

    expect(() => assertTaskCategoryBackfillModeEnabled(false, disabled)).not.toThrow();
    expect(() => assertTaskCategoryBackfillModeEnabled(true, disabled)).toThrow(
      'Task category backfill execution is disabled by an operational kill switch',
    );
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
});
