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
