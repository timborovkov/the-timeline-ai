import { createFakeBillingProvider, PolarDiscountError } from '@timeline/shared/billing';
import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const provider = createFakeBillingProvider();
const auth = vi.fn();
const resolveActiveTeam = vi.fn();
const requireMembership = vi.fn();
const getAccount = vi.fn();
const withTeam = vi.fn(() => ({ requireMembership, billing: { getAccount } }));
const resolveDiscount = vi.fn();
provider.resolveDiscount = resolveDiscount;
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-action'),
  () => ({ runSentryServerAction: (_name: string, run: () => unknown) => run() }),
  () => import('@/lib/sentry-action'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({ withTeam }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/billing'),
  async () => ({
    ...(await import('@timeline/shared/billing')),
    withTeamBillingIdentity: async (
      input: { teamId: string },
      action: (identity: {
        customerId: string;
        memberId: string;
        externalCustomerId: string;
      }) => Promise<unknown>,
    ) =>
      action({
        customerId: 'cus-synthetic',
        memberId: 'member-synthetic',
        externalCustomerId: input.teamId,
      }),
    createPolarBillingProvider: () => provider,
    isPolarBillingConfigured: () => true,
    polarProductIdForPlan: () => 'product-synthetic',
  }),
  () => import('@timeline/shared/billing'),
);
const { startBillingCheckout } = await import('./billing');
const account = {
  planId: 'free',
  billingState: 'free',
  spendCapCents: 0,
  polarSubscriptionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  provider.checkouts.length = 0;
  provider.customers.clear();
  provider.subscriptionUpdates.length = 0;
  auth.mockResolvedValue({ user: { id: 'user-synthetic', email: 'owner@example.test' } });
  resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-synthetic', teamName: 'Synthetic' },
  });
  requireMembership.mockResolvedValue('owner');
  getAccount.mockResolvedValue(account);
  resolveDiscount.mockResolvedValue('discount-synthetic');
});

describe('promo checkout action', () => {
  it('takes team identity from the authorized session and ignores client discount IDs and amounts', async () => {
    const input = {
      plan: 'team',
      discountCode: 'CODE',
      discountId: 'attacker',
      amount: 1,
      teamId: 'other-team',
    };
    expect((await startBillingCheckout(input)).ok).toBe(true);
    expect(withTeam).toHaveBeenCalledWith(expect.anything(), 'team-synthetic', 'user-synthetic');
    expect(resolveDiscount).toHaveBeenCalledWith({ code: 'CODE', productId: 'product-synthetic' });
    expect(provider.checkouts).toHaveLength(1);
    expect(provider.checkouts[0]).toMatchObject({
      externalCustomerId: 'team-synthetic',
      discountId: 'discount-synthetic',
    });
    expect(provider.checkouts[0]?.amount).toBeUndefined();
  });

  it('returns distinct eligibility and provider errors without creating checkout or customer', async () => {
    for (const code of ['ineligible', 'unavailable'] as const) {
      resolveDiscount.mockRejectedValueOnce(new PolarDiscountError(code));
      const result = await startBillingCheckout({ plan: 'team', discountCode: 'CODE' });
      expect(result).toEqual({ ok: false, error: new PolarDiscountError(code).message });
    }
    expect(provider.checkouts).toHaveLength(0);
    expect(provider.customers.size).toBe(0);
  });

  it('uses active team assignments, then customer codes after assignment expiry', async () => {
    getAccount.mockResolvedValueOnce({ ...account, polarDiscountId: 'assigned' });
    await startBillingCheckout({ plan: 'team', discountCode: 'CODE' });
    expect(resolveDiscount).toHaveBeenLastCalledWith({
      discountId: 'assigned',
      productId: 'product-synthetic',
    });
    getAccount.mockResolvedValueOnce({
      ...account,
      polarDiscountId: 'assigned',
      polarDiscountExpiresAt: new Date(0),
    });
    await startBillingCheckout({ plan: 'team', discountCode: 'CODE' });
    expect(resolveDiscount).toHaveBeenLastCalledWith({
      code: 'CODE',
      productId: 'product-synthetic',
    });
  });

  it('skips discount lookup on no-code checkout and blocks members, comped and Enterprise workspaces', async () => {
    expect((await startBillingCheckout({ plan: 'team' })).ok).toBe(true);
    expect(resolveDiscount).not.toHaveBeenCalled();
    provider.checkouts.length = 0;
    requireMembership.mockResolvedValueOnce('member');
    expect((await startBillingCheckout({ plan: 'team', discountCode: 'CODE' })).ok).toBe(false);
    getAccount.mockResolvedValueOnce({ ...account, arrangement: 'comped' });
    expect((await startBillingCheckout({ plan: 'team', discountCode: 'CODE' })).ok).toBe(false);
    getAccount.mockResolvedValueOnce({ ...account, planId: 'enterprise' });
    expect((await startBillingCheckout({ plan: 'team', discountCode: 'CODE' })).ok).toBe(false);
    expect(provider.checkouts).toHaveLength(0);
    expect(resolveDiscount).not.toHaveBeenCalled();
  });
});
