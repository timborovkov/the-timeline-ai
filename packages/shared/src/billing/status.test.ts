import { describe, expect, it } from 'vitest';

import { FREE_ALLOWANCES, PLAN_CATALOG } from '#src/billing/catalog.js';
import {
  deriveBillingNudge,
  deriveSidebarBillingSummary,
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

  it('treats PAYG AI native units as gross Free-floor consumption', () => {
    const remaining = freeAllowanceRemaining({
      ai: { customerChargeCents: 0, nativeUnits: 400 },
    });
    expect(remaining.aiChargeCents).toBe(100);
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
        recallMinutes: 0,
        emailUnits: 0,
        storageGb: 0,
        acceptedSources: 0,
      },
      meteredSpendCents: 500,
    });
    expect(exhausted?.kind).toBe('free_exhausted');
  });

  it('treats low Free storage as near-limit and points commitment CTAs at pricing', () => {
    const nearStorage = deriveBillingNudge({
      planId: 'free',
      canManageBilling: true,
      utilization: spendCapUtilization(0, 0),
      freeRemaining: {
        aiChargeCents: FREE_ALLOWANCES.aiChargeCents,
        recallMinutes: FREE_ALLOWANCES.recallMinutes,
        emailUnits: FREE_ALLOWANCES.emailUnits,
        storageGb: 0,
        acceptedSources: FREE_ALLOWANCES.acceptedSources,
      },
      meteredSpendCents: 0,
    });
    expect(nearStorage?.kind).toBe('free_near_limit');

    const commitment = deriveBillingNudge({
      planId: 'payg',
      canManageBilling: true,
      utilization: spendCapUtilization(100, 2_500),
      freeRemaining: {
        aiChargeCents: 0,
        recallMinutes: 0,
        emailUnits: 0,
        storageGb: 0,
        acceptedSources: 0,
      },
      meteredSpendCents: Math.ceil(PLAN_CATALOG.team.includedUsageDiscountCents * 0.7),
    });
    expect(commitment?.kind).toBe('suggest_commitment');
    expect(commitment?.href).toBe('/pricing');
  });

  it('builds a sidebar summary with overage for PAYG', () => {
    const summary = deriveSidebarBillingSummary({
      planId: 'payg',
      canManageBilling: true,
      meteredSpendCents: 2_000,
      spendCapCents: 2_500,
      includedDiscountRemainingCents: 0,
      freeRemaining: {
        aiChargeCents: 0,
        recallMinutes: 0,
        emailUnits: 0,
        storageGb: 0,
        acceptedSources: 0,
      },
    });
    expect(summary.planName).toBe('Pay as you go');
    expect(summary.progressPercent).toBe(80);
    expect(summary.detailLabel).toMatch(/€/);
    expect(summary.overageCents).toBeGreaterThan(0);
    expect(summary.overageLabel).toMatch(/overage/);
    expect(summary.href).toBe('/app/team?section=billing');
  });
});
