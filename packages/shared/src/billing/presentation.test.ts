import { describe, expect, it } from 'bun:test';

import {
  buildBillingPresentation,
  recordedChargesForPeriod,
  type PresentationSettlement,
} from '#src/billing/presentation.js';
import {
  applyBillingPresentationToSidebar,
  deriveSidebarBillingSummary,
  freeAllowanceRemaining,
} from '#src/billing/status.js';

const now = new Date('2026-10-20T12:00:00Z');
const period = { start: '2026-10-15T00:00:00.000Z', end: '2026-11-15T00:00:00.000Z' };
const account = {
  planId: 'team' as const,
  billingState: 'team_active',
  arrangement: 'standard' as const,
  includedDiscountRemainingCents: 4500,
  periodStartedAt: new Date(period.start),
  periodEndsAt: new Date(period.end),
  spendCapCents: 10000,
};
function row(overrides: Partial<PresentationSettlement> = {}): PresentationSettlement {
  return {
    operationId: 'synthetic',
    meterId: 'ai',
    nativeUnits: '2000',
    occurredAt: now,
    billable: true,
    metadata: { usage_at: now.toISOString(), discount_cents: 1500, invoice_cents: 500 },
    ...overrides,
  };
}
function summary(overrides: Partial<Parameters<typeof buildBillingPresentation>[0]> = {}) {
  return buildBillingPresentation({
    account,
    meters: {},
    meteredSpendCents: 2100,
    activeMembers: 12,
    settlements: [
      row(),
      row({
        meterId: 'member_days',
        metadata: { usage_at: now.toISOString(), discount_cents: 0, invoice_cents: 100 },
      }),
    ],
    now,
    ...overrides,
  });
}

