import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { TASK_CATEGORY_EVAL_CASES } from '#src/task-categories/eval-cases.js';

import { summarizeClassification } from '#src/task-categories/experiment-report.js';

describe('classification experiments', () => {
  const perfect = () =>
    TASK_CATEGORY_EVAL_CASES.map((item) => ({
      id: item.id,
      expected: item.expected,
      predicted: item.expected,
      tags: item.tags,
      durationMs: 10,
    }));
  it('passes a complete correct corpus but never a partial smoke run', () => {
    expect(summarizeClassification(perfect(), true).releaseGatePassed).toBe(true);
    expect(summarizeClassification(perfect(), false).releaseGatePassed).toBe(false);
    expect(summarizeClassification(perfect().slice(0, 2), true).releaseGatePassed).toBe(false);
  });
  it('counts failed calls in the accuracy denominator', () => {
    const rows = perfect().map((row) => ({ ...row, predicted: null }));
    const result = summarizeClassification(rows, true);
    expect(result.accuracy).toBe(0);
    expect(result.failures).toBe(rows.length);
    expect(result.releaseGatePassed).toBe(false);
  });
  it('blocks promotion on an injection failure even with high overall accuracy', () => {
    const rows = perfect();
    const injection = rows.find((row) => row.tags.includes('prompt-injection'));
    if (!injection) throw new Error('Missing injection fixture');
    injection.predicted = 'other';
    const result = summarizeClassification(rows, true);
    expect(result.accuracy).toBeGreaterThan(0.95);
    expect(result.releaseGatePassed).toBe(false);
  });
});
