export type TaskView = 'kanban' | 'list';

export const EMPTY_TASK_VIEW_FILTER_PARAMS: Record<string, string> = {};

export function taskViewHref(
  view: TaskView,
  taskId: string | null,
  extraParams: Record<string, string> = EMPTY_TASK_VIEW_FILTER_PARAMS,
): string {
  const params = new URLSearchParams({ ...extraParams, view });
  if (taskId) params.set('task', taskId);
  return `/app/tasks?${params.toString()}`;
}
