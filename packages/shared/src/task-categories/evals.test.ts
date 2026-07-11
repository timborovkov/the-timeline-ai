/** Business intent: the release eval manifest is balanced, versioned, and covers safety boundaries. */
import { describe, expect, it } from 'vitest';

import { TASK_CATEGORY_EVAL_CASES } from '#src/task-categories/eval-cases.js';
import { TASK_CATEGORIES } from '#src/task-categories/types.js';

describe('task category eval manifest', () => {
  it('contains 120 unique labeled cases with at least six examples per category', () => {
    expect(TASK_CATEGORY_EVAL_CASES).toHaveLength(120);
    expect(new Set(TASK_CATEGORY_EVAL_CASES.map((testCase) => testCase.id)).size).toBe(120);
    for (const category of TASK_CATEGORIES) {
      expect(
        TASK_CATEGORY_EVAL_CASES.filter((testCase) => testCase.expected === category).length,
      ).toBeGreaterThanOrEqual(6);
    }
  });

  it('covers prompt injection, multilingual, project context, and hard boundaries', () => {
    const tags = new Set(TASK_CATEGORY_EVAL_CASES.flatMap((testCase) => testCase.tags));
    for (const required of [
      'prompt-injection',
      'multilingual',
      'project-context',
      'product-engineering',
      'sales-cs',
      'legal-security',
    ]) {
      expect(tags.has(required)).toBe(true);
    }
  });
});
