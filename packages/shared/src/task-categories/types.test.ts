/** Business intent: category keys are a stable wire contract with one clear label each. */
import { describe, expect, it } from 'vitest';

import {
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_OPTIONS,
  taskCategoryLabel,
  taskCategorySchema,
} from '#src/task-categories/types.js';

describe('task category taxonomy', () => {
  it('has unique keys, labels, and matching selector options', () => {
    expect(new Set(TASK_CATEGORIES).size).toBe(TASK_CATEGORIES.length);
    expect(new Set(Object.values(TASK_CATEGORY_LABELS)).size).toBe(TASK_CATEGORIES.length);
    expect(TASK_CATEGORY_OPTIONS.map((option) => option.value)).toEqual(TASK_CATEGORIES);
  });

  it('accepts only published keys and presents null as Uncategorized', () => {
    expect(taskCategorySchema.parse('engineering')).toBe('engineering');
    expect(taskCategorySchema.safeParse('uncategorized').success).toBe(false);
    expect(taskCategoryLabel(null)).toBe('Uncategorized');
  });
});
