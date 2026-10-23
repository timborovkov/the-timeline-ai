import { describe, expect, it } from 'vitest';

import { normalizeTaskCategoryModelJson } from '#src/task-categories/model-output.js';

describe('task category model output', () => {
  it('unwraps a labeled batch and coerces string confidence', () => {
    expect(
      normalizeTaskCategoryModelJson({
        reasoning: 'The questionnaire is customer work.',
        result: {
          predictions: [
            { key: '0:0', category: 'Customer Success', confidence: '0.91' },
            { key: '0:1', label: 'IT & Security', score: 0.8 },
          ],
        },
      }),
    ).toEqual({
      predictions: [
        { key: '0:0', category: 'customer_success', confidence: 0.91 },
        { key: '0:1', category: 'it_security', confidence: 0.8 },
      ],
    });
  });

  it('accepts a top-level prediction array and a key map', () => {
    expect(
      normalizeTaskCategoryModelJson([{ key: '0:0', category: 'engineering', confidence: 1 }]),
    ).toEqual({
      predictions: [{ key: '0:0', category: 'engineering', confidence: 1 }],
    });
    expect(
      normalizeTaskCategoryModelJson({
        predictions: {
          '0:0': { category: 'sales', confidence: 0.5 },
        },
      }),
    ).toEqual({
      predictions: [{ key: '0:0', category: 'sales', confidence: 0.5 }],
    });
  });

  it('leaves non-category JSON unchanged', () => {
    const facts = { facts: [{ statement: 'Acme paused the rollout', confidence: 1 }] };
    expect(normalizeTaskCategoryModelJson(facts)).toEqual(facts);
  });
});
