import { FREE_ALLOWANCES, PLAN_CATALOG } from '@timeline/shared/billing/catalog';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  EXAMPLE_USAGE,
  estimatePricing,
  parseUsage,
  type UsageValues,
} from '@/lib/pricing-calculator';

const example = parseUsage(EXAMPLE_USAGE).values;
if (!example) throw new Error('The example must be valid');

const zero: UsageValues = { members: 1, ai: 0, meetings: 0, email: 0, storage: 0, sources: 0 };
describe('pricing estimates', () => {
  it('matches published examples and platform fees', () => {
    expect(estimatePricing({ ...zero, ai: 7 }).bills.payg.totalCents).toBe(500);
    expect(estimatePricing({ ...zero, meetings: 2 }).bills.payg.totalCents).toBe(180);
    expect(estimatePricing(zero).bills.team.totalCents).toBe(4900);
    expect(estimatePricing(zero).bills.business.totalCents).toBe(19900);
    expect(estimatePricing(example).bills.payg.totalCents).toBe(4018);
  });
  it('applies native PAYG allowances and pooled paid credits separately', () => {
    const atFloor = {
      ...zero,
      ai: 2,
      meetings: 1,
      email: 500,
      storage: FREE_ALLOWANCES.storageGb,
      sources: 1000,
    };
    expect(estimatePricing(atFloor).bills.payg.totalCents).toBe(0);
    expect(estimatePricing({ ...zero, ai: 60 }).bills.team.totalCents).toBe(4900);
    expect(estimatePricing({ ...zero, ai: 60.01 }).bills.team.totalCents).toBe(4901);
    expect(estimatePricing({ ...zero, ai: 250.01 }).bills.business.totalCents).toBe(19901);
    expect(estimatePricing({ ...zero, members: 4 }).bills.payg.extraMemberCents).toBe(200);
    expect(estimatePricing({ ...zero, members: 26 }).bills.team.extraMemberCents).toBe(200);
    expect(estimatePricing({ ...zero, members: 101 }).bills.business.extraMemberCents).toBe(200);
  });
  it('reconciles every breakdown with its bill including fractional rounding', () => {
    for (const usage of [
      zero,
      { ...zero, ai: 53.01, meetings: 1.13, storage: 0.12, email: 503, sources: 1009 },
      example,
    ]) {
      const result = estimatePricing(usage);
      expect(result.breakdown.reduce((sum, row) => sum + row.paygCents, 0)).toBe(
        result.bills.payg.meteredAfterDiscountCents,
      );
      for (const id of ['team', 'business'] as const) {
        const credit = PLAN_CATALOG[id].includedUsageDiscountCents;
        expect(
          Math.max(0, result.breakdown.reduce((sum, row) => sum + row.grossCents, 0) - credit),
        ).toBe(result.bills[id].meteredAfterDiscountCents);
      }
    }
  });
  it('excludes capacity violations and resolves equal costs in catalog order', () => {
    expect(estimatePricing({ ...zero, ai: 51 }).cheapest).toBe('payg');
    const overPayg = estimatePricing({ ...zero, storage: 26 });
    expect(overPayg.capacityWarnings.payg).toEqual(['25 GB storage']);
    expect(overPayg.cheapest).toBe('team');
    expect(estimatePricing({ ...zero, members: 501 }).cheapest).toBeNull();
    expect(estimatePricing({ ...zero, meetings: 501 }).cheapest).toBeNull();
    expect(estimatePricing({ ...zero, sources: 1_000_001 }).cheapest).toBeNull();
    expect(estimatePricing({ ...zero, ai: 1000 }).bills.payg.totalCents).toBe(99800);
  });
  it('rejects invalid inputs while allowing exact values beyond slider ranges', () => {
    for (const ai of ['', '-1', 'Infinity', 'NaN', '1.001', '1e9'])
      expect(parseUsage({ ...EXAMPLE_USAGE, ai }).values).toBeNull();
    expect(parseUsage({ ...EXAMPLE_USAGE, members: '1.5' }).values).toBeNull();
    expect(parseUsage({ ...EXAMPLE_USAGE, members: '0' }).values).toBeNull();
    expect(parseUsage({ ...EXAMPLE_USAGE, ai: '500.01', storage: '251.12' }).values?.storage).toBe(
      251.12,
    );
  });
});
