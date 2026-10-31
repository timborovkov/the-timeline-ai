import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  applyMeteredDiscountCents,
  checkoutDiscountId,
  describeTeamComp,
  effectiveBillingPlanId,
  historicalPlanIdOnDay,
  isActiveComp,
  isPlatformAdminEmail,
  localChargeSpendCapApplies,
  resolveTeamCommercialTerms,
} from '#src/billing/operator.js';
import { cheapestPlanPreview } from '#src/billing/preview.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';

const base = {
  planId: 'team' as const,
  billingState: 'team_active',
  spendCapCents: 10_000,
};

describe('historical plan on a UTC day', () => {
  it('keeps a comped plan through the day before expiry', () => {
    expect(
      historicalPlanIdOnDay({
        storedPlanId: 'team',
        arrangement: 'comped',
        compExpiresAt: new Date('2026-08-15T00:00:00.000Z'),
        day: '2026-08-14',
      }),
    ).toBe('team');
  });

  it('prices days after comp expiry as Free, including an Enterprise comp', () => {
    const expiresAt = new Date('2026-08-15T00:00:00.000Z');
    expect(
      historicalPlanIdOnDay({
        storedPlanId: 'team',
        arrangement: 'comped',
        compExpiresAt: expiresAt,
        day: '2026-08-15',
      }),
    ).toBe('free');
    expect(
      historicalPlanIdOnDay({
        storedPlanId: 'enterprise',
        arrangement: 'comped',
        compExpiresAt: expiresAt,
        day: '2026-08-20',
      }),
    ).toBe('free');
  });

  it('leaves a contractual Enterprise plan and a cleared comp on the stored plan', () => {
    expect(
      historicalPlanIdOnDay({
        storedPlanId: 'enterprise',
        arrangement: 'standard',
        compExpiresAt: new Date('2026-08-15T00:00:00.000Z'),
        day: '2026-08-20',
      }),
    ).toBe('enterprise');
    expect(
      historicalPlanIdOnDay({
        storedPlanId: 'team',
        arrangement: 'standard',
        day: '2026-08-20',
      }),
    ).toBe('team');
    expect(
      historicalPlanIdOnDay({
        storedPlanId: 'team',
        arrangement: 'comped',
        compExpiresAt: null,
        day: '2026-08-20',
      }),
    ).toBe('team');
  });
});

describe('platform admin allowlist', () => {
  it('matches emails and ignores team role', () => {
    expect(isPlatformAdminEmail(' Tim@Example.com ', 'a@x.com, tim@example.com')).toBe(true);
    expect(isPlatformAdminEmail('owner@timeline.dev', 'tim@example.com')).toBe(false);
    expect(isPlatformAdminEmail('tim@example.com', '')).toBe(false);
  });
});

describe('comped plans', () => {
  it('keeps entitlements until expiry, then falls back to Free without restoring Polar billing', () => {
    const active = {
      ...base,
      arrangement: 'comped' as const,
      compExpiresAt: new Date('2026-12-31T23:59:59.999Z'),
    };
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(isActiveComp(active, now)).toBe(true);
    expect(effectiveBillingPlanId(active, now)).toBe('team');
    expect(describeTeamComp(active, now)?.active).toBe(true);

    const expired = { ...active, compExpiresAt: new Date('2026-01-01T00:00:00.000Z') };
    expect(isActiveComp(expired, now)).toBe(false);
    expect(effectiveBillingPlanId(expired, now)).toBe('free');
    expect(describeTeamComp(expired, now)?.expired).toBe(true);
  });
});

describe('spend cap vs invoice eligibility', () => {
  const plans = ['free', 'payg', 'team', 'business', 'enterprise'] as const;
  const arrangements = [
    { comped: false, enterpriseContract: false },
    { comped: true, enterpriseContract: false },
    { comped: false, enterpriseContract: true },
  ] as const;

  it('applies the cap to the local charge for every plan, comp, and Enterprise contract', () => {
    for (const entitlementsPlanId of plans) {
      for (const arrangement of arrangements) {
        for (const shadowBilling of [false, true]) {
          const applies = localChargeSpendCapApplies({
            shadowBilling,
            comped: arrangement.comped,
            enterpriseContract: arrangement.enterpriseContract,
            entitlementsPlanId,
          });
          const standardFree = entitlementsPlanId === 'free' && !arrangement.comped;
          expect(applies).toBe(!shadowBilling && !arrangement.enterpriseContract && !standardFree);
        }
      }
    }
  });
});

