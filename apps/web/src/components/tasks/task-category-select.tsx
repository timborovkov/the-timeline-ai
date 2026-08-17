'use client';

import { TASK_CATEGORY_OPTIONS } from '@timeline/shared/task-categories/types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type {
  TaskCategory,
  TaskCategoryMode,
  TaskCategoryStatus,
} from '@timeline/shared/task-categories/types';

import {
  resetTaskCategoryAction,
  retryTaskCategoryAction,
  setTaskCategoryAction,
  undoTaskCategoryChangeAction,
} from '@/app/actions/objects';
import { useTaskCategoryPolling } from '@/components/tasks/task-category-polling';
import { isoTimestamp } from '@/lib/iso-timestamp';
import { notifyAction } from '@/lib/notify';

const AUTOMATIC_VALUE = '__automatic__';

export function TaskCategorySelect({
  taskId,
  category,
  mode,
  status,
  updatedAt = null,
}: {
  taskId: string;
  category: TaskCategory | null;
  mode: TaskCategoryMode | null;
  status: TaskCategoryStatus | null;
  updatedAt?: Date | string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const categoryQuery = useTaskCategoryPolling(
    status === 'pending' ? [taskId] : [],
    3_000,
    isoTimestamp(updatedAt),
  );
  const categoryState = categoryQuery.data.rows[0];
  const effectiveCategory = categoryState?.taskCategory ?? category;
  const effectiveMode = categoryState?.taskCategoryMode ?? mode;
  const effectiveStatus = categoryState?.taskCategoryStatus ?? status;
  const value =
    optimistic ??
    (effectiveMode === 'manual' && effectiveCategory ? effectiveCategory : AUTOMATIC_VALUE);

  function run(
    nextValue: string,
    action: () => Promise<{ error?: string; undoChangeId?: string }>,
  ): void {
    const previous = value;
    setOptimistic(nextValue);
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${taskId}`,
        loading: 'Updating category…',
        success: 'Category updated',
        error: 'Couldn’t update category',
        run: action,
        undo: {
          run: async (saved) => {
            const changeId = saved.undoChangeId;
            if (!changeId) return { error: 'Couldn’t undo' };
            setOptimistic(previous);
            const undoResult = await undoTaskCategoryChangeAction({ id: taskId, changeId });
            if (!undoResult.error) router.refresh();
            return undoResult;
          },
        },
      });
      if (result.error) setOptimistic(previous);
      else router.refresh();
    });
  }

  return (
    <div className="task-category-ui space-y-2">
      <select
        aria-label="Task category"
        value={value}
        disabled={pending}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === AUTOMATIC_VALUE) {
            run(next, () => resetTaskCategoryAction({ id: taskId }));
          } else {
            run(next, () => setTaskCategoryAction({ id: taskId, category: next }));
          }
        }}
        className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm text-fg disabled:cursor-progress disabled:opacity-60"
      >
        <option value={AUTOMATIC_VALUE}>
          {effectiveStatus === 'pending' ? 'Automatic · Categorizing…' : 'Use automatic category'}
        </option>
        {TASK_CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {effectiveMode === 'automatic' && effectiveStatus === 'failed' ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            run(value, () => retryTaskCategoryAction({ id: taskId }));
          }}
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-signal hover:underline disabled:opacity-60"
        >
          Retry automatic category
        </button>
      ) : null}
    </div>
  );
}
