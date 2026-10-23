import { describe, expect, it } from 'vitest';

import {
  cumulativeChargeDeltaCents,
  memberDayChargeDelta,
  memberDaysChargeCents,
  nextIncludedDiscountPeriod,
  paygOverageCustomerChargeCents,
  polarInvoiceNativeUnits,
  polarMemberMonthUnits,
  settlementSegmentsForMeter,
  shouldIngestPolarMeteredUsage,
  splitDiscountAndWallet,
  splitDurationNativeUnitsByUtcMonth,
} from '#src/billing/charge.js';
import {
  allFreeAllowancesExhausted,
  costBearingPausedFromAccount,
  restoredPaidBillingStateAfterWalletOrCapRecovery,
  restoredSpendCapCentsAfterShortfallUnfreeze,
} from '#src/billing/status.js';

describe('billing charge split', () => {
  it('covers Team/Business included discount before the Polar invoice', () => {
    expect(splitDiscountAndWallet({ chargeCents: 80, includedDiscountRemainingCents: 60 })).toEqual(
      { discountCents: 60, invoiceCents: 20 },
    );
    expect(splitDiscountAndWallet({ chargeCents: 40, includedDiscountRemainingCents: 60 })).toEqual(
      { discountCents: 40, invoiceCents: 0 },
    );
  });

  it('keeps extra member-days on the spend cap instead of the included-usage discount', () => {
    expect(
      splitDiscountAndWallet({
        chargeCents: 80,
        includedDiscountRemainingCents: 60,
        meterId: 'member_days',
      }),
    ).toEqual({ discountCents: 0, invoiceCents: 80 });
  });

  it('keeps the PAYG Free floor off the Polar invoice', () => {
    expect(
      paygOverageCustomerChargeCents({
        planId: 'payg',
        meterId: 'recall_minutes',
        nativeUnits: 10,
        listChargeCents: 30,
        meters: {},
      }),
    ).toBe(0);
    expect(
      paygOverageCustomerChargeCents({
        planId: 'payg',
        meterId: 'recall_minutes',
        nativeUnits: 70,
        listChargeCents: 210,
        meters: { recall_minutes: { nativeUnits: 0, customerChargeCents: 0 } },
      }),
    ).toBe(30);
    expect(
      paygOverageCustomerChargeCents({
        planId: 'team',
        meterId: 'recall_minutes',
        nativeUnits: 10,
        listChargeCents: 30,
        meters: {},
      }),
    ).toBe(30);
  });

  it('uses gross AI native units for the PAYG Free floor', () => {
    expect(
      paygOverageCustomerChargeCents({
        planId: 'payg',
        meterId: 'ai',
        nativeUnits: 40,
        listChargeCents: 40,
        meters: { ai: { nativeUnits: 0, customerChargeCents: 0 } },
      }),
    ).toBe(0);
    expect(
      paygOverageCustomerChargeCents({
        planId: 'payg',
        meterId: 'ai',
        nativeUnits: 40,
        listChargeCents: 40,
        meters: { ai: { nativeUnits: 480, customerChargeCents: 0 } },
      }),
    ).toBe(20);
  });

  it('charges accepted sources on the cumulative cent boundary', () => {
    expect(
      cumulativeChargeDeltaCents({
        meterId: 'accepted_sources',
        previousNativeUnits: 0,
        nextNativeUnits: 1,
      }),
    ).toBe(0);
    expect(
      cumulativeChargeDeltaCents({
        meterId: 'accepted_sources',
        previousNativeUnits: 9,
        nextNativeUnits: 10,
      }),
    ).toBe(1);
  });
});

describe('polarMemberMonthUnits', () => {
  it('scales payable cents onto the €2 catalog member-month price', () => {
    expect(polarMemberMonthUnits(200)).toBe(1);
    expect(polarMemberMonthUnits(6)).toBe(0.03);
    expect(polarMemberMonthUnits(16)).toBe(0.08);
    expect(polarMemberMonthUnits(0)).toBe(0);
    expect(polarMemberMonthUnits(-4)).toBe(0);
  });
});

