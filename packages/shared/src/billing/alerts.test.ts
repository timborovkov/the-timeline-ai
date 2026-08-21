import { describe, expect, it } from 'vitest';

import { billingUsageAlertKindsForState } from '#src/billing/alerts.js';
import { FREE_ALLOWANCES } from '#src/billing/catalog.js';
import { freeAllowanceRemaining } from '#src/billing/status.js';

describe('billingUsageAlertKindsForState', () => {
  it('emits Free near-limit then exhausted kinds', () => {
    const near = freeAllowanceRemaining({
      ai: { customerChargeCents: FREE_ALLOWANCES.aiChargeCents - 1 },
    });
    expect(billingUsageAlertKindsForState({
      planId: 'free',
      spendCapCents: 0,
      meteredSpendCents: FREE_ALLOWANCES.aiChargeCents - 1,
      freeRemaining: near,
    })).toEqual(['free_near_limit']);

    const exhausted = freeAllowanceRemaining({
      ai: { customerChargeCents: FREE_ALLOWANCES.aiChargeCents },
    });
    expect(billingUsageAlertKindsForState({
      planId: 'free',
      spendCapCents: 0,
      meteredSpendCents: FREE_ALLOWANCES.aiChargeCents,
      freeRemaining: exhausted,
    })).toEqual(['free_exhausted']);
  });

  it('stacks spend-cap thresholds through the current warn level', () => {
    expect(
      billingUsageAlertKindsForState({
        planId: 'payg',
        spendCapCents: 100_00,
        meteredSpendCents: 90_00,
        freeRemaining: freeAllowanceRemaining({}),
      }),
    ).toEqual(['spend_cap_50', 'spend_cap_75', 'spend_cap_90']);

    expect(
      billingUsageAlertKindsForState({
        planId: 'team',
        spendCapCents: 100_00,
        meteredSpendCents: 100_00,
        freeRemaining: freeAllowanceRemaining({}),
      }),
    ).toEqual(['spend_cap_50', 'spend_cap_75', 'spend_cap_90', 'spend_cap_100']);
  });

  it('skips paid alerts below 50%', () => {
    expect(
      billingUsageAlertKindsForState({
        planId: 'business',
        spendCapCents: 100_00,
        meteredSpendCents: 49_00,
        freeRemaining: freeAllowanceRemaining({}),
      }),
    ).toEqual([]);
  });
});
