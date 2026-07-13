import { describe, expect, it, vi } from 'vitest';

import { enqueueTaskCategoryBackfillBatch } from '#src/scripts/task-category-backfill.js';

describe('task category backfill script', () => {
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
