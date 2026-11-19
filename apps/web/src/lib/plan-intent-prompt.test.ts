import { CAPACITY_BY_PLAN, PLAN_CATALOG } from '@timeline/shared/billing/catalog';
import { effectiveBillingPlanId } from '@timeline/shared/billing/operator';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  planIntentGrantsEntitlements,
  resolvePlanIntentPrompt,
  shouldClearPlanIntentCookie,
} from '@/lib/plan-intent-prompt';
import { paidSignupPlan, parseSignupPlan } from '@/lib/signup-plan';

function account(input: {
  planId: 'free' | 'team' | 'payg' | 'business';
  polarSubscriptionId?: string | null;
}) {
  return {
    planId: input.planId,
    arrangement: 'standard' as const,
    billingState: 'free' as const,
    spendCapCents: 0,
    compExpiresAt: null,
    polarSubscriptionId: input.polarSubscriptionId ?? null,
  };
}

describe('plan intent never grants entitlements', () => {
  it('keeps Free capacity while a Team intent cookie or query is present', () => {
    const intent = 'team';
    const unpaid = account({ planId: 'free' });
    // Cookie / ?plan= only name a destination; they never select CAPACITY_BY_PLAN.
    expect(paidSignupPlan(intent)).toBe('team');
    expect(parseSignupPlan(intent)).toBe('team');
    expect(planIntentGrantsEntitlements(intent, unpaid.planId)).toBe(false);
    expect(planIntentGrantsEntitlements('business', 'free')).toBe(false);
    expect(effectiveBillingPlanId(unpaid)).toBe('free');
    expect(CAPACITY_BY_PLAN[effectiveBillingPlanId(unpaid)].agentTurnsPerMonth).toBe(
      CAPACITY_BY_PLAN.free.agentTurnsPerMonth,
    );
    expect(CAPACITY_BY_PLAN[effectiveBillingPlanId(unpaid)].agentTurnsPerMonth).not.toBe(
      CAPACITY_BY_PLAN.team.agentTurnsPerMonth,
    );
    expect(PLAN_CATALOG[effectiveBillingPlanId(unpaid)].includedActiveMembers).toBe(3);
    expect(PLAN_CATALOG[effectiveBillingPlanId(unpaid)].platformFeeCents).toBe(0);
  });

  it('requires a confirmed paid account plan before Team entitlements apply', () => {
    const unpaid = account({ planId: 'free', polarSubscriptionId: null });
    const paid = account({ planId: 'team', polarSubscriptionId: 'sub_polar_confirmed' });
    expect(planIntentGrantsEntitlements('team', unpaid.planId)).toBe(false);
    expect(effectiveBillingPlanId(unpaid)).toBe('free');
    expect(Boolean(unpaid.polarSubscriptionId)).toBe(false);

    expect(effectiveBillingPlanId(paid)).toBe('team');
    expect(Boolean(paid.polarSubscriptionId)).toBe(true);
    expect(CAPACITY_BY_PLAN[effectiveBillingPlanId(paid)].agentTurnsPerMonth).toBe(
      CAPACITY_BY_PLAN.team.agentTurnsPerMonth,
    );
    expect(PLAN_CATALOG[effectiveBillingPlanId(paid)].platformFeeCents).toBe(
      PLAN_CATALOG.team.platformFeeCents,
    );
  });

  it('only shows the finish-setup prompt while the workspace is still Free', () => {
    const prompt = resolvePlanIntentPrompt({
      intent: 'team',
      accountPlanId: 'free',
      hasPolarSubscription: false,
      canManageBilling: true,
      teamName: 'Acme Labs',
    });
    expect(prompt?.title).toBe('Finish setting up Acme Labs');
    expect(prompt?.ctaLabel).toBe('Choose Team');
    expect(prompt?.href).toBe('/app/team?section=billing&plan=team#change-plan');
    expect(prompt?.body).toMatch(/stays on Free until Polar confirms payment/i);

    expect(
      resolvePlanIntentPrompt({
        intent: 'team',
        accountPlanId: 'team',
        hasPolarSubscription: true,
        canManageBilling: true,
        teamName: 'Acme Labs',
      }),
    ).toBeNull();
    expect(
      resolvePlanIntentPrompt({
        intent: 'team',
        accountPlanId: 'free',
        hasPolarSubscription: false,
        canManageBilling: false,
        teamName: 'Acme Labs',
      }),
    ).toBeNull();
  });

  it('clears the intent cookie once a matching paid plan or Polar subscription is active', () => {
    expect(
      shouldClearPlanIntentCookie({
        intent: 'team',
        accountPlanId: 'free',
        hasPolarSubscription: false,
      }),
    ).toBe(false);
    expect(
      shouldClearPlanIntentCookie({
        intent: 'team',
        accountPlanId: 'team',
        hasPolarSubscription: false,
      }),
    ).toBe(true);
    expect(
      shouldClearPlanIntentCookie({
        intent: 'payg',
        accountPlanId: 'free',
        hasPolarSubscription: true,
      }),
    ).toBe(true);
  });
});
