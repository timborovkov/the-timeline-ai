import { taskCategoryLabel } from '@timeline/shared/task-categories/types';

import type { TaskCategory, TaskCategoryStatus } from '@timeline/shared/task-categories/types';

import { cn } from '@/lib/utils';

export function TaskCategoryBadge({
  category,
  status,
  className,
}: {
  category: TaskCategory | null;
  status: TaskCategoryStatus | null;
  className?: string;
}) {
  const label =
    category !== null
      ? taskCategoryLabel(category)
      : status === 'pending'
        ? 'Categorizing…'
        : 'Needs category';
  return (
    <span
      className={cn(
        'task-category-ui inline-flex max-w-full items-center truncate rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] text-fg-muted',
        status === 'failed' && category === null && 'border-danger/40 text-danger',
        className,
      )}
      title={label}
    >
      {label}
    </span>
  );
}