describe('custom pricing', () => {
  it('applies an unexpired override and ignores a lapsed one', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const account = {
      ...base,
      arrangement: 'standard' as const,
      priceOverride: {
        platformFeeCents: 100,
        includedActiveMembers: 4,
        meteredDiscountPercent: 50,
      },
      priceOverrideExpiresAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    expect(resolveTeamCommercialTerms(account, now)).toMatchObject({
      platformFeeCents: 100,
      includedActiveMembers: 4,
      meteredDiscountPercent: 50,
    });
    expect(
      resolveTeamCommercialTerms(
        { ...account, priceOverrideExpiresAt: new Date('2026-05-01T00:00:00.000Z') },
        now,
      ).platformFeeCents,
    ).toBe(4_900);
    expect(
      resolveTeamCommercialTerms(
        {
          planId: 'enterprise',
          billingState: 'enterprise_active',
          spendCapCents: 0,
          enterprisePlatformFeeCents: 250_000,
          priceOverride: { includedActiveMembers: 12, platformFeeCents: 100 },
          priceOverrideExpiresAt: new Date('2026-05-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toMatchObject({
      platformFeeCents: 250_000,
      includedActiveMembers: null,
      meteredDiscountPercent: null,
    });
    expect(
      resolveTeamCommercialTerms(
        {
          ...base,
          planId: 'payg',
          billingState: 'payg_active',
          enterprisePlatformFeeCents: 250_000,
        },
        now,
      ).platformFeeCents,
    ).toBe(0);
    expect(applyMeteredDiscountCents(1_000, 10)).toBe(900);
  });

  it('resolves active team assignments ahead of submitted codes, with expiry and no-code handling', async () => {
    const provider = createFakeBillingProvider();
    const calls: unknown[] = [];
    provider.resolveDiscount = async (input) => {
      calls.push(input);
      return Promise.resolve(input.discountId ?? 'disc_code');
    };
    const account = { ...base, arrangement: 'standard' as const, polarDiscountId: 'disc_team' };
    const now = new Date('2026-10-30T12:00:00Z');
    expect(
      await checkoutDiscountId({
        account,
        submittedCode: 'WRONG',
        productId: 'prod',
        provider,
        now,
      }),
    ).toBe('disc_team');
    expect(calls).toEqual([{ discountId: 'disc_team', productId: 'prod' }]);
    const expired = { ...account, polarDiscountExpiresAt: now };
    expect(
      await checkoutDiscountId({
        account: expired,
        submittedCode: ' CODE ',
        productId: 'prod',
        provider,
        now,
      }),
    ).toBe('disc_code');
    expect(calls[1]).toEqual({ code: 'CODE', productId: 'prod' });
    expect(
      await checkoutDiscountId({
        account: expired,
        submittedCode: '  ',
        productId: 'prod',
        provider,
        now,
      }),
    ).toBeUndefined();
    expect(calls).toHaveLength(2);
    provider.resolveDiscount = () => Promise.reject(new Error('provider unavailable'));
    await expect(
      checkoutDiscountId({ account, submittedCode: 'CODE', productId: 'prod', provider, now }),
    ).rejects.toThrow('provider unavailable');
  });

  it('changes only the overridden plan in the cheapest-plan preview', () => {
    const preview = cheapestPlanPreview({
      activeMembers: 1,
      meteredSpendCents: 0,
      planTerms: { team: { platformFeeCents: 100, meteredDiscountPercent: 0 } },
    });
    expect(preview.bills.team.platformFeeCents).toBe(100);
    expect(preview.bills.business.platformFeeCents).toBe(19_900);
  });
});
