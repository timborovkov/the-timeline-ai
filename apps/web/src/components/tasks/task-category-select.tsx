'use client';

import { TASK_CATEGORY_OPTIONS } from '@timeline/shared/task-categories/types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { errorMessage } from '@/lib/utils';

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
  updatedAt?: Date | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const categoryQuery = useTaskCategoryPolling(
    status === 'pending' ? [taskId] : [],
    3_000,
    updatedAt?.toISOString(),
  );
  const categoryState = categoryQuery.data.rows?.[0];
  const effectiveCategory = categoryState?.taskCategory ?? category;
  const effectiveMode = categoryState?.taskCategoryMode ?? mode;
  const effectiveStatus = categoryState?.taskCategoryStatus ?? status;
  const value =
    effectiveMode === 'manual' && effectiveCategory ? effectiveCategory : AUTOMATIC_VALUE;

  function run(action: () => Promise<{ error?: string; undoChangeId?: string }>): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) setError(result.error);
        else {
          router.refresh();
          if (result.undoChangeId) {
            const changeId = result.undoChangeId;
            toast.success('Category changed', {
              action: {
                label: 'Undo',
                onClick: () => {
                  void undoTaskCategoryChangeAction({ id: taskId, changeId }).then((undoResult) => {
                    if (undoResult.error) toast.error(undoResult.error);
                    else router.refresh();
                  });
                },
              },
            });
          }
        }
      } catch (cause) {
        setError(errorMessage(cause, 'Category update failed'));
      }
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
            run(() => resetTaskCategoryAction({ id: taskId }));
          } else {
            run(() => setTaskCategoryAction({ id: taskId, category: next }));
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
            run(() => retryTaskCategoryAction({ id: taskId }));
          }}
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-signal hover:underline disabled:opacity-60"
        >
          Retry automatic category
        </button>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
