import { CollectionViewToggle } from '@/components/collections/collection-view-toggle';

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
    <CollectionViewToggle
      label="Task view"
      views={['kanban', 'list'] as const}
      current={view}
      hrefFor={(nextView) => taskViewHref(nextView, selectedTaskId, filterParams)}
    />
  );
}
