import { BillingAdmissionError } from '@timeline/shared/billing';
import { DelayedError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runWorkerBilling = vi.hoisted(() =>
  vi.fn((_db: unknown, _teamId: string, _operationClass: string, fn: () => Promise<unknown>) =>
    fn(),
  ),
);

vi.mock('@timeline/shared/billing', async () => {
  const actual = await vi.importActual('@timeline/shared/billing');
  return { ...actual, runWorkerBilling };
});

import { withWorkerAiBilling } from '#src/billing-context.js';

const TEAM_ID = '11111111-2222-4333-8444-555555555555';

describe('withWorkerAiBilling', () => {
  beforeEach(() => {
    runWorkerBilling.mockClear();
  });

  it('delays when admission reports costly_worker_busy', async () => {
    const delayJob = vi.fn(() => Promise.resolve());
    await expect(
      withWorkerAiBilling(
        {} as never,
        TEAM_ID,
        'embedding',
        () => {
          throw new BillingAdmissionError('costly_worker_busy');
        },
        { delayJob },
      ),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(delayJob).toHaveBeenCalledWith(15_000);
  });
});
