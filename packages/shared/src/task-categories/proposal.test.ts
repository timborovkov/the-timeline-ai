import { afterEach, expect, it, vi } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  enrichTaskProposalCategories,
  enrichTaskProposalCategory,
} from '#src/task-categories/proposal.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetEnvForTests();
});

it('does not classify task proposals while the master switch is disabled', async () => {
  process.env.AUTH_SECRET = 'test-auth-secret-must-be-at-least-16-chars';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'false';
  resetEnvForTests();
  const classify = vi.fn();
  const proposedPayload = { canonicalName: 'Prepare launch brief' };

  await expect(
    enrichTaskProposalCategory({
      proposedPayload,
      fallbackTitle: 'Prepare launch brief',
      classify,
    }),
  ).resolves.toEqual(proposedPayload);
  expect(classify).not.toHaveBeenCalled();
});

it('enriches multiple task proposals through one batch classifier call', async () => {
  const classify = vi.fn().mockResolvedValue([
    { key: 'first', category: 'design', confidence: 0.9, model: 'batch-model' },
    { key: 'second', category: 'engineering', confidence: 0.95, model: 'batch-model' },
  ]);

  const result = await enrichTaskProposalCategories({
    proposals: [
      {
        key: 'first',
        proposedPayload: { canonicalName: 'Design the homepage' },
        fallbackTitle: 'Design the homepage',
      },
      {
        key: 'second',
        proposedPayload: { canonicalName: 'Implement the API' },
        fallbackTitle: 'Implement the API',
      },
    ],
    classify,
    enabled: true,
  });

  expect(classify).toHaveBeenCalledTimes(1);
  expect(result.get('first')).toMatchObject({
    taskCategory: 'design',
    taskCategoryMode: 'automatic',
  });
  expect(result.get('second')).toMatchObject({
    taskCategory: 'engineering',
    taskCategoryMode: 'automatic',
  });
});
