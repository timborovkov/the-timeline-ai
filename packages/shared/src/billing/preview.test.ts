import { describe, expect, it } from 'vitest';

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
});
