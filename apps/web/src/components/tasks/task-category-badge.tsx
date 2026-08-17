'use client';

import { taskCategoryLabel } from '@timeline/shared/task-categories/types';
import { createContext, use, useMemo } from 'react';

import type { TaskCategory, TaskCategoryStatus } from '@timeline/shared/task-categories/types';
import type { ReactNode } from 'react';

import { useTaskCategoryPolling } from '@/components/tasks/task-category-polling';
import { isoTimestamp } from '@/lib/iso-timestamp';
import { cn } from '@/lib/utils';

interface TaskCategoryPollingTarget {
  id: string;
  status: TaskCategoryStatus | null;
  updatedAt: Date | string | null;
}

type PolledTaskCategoryState = ReturnType<typeof useTaskCategoryPolling>['data']['rows'][number];

const TaskCategoryPollingContext = createContext<ReadonlyMap<
  string,
  PolledTaskCategoryState
> | null>(null);

export function TaskCategoryPollingProvider({
  tasks,
  children,
}: {
  tasks: TaskCategoryPollingTarget[];
  children: ReactNode;
}) {
  const pendingTasks = useMemo(() => tasks.filter((task) => task.status === 'pending'), [tasks]);
  if (pendingTasks.length === 0) return children;
  return (
    <PendingTaskCategoryPollingProvider tasks={pendingTasks}>
      {children}
    </PendingTaskCategoryPollingProvider>
  );
}

function PendingTaskCategoryPollingProvider({
  tasks,
  children,
}: {
  tasks: TaskCategoryPollingTarget[];
  children: ReactNode;
}) {
  const ids = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const generationKey = useMemo(
    () =>
      tasks
        .map((task) => `${task.id}:${isoTimestamp(task.updatedAt) ?? ''}`)
        .sort()
        .join(','),
    [tasks],
  );
  const query = useTaskCategoryPolling(ids, 3_000, generationKey);
  const states = useMemo(
    () => new Map(query.data.rows.map((row) => [row.id, row] as const)),
    [query.data.rows],
  );
  return (
    <TaskCategoryPollingContext.Provider value={states}>
      {children}
    </TaskCategoryPollingContext.Provider>
  );
}

export function TaskCategoryBadge({
  category,
  status,
  className,
}: {
  category: TaskCategory | null;
  status: TaskCategoryStatus | null;
  className?: string;
}) {
  const categoryLabel = category === null ? null : taskCategoryLabel(category);
  const label =
    status === 'pending'
      ? categoryLabel
        ? `${categoryLabel} · Categorizing…`
        : 'Categorizing…'
      : status === 'failed'
        ? `${categoryLabel ?? 'Category failed'} · Retry`
        : (categoryLabel ?? 'Needs category');
  return (
    <span
      className={cn(
        'task-category-ui inline-flex max-w-full items-center truncate rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] text-fg-muted',
        status === 'failed' && 'border-danger/40 text-danger',
        className,
      )}
      title={label}
    >
      {label}
    </span>
  );
}

export function LiveTaskCategoryBadge({
  taskId,
  category,
  status,
  updatedAt = null,
  className,
}: {
  taskId: string;
  category: TaskCategory | null;
  status: TaskCategoryStatus | null;
  updatedAt?: Date | string | null;
  className?: string;
}) {
  const sharedStates = use(TaskCategoryPollingContext);
  if (status !== 'pending') {
    return <TaskCategoryBadge category={category} status={status} className={className} />;
  }
  if (sharedStates !== null) {
    const polled = sharedStates.get(taskId);
    return (
      <TaskCategoryBadge
        category={polled ? polled.taskCategory : category}
        status={polled ? polled.taskCategoryStatus : 'pending'}
        className={className}
      />
    );
  }
  return (
    <StandalonePendingTaskCategoryBadge
      taskId={taskId}
      category={category}
      updatedAt={updatedAt}
      className={className}
    />
  );
}

function StandalonePendingTaskCategoryBadge({
  taskId,
  category,
  updatedAt,
  className,
}: {
  taskId: string;
  category: TaskCategory | null;
  updatedAt: Date | string | null;
  className?: string;
}) {
  const categoryQuery = useTaskCategoryPolling([taskId], 3_000, isoTimestamp(updatedAt));
  const polled = categoryQuery.data.rows[0];
  return (
    <TaskCategoryBadge
      category={polled ? polled.taskCategory : category}
      status={polled ? polled.taskCategoryStatus : 'pending'}
      className={className}
    />
  );
}
