import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';

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
    taskCategoryTaxonomyVersion: 'task-categories-v1',
  });
});

it('fails when a batch classifier omits a task proposal', async () => {
  const classify = vi
    .fn()
    .mockResolvedValue([
      { key: 'first', category: 'design', confidence: 0.9, model: 'batch-model' },
    ]);

  await expect(
    enrichTaskProposalCategories({
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
    }),
  ).rejects.toThrow(/omitted a task proposal/);
});

it('fails when a classifier returns a category outside the taxonomy', async () => {
  const classify = vi.fn().mockResolvedValue({
    category: 'Customer Success',
    confidence: 0.8,
    model: 'batch-model',
  });

  await expect(
    enrichTaskProposalCategory({
      proposedPayload: { canonicalName: 'Renew Northstar' },
      fallbackTitle: 'Renew Northstar',
      classify,
      enabled: true,
    }),
  ).rejects.toThrow(/unusable prediction/);
});

it('fails when the classifier errors instead of storing an unstamped proposal', async () => {
  const classify = vi.fn().mockRejectedValue(new Error('wrapped json'));

  await expect(
    enrichTaskProposalCategory({
      proposedPayload: { canonicalName: 'Send the questionnaire' },
      fallbackTitle: 'Send the questionnaire',
      classify,
      enabled: true,
    }),
  ).rejects.toThrow(/wrapped json/);
});
