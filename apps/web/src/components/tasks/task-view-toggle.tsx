import Link from 'next/link';

import { taskViewHref, type TaskView } from '@/components/tasks/task-view';

const EMPTY_FILTER_PARAMS: Record<string, string> = {};

export function TaskViewToggle({
  view,
  selectedTaskId,
  filterParams = EMPTY_FILTER_PARAMS,
}: {
  view: TaskView;
  selectedTaskId: string | null;
  filterParams?: Record<string, string>;
}) {
  return (
    <nav aria-label="Task view" className="inline-flex overflow-hidden rounded-sm bg-surface">
      {(['kanban', 'list'] as const).map((nextView) => (
        <Link
          key={nextView}
          href={taskViewHref(nextView, selectedTaskId, filterParams)}
          className={`min-h-9 px-3 py-2 text-xs capitalize transition-colors ${
            view === nextView
              ? 'bg-surface-2 text-fg'
              : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          {nextView}
        </Link>
      ))}
    </nav>
  );
}