describe('billing presentation', () => {
  it('separates calendar cap from subscription credit and recorded charges', () => {
    const result = summary();
    expect(result.credit).toMatchObject({
      status: 'available',
      totalCents: 6000,
      usedCents: 1500,
      remainingCents: 4500,
      period,
    });
    expect(result.calendarPeriod.start).toBe('2026-10-01T00:00:00.000Z');
    expect(result.charges.amounts).toEqual({
      usageCents: 2000,
      creditAppliedCents: 1500,
      usageAfterCreditCents: 500,
      extraMemberCents: 100,
      totalCents: 600,
    });
    expect(result.recurringFeeCents).toBe(4900);
    expect(result.cap.usedCents).toBe(2100);
    expect(result.allowances).toEqual([]);
  });
  it('reads configured Business credit and an overridden fee', () => {
    const result = summary({
      account: {
        ...account,
        planId: 'business',
        includedDiscountRemainingCents: 25000,
        priceOverride: { platformFeeCents: 12345 },
      },
    });
    expect(result.credit).toMatchObject({ totalCents: 25000, usedCents: 0, remainingCents: 25000 });
    expect(result.recurringFeeCents).toBe(12345);
  });
  it('keeps Free/PAYG allowances separate, including zero and exhausted meters', () => {
    for (const planId of ['free', 'payg'] as const) {
      const result = summary({
        account: { ...account, planId, includedDiscountRemainingCents: 0 },
        meters: { ai: { nativeUnits: 500 }, recall_minutes: { nativeUnits: 20 } },
        settlements: [],
      });
      expect(result.allowances).toHaveLength(5);
      expect(result.allowances.find((x) => x.meter === 'ai')).toMatchObject({
        included: 500,
        used: 500,
        remaining: 0,
      });
      expect(result.allowances.find((x) => x.meter === 'recall_minutes')?.remaining).toBe(40);
      expect(result.allowances.find((x) => x.meter === 'email_units')?.remaining).toBe(500);
      expect(result.credit.status).toBe('not_applicable');
      expect(result.charges.amounts?.totalCents).toBe(0);
    }
  });
  it('marks missing and elapsed periods as updating without resetting balances', () => {
    for (const periodEndsAt of [null, new Date('2026-10-19')]) {
      const a = { ...account, periodEndsAt };
      const result = summary({ account: a });
      expect(result.credit.status).toBe('updating');
      expect(result.credit.remainingCents).toBeNull();
      expect(result.charges.status).toBe('updating');
      expect(a.includedDiscountRemainingCents).toBe(4500);
    }
  });
  it('shows no payable charges for comps and unknown Enterprise fees as custom', () => {
    const comp = summary({
      account: { ...account, arrangement: 'comped' },
      settlements: [row({ metadata: { presentation_comped: true } })],
    });
    expect(comp.charges.amounts?.totalCents).toBe(0);
    expect(comp.recurringFeeCents).toBe(0);
    const enterprise = summary({ account: { ...account, planId: 'enterprise' } });
    expect(enterprise.recurringFeeCents).toBeNull();
  });
  it('attributes delayed settlements by usage instant without repricing them', () => {
    expect(
      recordedChargesForPeriod(
        [
          row({
            metadata: { usage_at: '2026-10-14T12:00:00Z', discount_cents: 0, invoice_cents: 9999 },
          }),
          row(),
        ],
        period,
      )?.totalCents,
    ).toBe(500);
  });
  it('uses explicit renewal splits and refuses ambiguous legacy splits', () => {
    const windows = [
      {
        started_at: '2026-09-15T00:00:00Z',
        ends_at: period.start,
        discount_cents: 20,
        invoice_cents: 10,
      },
      { started_at: period.start, ends_at: period.end, discount_cents: 30, invoice_cents: 40 },
    ];
    expect(
      recordedChargesForPeriod(
        [row({ meterId: 'recall_minutes', metadata: { discount_windows: windows } })],
        period,
      )?.totalCents,
    ).toBe(40);
    expect(
      recordedChargesForPeriod(
        [
          row({
            meterId: 'recall_minutes',
            metadata: { discount_windows: [{ ...windows[1], invoice_cents: undefined }] },
          }),
        ],
        period,
      ),
    ).toBeNull();
    expect(
      recordedChargesForPeriod(
        [
          row({
            meterId: 'recall_minutes',
            nativeUnits: '120',
            metadata: { usage_at: '2026-10-14T23:00:00Z', discount_cents: 0, invoice_cents: 100 },
          }),
        ],
        period,
      ),
    ).toBeNull();
  });
  it('does not invent zero for missing charge metadata or charge nonbillable work', () => {
    expect(recordedChargesForPeriod([row({ metadata: {} })], period)).toBeNull();
    expect(
      recordedChargesForPeriod(
        [row({ billable: false }), row({ metadata: { presentation_comped: true } })],
        period,
      )?.totalCents,
    ).toBe(0);
  });
  it('uses the same credit balance in the sidebar, separately from the cap', () => {
    const sidebar = deriveSidebarBillingSummary({
      planId: 'team',
      canManageBilling: true,
      meteredSpendCents: 2100,
      spendCapCents: 10000,
      includedDiscountRemainingCents: 4500,
      freeRemaining: freeAllowanceRemaining({}),
    });
    applyBillingPresentationToSidebar(sidebar, summary());
    expect(sidebar.detailLabel).toBe('€45 credit remaining');
    expect(sidebar.secondaryLabel).toBe('€21 of €100 monthly cap');
    expect(sidebar.progressPercent).toBe(25);
  });
});

it('preserves recorded paid charges after moving to Free or a comp', () => {
  const paid = row();
  for (const next of [{ planId: 'free' as const }, { arrangement: 'comped' as const }]) {
    const result = summary({ account: { ...account, ...next }, settlements: [paid] });
    expect(result.charges.amounts?.totalCents).toBe(500);
  }
});

it('marks incomplete recorded history unavailable instead of contradicting consumed credit', () => {
  const result = summary({ settlements: [] });
  expect(result.credit.remainingCents).toBe(4500);
  expect(result.charges.status).toBe('unavailable');
  expect(result.charges.amounts).toBeNull();
});

it('labels Free remaining allowances and keeps cap warnings separate from credit', () => {
  const free = summary({
    account: { ...account, planId: 'free', includedDiscountRemainingCents: 0 },
    settlements: [],
  });
  const base = deriveSidebarBillingSummary({
    planId: 'free',
    canManageBilling: true,
    meteredSpendCents: 0,
    spendCapCents: 0,
    includedDiscountRemainingCents: 0,
    freeRemaining: freeAllowanceRemaining({}),
  });
  applyBillingPresentationToSidebar(base, free);
  expect(base.detailLabel).toBe('0% of most-used allowance');
  expect(base.href).toBe('/app/usage');
  const capped = summary({ account: { ...account, spendCapCents: 0 } });
  applyBillingPresentationToSidebar(base, capped);
  expect(base.detailLabel).toBe('€45 credit remaining');
  expect(base.warningLabel).toBe('Spend cap reached');
  expect(base.resetLabel).toContain('Credit renews 15 Nov');
});
