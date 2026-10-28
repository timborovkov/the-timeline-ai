import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  capEligibleCustomerChargeCents,
  cumulativeChargeDeltaCents,
  currentPeriodSpendCapExceeded,
  memberDayChargeDelta,
  memberDaysChargeCents,
  includedDiscountWindowContaining,
  nextIncludedDiscountPeriod,
  paygOverageCustomerChargeCents,
  metersPlusPendingReservations,
  pendingCapEligibleChargeCents,
  pendingCapEligibleChargeCentsInPeriod,
  pendingDiscountReservedCentsInWindow,
  pendingNativeUnitsInPeriod,
  polarCatalogUnitsForInvoiceCents,
  polarInvoiceNativeUnits,
  polarIngestDisposition,
  polarIngestDispositionBeforeCoverage,
  polarMemberMonthUnits,
  polarSubscriptionCoversMeter,
  settlementSegmentsForMeter,
  shouldIngestPolarMeteredUsage,
  splitDiscountAndWallet,
  splitDurationNativeUnitsByUtcMonth,
} from '#src/billing/charge.js';
import { applyMeteredDiscountCents } from '#src/billing/operator.js';
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

  it('rounds PAYG AI overage from cumulative post-allowance totals', () => {
    const nearFloor = paygOverageCustomerChargeCents({
      planId: 'payg',
      meterId: 'ai',
      nativeUnits: 0.2,
      listChargeCents: 1,
      meters: { ai: { nativeUnits: 499.4, customerChargeCents: 0 } },
    });
    expect(nearFloor).toBe(0);
    expect(Number.isInteger(nearFloor)).toBe(true);

    const crossed = paygOverageCustomerChargeCents({
      planId: 'payg',
      meterId: 'ai',
      nativeUnits: 1.2,
      listChargeCents: 2,
      meters: { ai: { nativeUnits: 499.4, customerChargeCents: 0 } },
    });
    expect(crossed).toBe(1);
    expect(Number.isInteger(crossed)).toBe(true);
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

describe('polar catalog units and cumulative discounts', () => {
  it('turns one invoiced cent into the fractional units that price it', () => {
    expect(polarCatalogUnitsForInvoiceCents('email_units', 1)).toBe(4);
    expect(polarCatalogUnitsForInvoiceCents('accepted_sources', 1)).toBe(20);
    expect(polarCatalogUnitsForInvoiceCents('ai', 40)).toBe(40);
    expect(polarCatalogUnitsForInvoiceCents('email_units', 0)).toBe(0);
  });

  it('keeps a 50% discount when each settlement is only one cent', () => {
    let charged = 0;
    for (let next = 1; next <= 100; next += 1) {
      charged += Math.max(
        0,
        applyMeteredDiscountCents(next, 50) - applyMeteredDiscountCents(next - 1, 50),
      );
    }
    expect(charged).toBe(50);
    expect(applyMeteredDiscountCents(1, 50)).toBe(1);
  });
});

describe('polar subscription price guard', () => {
  const products = {
    payg: 'prod_payg',
    team: 'prod_team',
    business: 'prod_business',
    enterprise: 'prod_enterprise',
  };
  const pricedEventNames = [
    'timeline_ai_eur_cents',
    'timeline_recall_minutes',
    'timeline_email_units',
    'timeline_storage_gb_month',
    'timeline_accepted_sources',
    'timeline_extra_member_days',
  ];

  it('ingests only when the active subscription product prices the meter', () => {
    expect(
      polarSubscriptionCoversMeter({
        planId: 'team',
        billingState: 'team_active',
        polarSubscriptionId: 'sub_team',
        polarProductId: 'prod_team',
        eventName: 'timeline_ai_eur_cents',
        products,
        pricedEventNames,
      }),
    ).toBe(true);
    expect(
      polarSubscriptionCoversMeter({
        planId: 'team',
        billingState: 'past_due',
        polarSubscriptionId: 'sub_team',
        polarProductId: 'prod_team',
        eventName: 'timeline_extra_member_days',
        products,
        pricedEventNames,
      }),
    ).toBe(true);
    expect(
      polarSubscriptionCoversMeter({
        planId: 'enterprise',
        billingState: 'enterprise_active',
        polarSubscriptionId: 'sub_ent',
        polarProductId: 'prod_enterprise',
        eventName: 'timeline_recall_minutes',
        products,
        pricedEventNames,
      }),
    ).toBe(true);
    expect(
      polarSubscriptionCoversMeter({
        planId: 'enterprise',
        billingState: 'read_only',
        polarSubscriptionId: 'sub_ent',
        polarProductId: 'prod_enterprise',
        eventName: 'timeline_extra_member_days',
        products,
        pricedEventNames,
      }),
    ).toBe(true);
  });

  it('does not treat a matching product id as a priced meter', () => {
    expect(
      polarSubscriptionCoversMeter({
        planId: 'team',
        billingState: 'team_active',
        polarSubscriptionId: 'sub_team',
        polarProductId: 'prod_team',
        eventName: 'timeline_ai_eur_cents',
        products,
        pricedEventNames: ['timeline_extra_member_days'],
      }),
    ).toBe(false);
    expect(
      polarSubscriptionCoversMeter({
        planId: 'team',
        billingState: 'team_active',
        polarSubscriptionId: 'sub_team',
        polarProductId: 'prod_team',
        eventName: 'timeline_ai_eur_cents',
        products,
        pricedEventNames: null,
      }),
    ).toBe(false);
  });

  it('holds a payable charge when the subscription price does not match', () => {
    const uncovered = [
      { planId: 'free', billingState: 'free', productId: null, subscriptionId: null },
      {
        planId: 'team',
        billingState: 'team_active',
        productId: 'prod_payg',
        subscriptionId: 'sub',
      },
      { planId: 'team', billingState: 'canceled', productId: 'prod_team', subscriptionId: 'sub' },
      {
        planId: 'enterprise',
        billingState: 'enterprise_active',
        productId: null,
        subscriptionId: null,
      },
      {
        planId: 'enterprise',
        billingState: 'enterprise_active',
        productId: 'prod_enterprise',
        subscriptionId: 'sub',
        products: {
          payg: 'prod_payg',
          team: 'prod_team',
          business: 'prod_business',
        },
      },
    ] as const;
    for (const row of uncovered) {
      const covers = polarSubscriptionCoversMeter({
        planId: row.planId,
        billingState: row.billingState,
        polarSubscriptionId: row.subscriptionId,
        polarProductId: row.productId,
        eventName: 'timeline_ai_eur_cents',
        products: 'products' in row ? row.products : products,
        pricedEventNames,
      });
      expect(covers, row.planId).toBe(false);
      expect(
        polarIngestDisposition({
          eventName: 'timeline_ai_eur_cents',
          polarCustomerId: 'cus_1',
          shadowBilling: false,
          comped: false,
          billable: true,
          polarUnits: 10,
          invoiceCents: 10,
          subscriptionCoversMeter: covers,
        }),
      ).toBe('hold');
    }
    expect(
      polarIngestDisposition({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: null,
        shadowBilling: false,
        comped: false,
        billable: true,
        polarUnits: 10,
        invoiceCents: 10,
        subscriptionCoversMeter: true,
      }),
    ).toBe('hold');
  });

  it('does not alert shadow, comps, or sub-cent rounds', () => {
    expect(
      polarIngestDisposition({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: null,
        shadowBilling: true,
        comped: false,
        billable: true,
        polarUnits: 10,
        invoiceCents: 10,
        subscriptionCoversMeter: false,
      }),
    ).toBe('not_required');
    expect(
      polarIngestDisposition({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        comped: true,
        billable: true,
        polarUnits: 10,
        invoiceCents: 10,
        subscriptionCoversMeter: false,
      }),
    ).toBe('not_required');
    expect(
      polarIngestDisposition({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        comped: false,
        billable: true,
        polarUnits: 1,
        invoiceCents: 0,
        subscriptionCoversMeter: true,
      }),
    ).toBe('not_required');
    expect(
      polarIngestDispositionBeforeCoverage({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        comped: false,
        billable: true,
        polarUnits: 1,
        invoiceCents: 0,
      }),
    ).toBe('not_required');
    expect(
      polarIngestDispositionBeforeCoverage({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        comped: true,
        billable: true,
        polarUnits: 10,
        invoiceCents: 10,
      }),
    ).toBe('not_required');
    expect(
      polarIngestDispositionBeforeCoverage({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: null,
        shadowBilling: false,
        comped: false,
        billable: true,
        polarUnits: 10,
        invoiceCents: 10,
      }),
    ).toBe('hold');
    expect(
      polarIngestDispositionBeforeCoverage({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        comped: false,
        billable: true,
        polarUnits: 10,
        invoiceCents: 10,
      }),
    ).toBeNull();
    expect(
      polarIngestDisposition({
        eventName: 'timeline_ai_eur_cents',
        polarCustomerId: 'cus_1',
        shadowBilling: false,
        comped: false,
        billable: true,
        polarUnits: 10,
        invoiceCents: 10,
        subscriptionCoversMeter: true,
      }),
    ).toBe('ingest');
  });
});

describe('includedDiscountWindowContaining', () => {
  it('places a usage day in the renewal window that contains it', () => {
    const bounds = {
      periodStartedAt: new Date('2026-09-15T00:00:00.000Z'),
      periodEndsAt: new Date('2026-10-15T00:00:00.000Z'),
    };
    expect(
      includedDiscountWindowContaining({
        ...bounds,
        usageAt: new Date('2026-10-02T12:00:00.000Z'),
      }),
    ).toEqual({
      startedAt: new Date('2026-09-15T00:00:00.000Z'),
      endsAt: new Date('2026-10-15T00:00:00.000Z'),
    });
    expect(
      includedDiscountWindowContaining({
        ...bounds,
        usageAt: new Date('2026-10-20T12:00:00.000Z'),
      }),
    ).toEqual({
      startedAt: new Date('2026-10-15T00:00:00.000Z'),
      endsAt: new Date('2026-11-15T00:00:00.000Z'),
    });
  });

  it('keeps the February anchor when the usage day is in the next month', () => {
    expect(
      includedDiscountWindowContaining({
        usageAt: new Date('2026-03-01T12:00:00.000Z'),
        periodStartedAt: new Date('2026-02-15T00:00:00.000Z'),
        periodEndsAt: new Date('2026-03-15T00:00:00.000Z'),
      }),
    ).toEqual({
      startedAt: new Date('2026-02-15T00:00:00.000Z'),
      endsAt: new Date('2026-03-15T00:00:00.000Z'),
    });
  });

  it('keeps a clamped stored window and restores 31st, 30th, and 29th anchors', () => {
    const periodStartedAt = new Date('2026-02-28T05:06:07.008Z');
    const periodEndsAt = new Date('2026-03-31T05:06:07.008Z');
    expect(
      includedDiscountWindowContaining({
        usageAt: new Date('2026-03-29T12:00:00.000Z'),
        periodStartedAt,
        periodEndsAt,
      }),
    ).toEqual({ startedAt: periodStartedAt, endsAt: periodEndsAt });
    expect(
      includedDiscountWindowContaining({
        usageAt: new Date('2026-04-15T12:00:00.000Z'),
        periodStartedAt,
        periodEndsAt,
      }),
    ).toEqual({
      startedAt: new Date('2026-03-31T05:06:07.008Z'),
      endsAt: new Date('2026-04-30T05:06:07.008Z'),
    });
    expect(
      includedDiscountWindowContaining({
        usageAt: new Date('2026-01-31T12:00:00.000Z'),
        periodStartedAt,
        periodEndsAt,
      }),
    ).toEqual({
      startedAt: new Date('2026-01-31T05:06:07.008Z'),
      endsAt: new Date('2026-02-28T05:06:07.008Z'),
    });

    const cases = [
      {
        usageAt: '2024-03-15T12:00:00.000Z',
        periodStartedAt: '2024-01-31T00:00:00.000Z',
        periodEndsAt: '2024-02-29T00:00:00.000Z',
        startedAt: '2024-02-29T00:00:00.000Z',
        endsAt: '2024-03-31T00:00:00.000Z',
      },
      {
        usageAt: '2025-03-15T12:00:00.000Z',
        periodStartedAt: '2025-01-31T00:00:00.000Z',
        periodEndsAt: '2025-02-28T00:00:00.000Z',
        startedAt: '2025-02-28T00:00:00.000Z',
        endsAt: '2025-03-31T00:00:00.000Z',
      },
      {
        usageAt: '2024-03-15T12:00:00.000Z',
        periodStartedAt: '2024-01-30T00:00:00.000Z',
        periodEndsAt: '2024-02-29T00:00:00.000Z',
        startedAt: '2024-02-29T00:00:00.000Z',
        endsAt: '2024-03-30T00:00:00.000Z',
      },
      {
        usageAt: '2025-03-15T12:00:00.000Z',
        periodStartedAt: '2025-01-30T00:00:00.000Z',
        periodEndsAt: '2025-02-28T00:00:00.000Z',
        startedAt: '2025-02-28T00:00:00.000Z',
        endsAt: '2025-03-30T00:00:00.000Z',
      },
      {
        usageAt: '2024-03-15T12:00:00.000Z',
        periodStartedAt: '2024-01-29T00:00:00.000Z',
        periodEndsAt: '2024-02-29T00:00:00.000Z',
        startedAt: '2024-02-29T00:00:00.000Z',
        endsAt: '2024-03-29T00:00:00.000Z',
      },
      {
        usageAt: '2025-02-15T12:00:00.000Z',
        periodStartedAt: '2025-01-29T00:00:00.000Z',
        periodEndsAt: '2025-02-28T00:00:00.000Z',
        startedAt: '2025-01-29T00:00:00.000Z',
        endsAt: '2025-02-28T00:00:00.000Z',
      },
      {
        usageAt: '2025-03-15T12:00:00.000Z',
        periodStartedAt: '2025-01-29T00:00:00.000Z',
        periodEndsAt: '2025-02-28T00:00:00.000Z',
        startedAt: '2025-02-28T00:00:00.000Z',
        endsAt: '2025-03-29T00:00:00.000Z',
      },
      {
        usageAt: '2026-05-15T12:00:00.000Z',
        periodStartedAt: '2026-03-31T00:00:00.000Z',
        periodEndsAt: '2026-04-30T00:00:00.000Z',
        startedAt: '2026-04-30T00:00:00.000Z',
        endsAt: '2026-05-31T00:00:00.000Z',
      },
      {
        usageAt: '2026-07-15T12:00:00.000Z',
        periodStartedAt: '2026-05-31T00:00:00.000Z',
        periodEndsAt: '2026-06-30T00:00:00.000Z',
        startedAt: '2026-06-30T00:00:00.000Z',
        endsAt: '2026-07-31T00:00:00.000Z',
      },
      {
        usageAt: '2026-04-15T12:00:00.000Z',
        periodStartedAt: '2026-03-30T00:00:00.000Z',
        periodEndsAt: '2026-04-30T00:00:00.000Z',
        startedAt: '2026-03-30T00:00:00.000Z',
        endsAt: '2026-04-30T00:00:00.000Z',
      },
      {
        usageAt: '2026-04-15T12:00:00.000Z',
        periodStartedAt: '2026-03-29T00:00:00.000Z',
        periodEndsAt: '2026-04-29T00:00:00.000Z',
        startedAt: '2026-03-29T00:00:00.000Z',
        endsAt: '2026-04-29T00:00:00.000Z',
      },
      {
        usageAt: '2024-02-15T12:00:00.000Z',
        periodStartedAt: '2025-03-31T00:00:00.000Z',
        periodEndsAt: '2025-04-30T00:00:00.000Z',
        startedAt: '2024-01-31T00:00:00.000Z',
        endsAt: '2024-02-29T00:00:00.000Z',
      },
    ];
    for (const row of cases) {
      expect(
        includedDiscountWindowContaining({
          usageAt: new Date(row.usageAt),
          periodStartedAt: new Date(row.periodStartedAt),
          periodEndsAt: new Date(row.periodEndsAt),
        }),
      ).toEqual({
        startedAt: new Date(row.startedAt),
        endsAt: new Date(row.endsAt),
      });
    }
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

  it('keeps the anchor day when the closed month is shorter than the next one', () => {
    const next = nextIncludedDiscountPeriod({
      now: new Date('2026-03-20T12:00:00Z'),
      periodStartedAt: new Date('2026-02-15T00:00:00Z'),
      periodEndsAt: new Date('2026-03-15T00:00:00Z'),
    });
    expect(next).toEqual({
      periodStartedAt: new Date('2026-03-15T00:00:00.000Z'),
      periodEndsAt: new Date('2026-04-15T00:00:00.000Z'),
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

  it('carries 31st, 30th, and 29th anchors across February and other short months', () => {
    const periodStartedAt = new Date('2026-02-28T05:06:07.008Z');
    const periodEndsAt = new Date('2026-03-31T05:06:07.008Z');
    expect(
      nextIncludedDiscountPeriod({
        now: new Date('2026-03-29T12:00:00.000Z'),
        periodStartedAt,
        periodEndsAt,
      }),
    ).toBeNull();
    expect(
      nextIncludedDiscountPeriod({
        now: new Date('2026-04-01T00:00:00.000Z'),
        periodStartedAt,
        periodEndsAt,
      }),
    ).toEqual({
      periodStartedAt: periodEndsAt,
      periodEndsAt: new Date('2026-04-30T05:06:07.008Z'),
    });
    expect(
      nextIncludedDiscountPeriod({
        now: new Date('2026-05-01T00:00:00.000Z'),
        periodStartedAt,
        periodEndsAt,
      }),
    ).toEqual({
      periodStartedAt: new Date('2026-04-30T05:06:07.008Z'),
      periodEndsAt: new Date('2026-05-31T05:06:07.008Z'),
    });

    const cases = [
      {
        now: '2024-03-01T00:00:00.000Z',
        periodStartedAt: '2024-01-31T00:00:00.000Z',
        periodEndsAt: '2024-02-29T00:00:00.000Z',
        nextStartedAt: '2024-02-29T00:00:00.000Z',
        nextEndsAt: '2024-03-31T00:00:00.000Z',
      },
      {
        now: '2025-03-01T00:00:00.000Z',
        periodStartedAt: '2025-01-31T00:00:00.000Z',
        periodEndsAt: '2025-02-28T00:00:00.000Z',
        nextStartedAt: '2025-02-28T00:00:00.000Z',
        nextEndsAt: '2025-03-31T00:00:00.000Z',
      },
      {
        now: '2024-03-01T00:00:00.000Z',
        periodStartedAt: '2024-01-30T00:00:00.000Z',
        periodEndsAt: '2024-02-29T00:00:00.000Z',
        nextStartedAt: '2024-02-29T00:00:00.000Z',
        nextEndsAt: '2024-03-30T00:00:00.000Z',
      },
      {
        now: '2025-03-01T00:00:00.000Z',
        periodStartedAt: '2025-01-30T00:00:00.000Z',
        periodEndsAt: '2025-02-28T00:00:00.000Z',
        nextStartedAt: '2025-02-28T00:00:00.000Z',
        nextEndsAt: '2025-03-30T00:00:00.000Z',
      },
      {
        now: '2024-03-01T00:00:00.000Z',
        periodStartedAt: '2024-01-29T00:00:00.000Z',
        periodEndsAt: '2024-02-29T00:00:00.000Z',
        nextStartedAt: '2024-02-29T00:00:00.000Z',
        nextEndsAt: '2024-03-29T00:00:00.000Z',
      },
      {
        now: '2025-03-01T00:00:00.000Z',
        periodStartedAt: '2025-01-29T00:00:00.000Z',
        periodEndsAt: '2025-02-28T00:00:00.000Z',
        nextStartedAt: '2025-02-28T00:00:00.000Z',
        nextEndsAt: '2025-03-29T00:00:00.000Z',
      },
      {
        now: '2026-05-01T00:00:00.000Z',
        periodStartedAt: '2026-03-31T00:00:00.000Z',
        periodEndsAt: '2026-04-30T00:00:00.000Z',
        nextStartedAt: '2026-04-30T00:00:00.000Z',
        nextEndsAt: '2026-05-31T00:00:00.000Z',
      },
      {
        now: '2026-07-01T00:00:00.000Z',
        periodStartedAt: '2026-05-31T00:00:00.000Z',
        periodEndsAt: '2026-06-30T00:00:00.000Z',
        nextStartedAt: '2026-06-30T00:00:00.000Z',
        nextEndsAt: '2026-07-31T00:00:00.000Z',
      },
      {
        now: '2025-04-15T00:00:00.000Z',
        periodStartedAt: '2024-01-31T00:00:00.000Z',
        periodEndsAt: '2024-02-29T00:00:00.000Z',
        nextStartedAt: '2025-03-31T00:00:00.000Z',
        nextEndsAt: '2025-04-30T00:00:00.000Z',
      },
    ];
    for (const row of cases) {
      expect(
        nextIncludedDiscountPeriod({
          now: new Date(row.now),
          periodStartedAt: new Date(row.periodStartedAt),
          periodEndsAt: new Date(row.periodEndsAt),
        }),
      ).toEqual({
        periodStartedAt: new Date(row.nextStartedAt),
        periodEndsAt: new Date(row.nextEndsAt),
      });
    }
  });
});

describe('current-period spend cap', () => {
  const september = [{ periodYm: '2026-09', chargeCents: 2_000 }];
  const octoberCounters = [{ periodYm: '2026-10', chargeCents: 900 }];

  it('ignores a prior month even when that month is already over the live cap', () => {
    expect(
      currentPeriodSpendCapExceeded({
        currentPeriodYm: '2026-10',
        spendCapCents: 1_000,
        segments: [{ periodYm: '2026-09', chargeCents: 25 }],
        counterChargeCents: september,
      }),
    ).toBe(false);
  });

  it('freezes only the current-period slice of a span', () => {
    expect(
      currentPeriodSpendCapExceeded({
        currentPeriodYm: '2026-10',
        spendCapCents: 1_000,
        segments: [
          { periodYm: '2026-09', chargeCents: 2_000 },
          { periodYm: '2026-10', chargeCents: 50 },
        ],
        counterChargeCents: octoberCounters,
      }),
    ).toBe(false);
    expect(
      currentPeriodSpendCapExceeded({
        currentPeriodYm: '2026-10',
        spendCapCents: 1_000,
        segments: [
          { periodYm: '2026-09', chargeCents: 25 },
          { periodYm: '2026-10', chargeCents: 200 },
        ],
        counterChargeCents: octoberCounters,
      }),
    ).toBe(true);
  });

  it('does not re-check an already-over current period when this settlement adds nothing there', () => {
    expect(
      currentPeriodSpendCapExceeded({
        currentPeriodYm: '2026-10',
        spendCapCents: 1_000,
        segments: [{ periodYm: '2026-09', chargeCents: 25 }],
        counterChargeCents: [{ periodYm: '2026-10', chargeCents: 5_000 }],
      }),
    ).toBe(false);
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

describe('cap-eligible spend', () => {
  it('omits standard Free allowance use and keeps comps and paid charges', () => {
    expect(
      capEligibleCustomerChargeCents({
        entitlementsPlanId: 'free',
        comped: false,
        enterpriseContract: false,
        chargeCents: 500,
      }),
    ).toBe(0);
    expect(
      capEligibleCustomerChargeCents({
        entitlementsPlanId: 'free',
        comped: true,
        enterpriseContract: false,
        chargeCents: 500,
      }),
    ).toBe(500);
    expect(
      capEligibleCustomerChargeCents({
        entitlementsPlanId: 'payg',
        comped: false,
        enterpriseContract: false,
        chargeCents: 250,
      }),
    ).toBe(250);
  });

  it('reads an explicit in-flight cap amount and falls back to the metered charge', () => {
    expect(pendingCapEligibleChargeCents({ cap_eligible_reserved_cents: 0 }, 500)).toBe(0);
    expect(pendingCapEligibleChargeCents({ metered_charge_cents: 40 }, 0)).toBe(40);
  });

  it('attributes pending usage to its own month and splits Recall', () => {
    const septemberAi = {
      meterId: 'ai' as const,
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      reservedNativeUnits: 500,
      reservedChargeCents: 500,
      metadata: {
        list_charge_cents: 500,
        cap_eligible_reserved_cents: 500,
        discount_reserved_cents: 500,
      },
    };
    const spanningRecall = {
      meterId: 'recall_minutes' as const,
      createdAt: new Date('2026-09-30T23:30:00.000Z'),
      reservedNativeUnits: 60,
      reservedChargeCents: 180,
      metadata: {
        list_charge_cents: 180,
        cap_eligible_reserved_cents: 180,
        discount_reserved_cents: 60,
      },
    };
    expect(pendingNativeUnitsInPeriod(septemberAi, '2026-10')).toBe(0);
    expect(pendingNativeUnitsInPeriod(spanningRecall, '2026-09')).toBe(30);
    expect(pendingNativeUnitsInPeriod(spanningRecall, '2026-10')).toBe(30);
    expect(pendingCapEligibleChargeCentsInPeriod(septemberAi, '2026-10')).toBe(0);
    expect(pendingCapEligibleChargeCentsInPeriod(spanningRecall, '2026-10')).toBe(90);
    expect(
      pendingDiscountReservedCentsInWindow(septemberAi, new Date('2026-10-01T00:00:00.000Z')),
    ).toBe(0);
    expect(
      pendingDiscountReservedCentsInWindow(spanningRecall, new Date('2026-10-01T00:00:00.000Z')),
    ).toBe(30);
    expect(
      metersPlusPendingReservations({}, [septemberAi, spanningRecall], '2026-10').recall_minutes,
    ).toEqual({ nativeUnits: 30, customerChargeCents: 90 });
    expect(metersPlusPendingReservations({}, [septemberAi], '2026-10').ai).toBeUndefined();
  });
});
