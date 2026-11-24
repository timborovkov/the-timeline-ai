import { SELF_SERVE_PLAN_ORDER } from '@timeline/shared/billing/catalog';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  paidSignupPlan,
  parseSignupPlan,
  resolveSignupPlanDisplay,
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
    expect(paidSignupPlan('payg')).toBeUndefined();
    expect(paidSignupPlan('team')).toBe('team');
    expect(paidSignupPlan('business')).toBeUndefined();
    expect(paidSignupPlan('free')).toBeUndefined();
    expect(paidSignupPlan('enterprise')).toBeUndefined();
  });
});

describe('resolveSignupPlanDisplay', () => {
  it('prefers an explicit plan query and recovers paid intent from a Billing callback', () => {
    expect(resolveSignupPlanDisplay({ plan: 'team' })).toBe('team');
    expect(resolveSignupPlanDisplay({ plan: 'enterprise', planFromCallback: 'team' })).toBe('free');
    expect(resolveSignupPlanDisplay({ planFromCallback: 'team' })).toBe('team');
    expect(resolveSignupPlanDisplay({})).toBe('free');
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
      expect(copy.includes.length).toBeGreaterThanOrEqual(2);
      expect(copy.billingStarts.toLowerCase()).not.toContain('trial');
      expect(copy.billingStarts.toLowerCase()).not.toMatch(/automatically charg/);
      expect(copy.reviewWhere).toMatch(/Team settings → Billing/);
      if (planId === 'free') {
        expect(copy.subtitle).toMatch(/no card required/i);
        expect(copy.billingStarts).toMatch(/requires no payment method/i);
      } else {
        expect(copy.subtitle).toMatch(/starting with one/i);
        expect(copy.billingStarts).toMatch(/complete checkout/i);
        expect(copy.reviewWhere).toContain(copy.name);
      }
    },
  );

  it('keeps Free and Team includes aligned with the pricing catalog', () => {
    const free = signupPlanCopy('free');
    expect(free.includes[0]).toBe('Up to 3 full members');
    expect(free.includes[1]).toContain('native meeting capture');

    const team = signupPlanCopy('team');
    expect(team.includes[0]).toContain('shared Included usage');
    expect(team.includes[1]).toContain('off by default');
    expect(team.subtitle).toMatch(/\$10/);
  });
});
