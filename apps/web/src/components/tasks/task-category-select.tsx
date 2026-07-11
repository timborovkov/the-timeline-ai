'use client';

import { TASK_CATEGORY_OPTIONS } from '@timeline/shared/task-categories/types';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
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
  loadTaskCategoryStatesAction,
} from '@/app/actions/objects';
import { errorMessage } from '@/lib/utils';

const AUTOMATIC_VALUE = '__automatic__';

export function TaskCategorySelect({
  taskId,
  category,
  mode,
  status,
}: {
  taskId: string;
  category: TaskCategory | null;
  mode: TaskCategoryMode | null;
  status: TaskCategoryStatus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pollStartedAt = useRef<number | null>(null);
  const value = mode === 'manual' && category ? category : AUTOMATIC_VALUE;

  useEffect(() => {
    if (status !== 'pending') {
      pollStartedAt.current = null;
      return;
    }
    pollStartedAt.current ??= Date.now();
    const timer = setInterval(() => {
      if (Date.now() - (pollStartedAt.current ?? Date.now()) > 60_000) {
        clearInterval(timer);
        return;
      }
      void loadTaskCategoryStatesAction({ ids: [taskId] })
        .then((result) => {
          if (result.rows?.[0]?.taskCategoryStatus !== 'pending') router.refresh();
        })
        .catch(() => undefined);
    }, 3_000);
    return () => {
      clearInterval(timer);
    };
  }, [router, status, taskId]);

  function run(action: () => Promise<{ error?: string; undoChangeId?: string }>): void {
    setError(null);
    startTransition(() => {
      void action()
        .then((result) => {
          if (result.error) setError(result.error);
          else {
            router.refresh();
            if (result.undoChangeId) {
              const changeId = result.undoChangeId;
              toast.success('Category changed', {
                action: {
                  label: 'Undo',
                  onClick: () => {
                    void undoTaskCategoryChangeAction({ id: taskId, changeId }).then(
                      (undoResult) => {
                        if (undoResult.error) toast.error(undoResult.error);
                        else router.refresh();
                      },
                    );
                  },
                },
              });
            }
          }
        })
        .catch((cause: unknown) => {
          setError(errorMessage(cause, 'Category update failed'));
        });
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
          {status === 'pending' ? 'Automatic · Categorizing…' : 'Use automatic category'}
        </option>
        {TASK_CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {mode === 'automatic' && status === 'failed' ? (
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
