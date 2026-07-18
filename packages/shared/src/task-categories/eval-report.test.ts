import { describe, expect, it } from 'vitest';

import { buildTaskCategoryConfusionMatrix } from '#src/task-categories/eval-report.js';
import { TASK_CATEGORIES } from '#src/task-categories/types.js';

describe('task category eval report', () => {
  it('builds a complete expected-by-predicted confusion matrix', () => {
    const matrix = buildTaskCategoryConfusionMatrix([
      { expected: 'engineering', predicted: 'engineering' },
      { expected: 'design', predicted: 'engineering' },
      { expected: 'design', predicted: 'design' },
    ]);

    expect(Object.keys(matrix)).toEqual(TASK_CATEGORIES);
    for (const row of Object.values(matrix)) expect(Object.keys(row)).toEqual(TASK_CATEGORIES);
    expect(matrix.engineering.engineering).toBe(1);
    expect(matrix.design.engineering).toBe(1);
    expect(matrix.design.design).toBe(1);
    expect(
      Object.values(matrix).reduce(
        (total, row) => total + Object.values(row).reduce((sum, count) => sum + count, 0),
        0,
      ),
    ).toBe(3);
  });
});
