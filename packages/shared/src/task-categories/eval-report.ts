import { TASK_CATEGORIES, type TaskCategory } from '#src/task-categories/types.js';

export type TaskCategoryConfusionMatrix = Record<TaskCategory, Record<TaskCategory, number>>;

export function buildTaskCategoryConfusionMatrix(
  results: readonly { expected: TaskCategory; predicted: TaskCategory }[],
): TaskCategoryConfusionMatrix {
  const matrix = Object.fromEntries(
    TASK_CATEGORIES.map((expected) => [
      expected,
      Object.fromEntries(TASK_CATEGORIES.map((predicted) => [predicted, 0])),
    ]),
  ) as TaskCategoryConfusionMatrix;
  for (const result of results) matrix[result.expected][result.predicted] += 1;
  return matrix;
}
