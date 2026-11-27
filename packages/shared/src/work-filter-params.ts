export const WORK_FILTER_PARAM_KEYS = [
  'q',
  'type',
  'status',
  'category',
  'project',
  'stage',
  'owner',
  'assignee',
  'responsible',
  'lane',
  'priority',
  'due',
  'dueFrom',
  'dueTo',
  'createdFrom',
  'createdTo',
  'updatedFrom',
  'updatedTo',
] as const;

export const SAVED_WORK_VIEW_FILTER_VALUE_MAX = 500;

const APPROVAL_FILTER_KEYS = ['status', 'boardId', 'project', 'decision'];
const WORK_VIEW_FILTER_KEYS = [...WORK_FILTER_PARAM_KEYS, 'view'];

export function savedWorkViewFilterKeys(collection: string): readonly string[] {
  if (collection === 'approvals') return APPROVAL_FILTER_KEYS;
  return collection === 'tasks' || collection === 'boards'
    ? WORK_VIEW_FILTER_KEYS
    : WORK_FILTER_PARAM_KEYS;
}
