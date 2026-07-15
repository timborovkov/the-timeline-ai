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
