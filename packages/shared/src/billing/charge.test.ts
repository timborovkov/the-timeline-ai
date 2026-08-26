import { describe, expect, it } from 'vitest';

import {
  cumulativeChargeDeltaCents,
  memberDaysChargeCents,
  nextIncludedDiscountPeriod,
  paygOverageCustomerChargeCents,
  shouldIngestPolarMeteredUsage,
  splitDiscountAndWallet,
} from '#src/billing/charge.js';
import { allFreeAllowancesExhausted, costBearingPausedFromAccount } from '#src/billing/status.js';

describe('billing charge split', () => {
  it('covers Team/Business included discount before the wallet', () => {
    expect(splitDiscountAndWallet({ chargeCents: 80, includedDiscountRemainingCents: 60 })).toEqual(
      { discountCents: 60, walletCents: 20 },
    );
    expect(splitDiscountAndWallet({ chargeCents: 40, includedDiscountRemainingCents: 60 })).toEqual(
      { discountCents: 40, walletCents: 0 },
    );
  });

  it('keeps the PAYG Free floor off the wallet', () => {
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
  it('skips Polar ingest when the prepaid wallet or included discount collected', () => {
    expect(
      shouldIngestPolarMeteredUsage({
        eventName: 'timeline_recall_minutes',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        billable: true,
        polarUnits: 10,
        walletCents: 30,
        discountCents: 0,
      }),
    ).toBe(false);
    expect(
      shouldIngestPolarMeteredUsage({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        billable: true,
        polarUnits: 80,
        walletCents: 0,
        discountCents: 80,
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
        walletBalanceCents: 0,
        reservedBalanceCents: 0,
        includedDiscountRemainingCents: 0,
        freeRemaining: { ...freeRemaining, acceptedSources: 0 },
      }),
    ).toBe(false);
    expect(allFreeAllowancesExhausted({ ...freeRemaining, acceptedSources: 0 })).toBe(false);
  });

  it('pauses PAYG only when wallet, discount, and Free floor are gone', () => {
    expect(
      costBearingPausedFromAccount({
        planId: 'payg',
        billingState: 'payg_active',
        shadowBilling: false,
        spendCapCents: 2500,
        meteredSpendCents: 10,
        walletBalanceCents: 0,
        reservedBalanceCents: 0,
        includedDiscountRemainingCents: 0,
        freeRemaining,
      }),
    ).toBe(false);
  });
});
