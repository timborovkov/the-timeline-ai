import { SELF_SERVE_PLAN_ORDER } from '@timeline/shared/billing/catalog';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  paidSignupPlan,
  parseSignupPlan,
  signupPlanCopy,
  type SignupPlanId,
} from '@/lib/signup-plan';

describe('parseSignupPlan', () => {
  it('accepts every self-serve catalog plan and ignores unknown values', () => {
    for (const plan of SELF_SERVE_PLAN_ORDER) {
      expect(parseSignupPlan(plan)).toBe(plan);
    }
    expect(parseSignupPlan('enterprise')).toBe('free');
    expect(parseSignupPlan('TEAM')).toBe('free');
    expect(parseSignupPlan('https://evil.test')).toBe('free');
    expect(parseSignupPlan(['team'])).toBe('free');
    expect(parseSignupPlan(undefined)).toBe('free');
    expect(parseSignupPlan(null)).toBe('free');
  });

  it('exposes only paid self-serve plans for billing continuation', () => {
    expect(paidSignupPlan('payg')).toBe('payg');
    expect(paidSignupPlan('team')).toBe('team');
    expect(paidSignupPlan('business')).toBe('business');
    expect(paidSignupPlan('free')).toBeUndefined();
    expect(paidSignupPlan('enterprise')).toBeUndefined();
  });
});

describe('signupPlanCopy', () => {
  it.each(SELF_SERVE_PLAN_ORDER satisfies readonly SignupPlanId[])(
    'describes %s without inventing a trial or auto-charge',
    (planId) => {
      const copy = signupPlanCopy(planId);
      expect(copy.planId).toBe(planId);
      expect(copy.name.length).toBeGreaterThan(0);
      expect(copy.subtitle.length).toBeGreaterThan(0);
      expect(copy.includes.length).toBeGreaterThanOrEqual(3);
      expect(copy.billingStarts.toLowerCase()).not.toContain('trial');
      expect(copy.billingStarts.toLowerCase()).not.toMatch(/automatically charg/);
      expect(copy.reviewWhere).toMatch(/Team settings → Billing/);
      if (planId === 'free') {
        expect(copy.subtitle).toMatch(/no card required/i);
        expect(copy.billingStarts).toMatch(/does not charge you/i);
      } else {
        expect(copy.subtitle).toMatch(/does not charge you/i);
        expect(copy.billingStarts).toMatch(/Polar checkout/i);
        expect(copy.reviewWhere).toContain(copy.name);
      }
    },
  );

  it('keeps Free and Team includes aligned with the pricing catalog', () => {
    const free = signupPlanCopy('free');
    expect(free.includes[0]).toBe('3 included members');
    expect(free.includes.some((line) => /Stops at your allowance/i.test(line))).toBe(true);

    const team = signupPlanCopy('team');
    expect(team.includes[0]).toBe('25 included members');
    expect(team.includes.some((line) => line.includes('€60'))).toBe(true);
    expect(team.subtitle).toMatch(/€49/);
  });
});
