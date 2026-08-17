import { CollectionViewToggle } from '@/components/collections/collection-view-toggle';

export type TaskView = 'kanban' | 'list';

export function taskViewHref(
  view: TaskView,
  taskId: string | null,
  extraParams: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ ...extraParams, view });
  if (taskId) params.set('task', taskId);
  return `/app/tasks?${params.toString()}`;
}

export function TaskViewToggle({
  view,
  selectedTaskId,
  filterParams = {},
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