describe('memberDayChargeDelta', () => {
  it('uses the commercial member-month price for one extra day', () => {
    expect(
      memberDayChargeDelta({
        previousNativeUnits: 0,
        nextNativeUnits: 1,
        centsPerMemberMonth: 400,
        daysInMonth: 31,
      }),
    ).toBe(13);
    expect(
      memberDayChargeDelta({
        previousNativeUnits: 30,
        nextNativeUnits: 31,
        centsPerMemberMonth: 400,
        daysInMonth: 31,
      }),
    ).toBeGreaterThan(0);
    let charged = 0;
    for (let day = 1; day <= 31; day += 1) {
      charged += memberDayChargeDelta({
        previousNativeUnits: day - 1,
        nextNativeUnits: day,
        centsPerMemberMonth: 400,
        daysInMonth: 31,
      });
    }
    expect(charged).toBe(400);
  });
});

describe('memberDaysChargeCents', () => {
  it('totals €2 over a 31-day month without daily rounding drift', () => {
    let charged = 0;
    for (let day = 1; day <= 31; day += 1) {
      charged +=
        memberDaysChargeCents({
          extraMemberDays: day,
          centsPerMemberMonth: 200,
          daysInMonth: 31,
        }) -
        memberDaysChargeCents({
          extraMemberDays: day - 1,
          centsPerMemberMonth: 200,
          daysInMonth: 31,
        });
    }
    expect(charged).toBe(200);
  });
});

describe('shouldIngestPolarMeteredUsage', () => {
  it('ingests the customer-payable remainder for subscription plans', () => {
    expect(
      shouldIngestPolarMeteredUsage({
        eventName: 'timeline_recall_minutes',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        billable: true,
        polarUnits: 10,
        invoiceCents: 30,
      }),
    ).toBe(true);
    expect(polarInvoiceNativeUnits({ polarUnits: 10, chargeCents: 100, invoiceCents: 40 })).toBe(4);
    expect(polarInvoiceNativeUnits({ polarUnits: 10, chargeCents: 30, invoiceCents: 10 })).toBe(
      3.333333,
    );
    expect(
      polarInvoiceNativeUnits({ polarUnits: 10, chargeCents: 30, invoiceCents: 10 }),
    ).toBeLessThanOrEqual(10 / 3);
  });

  it('skips ingest when included discount covers the charge or the round is sub-cent', () => {
    expect(
      shouldIngestPolarMeteredUsage({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        billable: true,
        polarUnits: 80,
        invoiceCents: 0,
      }),
    ).toBe(false);
    expect(
      shouldIngestPolarMeteredUsage({
        eventName: 'timeline_email_units',
        polarCustomerId: 'cus_1',
        shadowBilling: true,
        billable: true,
        polarUnits: 1,
        invoiceCents: 1,
      }),
    ).toBe(false);
  });
});

describe('nextIncludedDiscountPeriod', () => {
  it('advances from the stored Polar boundary instead of the calendar month', () => {
    const next = nextIncludedDiscountPeriod({
      now: new Date('2026-08-20T12:00:00Z'),
      periodStartedAt: new Date('2026-07-15T00:00:00Z'),
      periodEndsAt: new Date('2026-08-15T00:00:00Z'),
    });
    expect(next).toEqual({
      periodStartedAt: new Date('2026-08-15T00:00:00Z'),
      periodEndsAt: new Date('2026-09-15T00:00:00Z'),
    });
  });

  it('does not reset while the stored Polar window is still open', () => {
    expect(
      nextIncludedDiscountPeriod({
        now: new Date('2026-08-10T12:00:00Z'),
        periodStartedAt: new Date('2026-07-15T00:00:00Z'),
        periodEndsAt: new Date('2026-08-15T00:00:00Z'),
      }),
    ).toBeNull();
  });
});

