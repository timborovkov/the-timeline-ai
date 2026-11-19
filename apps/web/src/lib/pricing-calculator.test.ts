import { FREE_ALLOWANCES, PLAN_CATALOG } from '@timeline/shared/billing/catalog';
import { WEBSITE_SOURCE_UNITS_PER_PAGE } from '@timeline/shared/websites/usage';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  CALCULATOR_ACTIVITY_ASSUMPTIONS,
  DEFAULT_USAGE_PRESET,
  EXAMPLE_USAGE,
  USAGE_PRESETS,
  estimatePricing,
  formatUnitAssumption,
  parseUsage,
  presetMatchingDraft,
  type UsageValues,
} from '@/lib/pricing-calculator';

const example = parseUsage(EXAMPLE_USAGE).values;
if (!example) throw new Error('The example must be valid');

const zero: UsageValues = { members: 1, ai: 0, meetings: 0, email: 0, storage: 0, sources: 0 };

describe('usage presets and unit assumptions', () => {
  it('keeps preset values editable and catalog-backed unit assumptions', () => {
    expect(USAGE_PRESETS.map((preset) => preset.id)).toEqual([
      'client-delivery',
      'slack-engineering',
      'meeting-delivery',
    ]);
    expect(DEFAULT_USAGE_PRESET.usage).toEqual(EXAMPLE_USAGE);
    expect(DEFAULT_USAGE_PRESET.label).toBe('Five-person client team');
    expect(USAGE_PRESETS.find((preset) => preset.id === 'slack-engineering')?.label).toBe(
      'Slack-heavy engineering team',
    );
    expect(CALCULATOR_ACTIVITY_ASSUMPTIONS.ordinaryAcceptedSourceUnits).toBe(1);
    expect(CALCULATOR_ACTIVITY_ASSUMPTIONS.websitePageSourceUnits).toBe(
      WEBSITE_SOURCE_UNITS_PER_PAGE,
    );
    expect(CALCULATOR_ACTIVITY_ASSUMPTIONS.emailUnitPerMessageOrRecipient).toBe(1);
    expect(formatUnitAssumption()).toBe(
      `Website pages count as ${WEBSITE_SOURCE_UNITS_PER_PAGE} source units; each email message or recipient as 1.`,
    );
    expect(formatUnitAssumption()).not.toMatch(/€|question/i);
    for (const preset of USAGE_PRESETS) {
      expect(parseUsage(preset.usage).values).not.toBeNull();
      expect(presetMatchingDraft(preset.usage, preset.website)?.id).toBe(preset.id);
    }
  });
});

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

it('adds weighted website usage once to the existing source meter', () => {
  const parsed = parseUsage(EXAMPLE_USAGE);
  if (!parsed.values) throw new Error('Example usage must parse');
  const estimate = estimatePricing(parsed.values, {
    websites: 1,
    pages: 5,
    frequency: 'daily',
    manualScans: 0,
  });
  expect(estimate.websiteUsage.sourceUnits).toBe(3000);
  const source = estimate.breakdown.find((row) => row.id === 'accepted_sources');
  expect(source?.nativeUnits).toBe(parsed.values.sources + 3000);
  expect(estimate.breakdown.filter((row) => row.id === 'accepted_sources')).toHaveLength(1);
});
