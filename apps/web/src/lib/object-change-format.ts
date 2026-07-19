import { taskCategoryLabel, taskCategorySchema } from '@timeline/shared/task-categories/types';

export function formatTaskCategoryChangeValue(field: string, value: unknown): string | null {
  if (field !== 'taskCategory') return null;
  const category =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).category
      : value;
  if (category === null || category === undefined || category === '') return 'Uncategorized';
  const parsed = taskCategorySchema.safeParse(category);
  return parsed.success ? taskCategoryLabel(parsed.data) : null;
}