describe('settlement period attribution', () => {
  it('splits Recall minutes across UTC months from the start timestamp', () => {
    expect(
      splitDurationNativeUnitsByUtcMonth({
        startedAt: new Date('2026-08-31T23:00:00Z'),
        nativeUnits: 120,
        unitMs: 60_000,
      }),
    ).toEqual([
      { periodYm: '2026-08', nativeUnits: 60 },
      { periodYm: '2026-09', nativeUnits: 60 },
    ]);
    expect(
      settlementSegmentsForMeter({
        meterId: 'recall_minutes',
        nativeUnits: 120,
        startedAt: new Date('2026-08-31T23:00:00Z'),
      }),
    ).toEqual([
      { periodYm: '2026-08', nativeUnits: 60 },
      { periodYm: '2026-09', nativeUnits: 60 },
    ]);
  });

  it('keeps AI and other non-duration meters in the start period', () => {
    expect(
      settlementSegmentsForMeter({
        meterId: 'ai',
        nativeUnits: 80,
        startedAt: new Date('2026-08-31T23:00:00Z'),
      }),
    ).toEqual([{ periodYm: '2026-08', nativeUnits: 80 }]);
  });
});

describe('costBearingPausedFromAccount', () => {
  const freeRemaining = {
    aiChargeCents: 500,
    recallMinutes: 60,
    emailUnits: 500,
    storageGb: 1,
    acceptedSources: 1_000,
  };

  it('does not pause Free when only one meter is exhausted', () => {
    expect(
      costBearingPausedFromAccount({
        planId: 'free',
        billingState: 'free',
        shadowBilling: true,
        spendCapCents: 0,
        meteredSpendCents: 50,
        freeRemaining: { ...freeRemaining, acceptedSources: 0 },
      }),
    ).toBe(false);
    expect(allFreeAllowancesExhausted({ ...freeRemaining, acceptedSources: 0 })).toBe(false);
  });

  it('does not pause PAYG while the Free floor or spend cap remains', () => {
    expect(
      costBearingPausedFromAccount({
        planId: 'payg',
        billingState: 'payg_active',
        shadowBilling: false,
        spendCapCents: 2500,
        meteredSpendCents: 10,
        freeRemaining,
      }),
    ).toBe(false);
    const exhausted = {
      aiChargeCents: 0,
      recallMinutes: 0,
      emailUnits: 0,
      storageGb: 0,
      acceptedSources: 0,
    };
    expect(
      costBearingPausedFromAccount({
        planId: 'payg',
        billingState: 'payg_active',
        shadowBilling: false,
        spendCapCents: 2500,
        meteredSpendCents: 10,
        freeRemaining: exhausted,
      }),
    ).toBe(false);
    expect(
      costBearingPausedFromAccount({
        planId: 'payg',
        billingState: 'past_due',
        shadowBilling: false,
        spendCapCents: 2500,
        meteredSpendCents: 10,
        freeRemaining: exhausted,
      }),
    ).toBe(true);
  });

  it('treats a paid spend cap of 0 as a hard stop', () => {
    expect(
      costBearingPausedFromAccount({
        planId: 'team',
        billingState: 'team_active',
        shadowBilling: false,
        spendCapCents: 0,
        meteredSpendCents: 0,
        freeRemaining,
      }),
    ).toBe(true);
  });
});

describe('shortfall freeze recovery', () => {
  it('restores the plan-specific active state after a wallet or cap recovery', () => {
    expect(
      restoredPaidBillingStateAfterWalletOrCapRecovery({
        planId: 'team',
        billingState: 'read_only',
      }),
    ).toBe('team_active');
    expect(
      restoredPaidBillingStateAfterWalletOrCapRecovery({
        planId: 'payg',
        billingState: 'balance_exhausted',
      }),
    ).toBe('payg_active');
    expect(
      restoredPaidBillingStateAfterWalletOrCapRecovery({
        planId: 'team',
        billingState: 'past_due',
      }),
    ).toBeNull();
    expect(
      restoredPaidBillingStateAfterWalletOrCapRecovery({
        planId: 'free',
        billingState: 'read_only',
      }),
    ).toBeNull();
  });

  it('restores a positive catalog spend cap after a shortfall freeze', () => {
    expect(restoredSpendCapCentsAfterShortfallUnfreeze({ planId: 'payg', spendCapCents: 0 })).toBe(
      2_500,
    );
    expect(
      restoredSpendCapCentsAfterShortfallUnfreeze({ planId: 'payg', spendCapCents: 1_000 }),
    ).toBeNull();
    expect(
      restoredSpendCapCentsAfterShortfallUnfreeze({ planId: 'enterprise', spendCapCents: 0 }),
    ).toBeNull();
  });
});
