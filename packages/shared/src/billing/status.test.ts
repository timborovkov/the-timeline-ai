import { describe, expect, it } from 'vitest';

import { FREE_ALLOWANCES } from '#src/billing/catalog.js';
import {
  deriveBillingNudge,
  freeAllowanceRemaining,
  spendCapUtilization,
} from '#src/billing/status.js';

describe('billing status', () => {
  it('computes spend-cap warn levels', () => {
    expect(spendCapUtilization(0, 2500).warnLevel).toBeNull();
    expect(spendCapUtilization(1250, 2500).warnLevel).toBe(50);
    expect(spendCapUtilization(1875, 2500).warnLevel).toBe(75);
    expect(spendCapUtilization(2250, 2500).warnLevel).toBe(90);
    expect(spendCapUtilization(2500, 2500).warnLevel).toBe(100);
  });

  it('derives free remaining from meter counters', () => {
    const remaining = freeAllowanceRemaining({
      ai: { customerChargeCents: 400 },
      recall_minutes: { nativeUnits: 50 },
    });
    expect(remaining.aiChargeCents).toBe(FREE_ALLOWANCES.aiChargeCents - 400);
    expect(remaining.recallMinutes).toBe(10);
  });

  it('nudges free workspaces near or at allowance', () => {
    const near = deriveBillingNudge({
      planId: 'free',
      canManageBilling: true,
      utilization: spendCapUtilization(0, 0),
      freeRemaining: {
        aiChargeCents: 50,
        recallMinutes: 60,
        emailUnits: 500,
        storageGb: 1,
        acceptedSources: 1000,
      },
      meteredSpendCents: 450,
    });
    expect(near?.kind).toBe('free_near_limit');

    const exhausted = deriveBillingNudge({
      planId: 'free',
      canManageBilling: true,
      utilization: spendCapUtilization(0, 0),
      freeRemaining: {
        aiChargeCents: 0,
        recallMinutes: 60,
        emailUnits: 500,
        storageGb: 1,
        acceptedSources: 1000,
      },
      meteredSpendCents: 500,
    });
    expect(exhausted?.kind).toBe('free_exhausted');
  });
});
