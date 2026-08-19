import { CollectionViewToggle } from '@/components/collections/collection-view-toggle';
import {
  EMPTY_TASK_VIEW_FILTER_PARAMS,
  taskViewHref,
  type TaskView,
} from '@/components/tasks/task-view';

export function TaskViewToggle({
  view,
  selectedTaskId,
  filterParams = EMPTY_TASK_VIEW_FILTER_PARAMS,
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
