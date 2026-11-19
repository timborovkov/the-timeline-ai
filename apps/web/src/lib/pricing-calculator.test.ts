import { CAPACITY_BY_PLAN, FREE_ALLOWANCES, PLAN_CATALOG } from '@timeline/shared/billing/catalog';
import { WEBSITE_SOURCE_UNITS_PER_PAGE } from '@timeline/shared/websites/usage';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  CALCULATOR_ACTIVITY_ASSUMPTIONS,
  DEFAULT_USAGE_PRESET,
  EXAMPLE_USAGE,
  USAGE_PRESETS,
  estimatePricing,
  formatAskAssumption,
  formatSourceUnitAssumption,
  parseUsage,
  presetMatchingDraft,
  translateUsageActivities,
  type UsageValues,
} from '@/lib/pricing-calculator';

const example = parseUsage(EXAMPLE_USAGE).values;
if (!example) throw new Error('The example must be valid');
const freeAskTurns = CAPACITY_BY_PLAN.free.agentTurnsPerMonth;
if (freeAskTurns === null) throw new Error('Free Ask turns must be defined');

const zero: UsageValues = { members: 1, ai: 0, meetings: 0, email: 0, storage: 0, sources: 0 };

describe('usage presets and activity translations', () => {
  it('keeps preset values editable and tied to catalog-backed assumptions', () => {
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
    expect(CALCULATOR_ACTIVITY_ASSUMPTIONS.illustrativeAskTurnCustomerCents).toBe(
      FREE_ALLOWANCES.aiChargeCents / freeAskTurns,
    );
    expect(formatAskAssumption()).toContain('Free AI');
    expect(formatAskAssumption()).toContain(`${freeAskTurns.toLocaleString('en-IE')} Free Ask`);
    expect(formatSourceUnitAssumption()).toContain(`${WEBSITE_SOURCE_UNITS_PER_PAGE} units each`);
    for (const preset of USAGE_PRESETS) {
      const parsed = parseUsage(preset.usage);
      expect(parsed.values).not.toBeNull();
      const mixTotal =
        preset.sourceMix.messages +
        preset.sourceMix.emails +
        preset.sourceMix.documents +
        preset.sourceMix.notes;
      expect(mixTotal).toBe(Number(preset.usage.sources));
      expect(presetMatchingDraft(preset.usage, preset.website)?.id).toBe(preset.id);
    }
  });

  it('translates AI spend and source units into activities from catalog rates', () => {
    const preset = DEFAULT_USAGE_PRESET;
    const parsed = parseUsage(preset.usage);
    if (!parsed.values) throw new Error('Default preset must parse');
    const activities = translateUsageActivities(parsed.values, preset.website, preset.sourceMix);
    expect(activities.askCentsPerQuestion).toBe(FREE_ALLOWANCES.aiChargeCents / freeAskTurns);
    expect(activities.askQuestions).toBe(
      Math.round((parsed.values.ai * 100) / activities.askCentsPerQuestion),
    );
    expect(activities.askQuestions).toBe(500);
    expect(activities.ordinarySources).toBe(2_000);
    expect(activities.emailMessageOrRecipientUnits).toBe(1_000);
    expect(activities.sourceMix).toEqual(preset.sourceMix);
    expect(activities.websitePages).toBe(0);

    const meeting = USAGE_PRESETS.find((item) => item.id === 'meeting-delivery');
    if (!meeting) throw new Error('Meeting preset required');
    const meetingParsed = parseUsage(meeting.usage);
    if (!meetingParsed.values) throw new Error('Meeting preset must parse');
    const meetingActivities = translateUsageActivities(
      meetingParsed.values,
      meeting.website,
      meeting.sourceMix,
    );
    expect(meetingActivities.websitePages).toBe(25);
    expect(meetingActivities.websiteSourceUnits).toBe(25 * WEBSITE_SOURCE_UNITS_PER_PAGE);
    expect(meetingActivities.askQuestions).toBe(
      Math.round((35 * 100) / (FREE_ALLOWANCES.aiChargeCents / freeAskTurns)),
    );
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
