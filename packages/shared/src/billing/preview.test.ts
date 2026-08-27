import { describe, expect, it } from 'vitest';

import { listChargeCentsForMeter } from '#src/billing/charge.js';
import { cheapestPlanPreview } from '#src/billing/preview.js';
import { freeAllowanceFloorCents } from '#src/billing/status.js';

describe('cheapestPlanPreview', () => {
  it('recommends PAYG for a small team with modest usage', () => {
    const preview = cheapestPlanPreview({ activeMembers: 5, meteredSpendCents: 1_500 });
    expect(preview.recommended).toBe('payg');
    expect(preview.bills.payg.totalCents).toBe(
      400 + Math.max(0, 1_500 - freeAllowanceFloorCents()),
    );
    expect(preview.bills.team.totalCents).toBe(4_900);
  });

  it('recommends Team when included members plus the €60 discount win', () => {
    const preview = cheapestPlanPreview({ activeMembers: 25, meteredSpendCents: 8_000 });
    expect(preview.recommended).toBe('team');
    expect(preview.bills.payg.extraMemberCents).toBe(4_400);
    expect(preview.bills.team.meteredAfterDiscountCents).toBe(2_000);
  });

  it('recommends Business when the €250 discount dominates', () => {
    const preview = cheapestPlanPreview({ activeMembers: 40, meteredSpendCents: 40_000 });
    expect(preview.recommended).toBe('business');
    expect(preview.bills.business.platformFeeCents).toBe(19_900);
    expect(preview.bills.business.meteredAfterDiscountCents).toBe(15_000);
  });

  it('does not double-count member-days when seats are priced separately', () => {
    const preview = cheapestPlanPreview({
      activeMembers: 5,
      meters: {
        ai: { nativeUnits: 0, customerChargeCents: 0 },
        member_days: { nativeUnits: 62, customerChargeCents: 400 },
      },
    });
    expect(preview.bills.payg.extraMemberCents).toBe(400);
    expect(preview.bills.payg.meteredAfterDiscountCents).toBe(0);
    expect(preview.bills.team.extraMemberCents).toBe(0);
    expect(preview.bills.team.meteredAfterDiscountCents).toBe(0);
  });

  it('prorates extra members from period member-days instead of a full month', () => {
    const preview = cheapestPlanPreview({
      activeMembers: 5,
      meters: {
        ai: { nativeUnits: 0, customerChargeCents: 0 },
        member_days: { nativeUnits: 3, customerChargeCents: 19 },
      },
    });
    expect(preview.bills.payg.extraMemberCents).toBe(listChargeCentsForMeter('member_days', 3));
    expect(preview.bills.team.extraMemberCents).toBe(0);
  });
});
