'use server';

import {
  checkoutDiscountId,
  withTeamBillingIdentity,
  PolarIdentityError,
  PolarDiscountError,
  compSuppressesPolarCharges,
  createPlanChangeSession,
  createPolarBillingProvider,
  isPolarBillingConfigured,
  polarProductIdForPlan,
  polarSubscriptionIdForPlanChange,
  selfServeCheckoutPlan,
} from '@timeline/shared/billing';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { runSentryServerAction } from '@/lib/sentry-action';
async function requireBillingAdmin() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const userId = session.user.id;
  const email = session.user.email;
  if (!userId || !email) redirect('/sign-in');
  const { active } = await resolveActiveTeam(userId);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, userId);
  const role = await scope.requireMembership();
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false as const, error: 'Only owners and admins can manage billing.' };
  }
  return { ok: true as const, userId, email, active, scope };
}

export async function startBillingCheckout(input: {
  plan: string;
  discountCode?: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return runSentryServerAction('start_billing_checkout', async () => {
    const gate = await requireBillingAdmin();
    if (!gate.ok) return gate;
    const plan = selfServeCheckoutPlan(input.plan);
    if (!plan) {
      return {
        ok: false,
        error: 'Team is the only plan available for self-serve checkout.',
      };
    }
    if (!isPolarBillingConfigured()) {
      return { ok: false, error: 'Polar billing is not configured.' };
    }
    const productId = polarProductIdForPlan(plan);
    if (!productId) return { ok: false, error: 'Missing Polar product id for plan.' };

    const provider = createPolarBillingProvider();
    if (!provider) return { ok: false, error: 'Polar provider unavailable.' };

    const env = getEnv();
    const account = await gate.scope.billing.getAccount();
    if (compSuppressesPolarCharges(account)) {
      return {
        ok: false,
        error: 'This workspace is on a comped internal plan. Polar checkout is turned off.',
      };
    }
    if (account.planId === 'enterprise') {
      return {
        ok: false,
        error:
          'Enterprise checkout is opened by a platform operator. Plan changes are not self-serve.',
      };
    }
    if (input.discountCode !== undefined && typeof input.discountCode !== 'string') {
      return { ok: false, error: 'Enter a valid promo code.' };
    }
    try {
      const checkoutResult = await withTeamBillingIdentity(
        { db, provider, teamId: gate.active.teamId, userId: gate.userId },
        async (
          identity,
          { account: current, db: checkoutDb, recordCheckout, prepareTeamCheckout },
        ) => {
          if (compSuppressesPolarCharges(current)) {
            return {
              ok: false as const,
              error: 'This workspace is on a comped internal plan. Polar checkout is turned off.',
            };
          }
          if (current.planId === 'enterprise') {
            return {
              ok: false as const,
              error:
                'Enterprise checkout is opened by a platform operator. Plan changes are not self-serve.',
            };
          }
          const [discountId, seats] = await Promise.all([
            checkoutDiscountId({
              account: current,
              submittedCode: input.discountCode,
              provider,
              productId,
            }),
            withTeam(checkoutDb, gate.active.teamId, gate.userId).billing.countActiveFullMembers(),
          ]);
          if (seats < 1)
            return { ok: false as const, error: 'Team requires at least one full member.' };
          if (!polarSubscriptionIdForPlanChange(current)) {
            const pending = await prepareTeamCheckout({
              productId,
              seats,
              ...(discountId ? { discountId } : {}),
            });
            if (pending.status === 'resume') return { ok: true as const, url: pending.url };
            if (pending.status === 'blocked')
              return {
                ok: false as const,
                error:
                  'A previous checkout is still open or awaiting payment confirmation. Finish that checkout or wait for it to expire before creating another.',
              };
          }
          const checkout = await createPlanChangeSession({
            ...identity,
            provider,
            account: current,
            productId,
            seats,
            externalCustomerId: gate.active.teamId,
            customerEmail: gate.email,
            successUrl: `${env.AUTH_URL}/app/team?section=billing&checkout=success&checkoutTeam=${gate.active.teamId}&checkoutPlan=${plan}`,
            portalReturnUrl: `${env.AUTH_URL}/app/team?section=billing`,
            ...(discountId ? { discountId } : {}),
          });
          if (checkout.id) await recordCheckout(checkout.id);
          return { ok: true as const, url: checkout.url, created: Boolean(checkout.id) };
        },
      );
      if (checkoutResult.ok && checkoutResult.created) {
        // Keep plan intent until Polar confirms payment (or the user dismisses).
        // Creating a checkout session is not confirmation — abandoned checkout
        // must leave Free and keep the finish-setup reminder available.
        trackProductEventBestEffort(
          { kind: 'user', userId: gate.userId, teamId: gate.active.teamId },
          'billing_checkout_created',
          { plan },
        );
      }
      return checkoutResult.ok ? { ok: true, url: checkoutResult.url } : checkoutResult;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof PolarDiscountError || error instanceof PolarIdentityError
            ? error.message
            : 'Polar billing is temporarily unavailable. Please retry; no full-price checkout will be opened.',
      };
    }
  });
}

export async function updateBillingSpendCap(input: {
  spendCapCents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return runSentryServerAction('update_billing_spend_cap', async () => {
    const gate = await requireBillingAdmin();
    if (!gate.ok) return gate;
    try {
      await gate.scope.billing.setSpendCap(input.spendCapCents);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to update spend cap.',
      };
    }
  });
}

export async function startBillingPortal(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  return runSentryServerAction('start_billing_portal', async () => {
    const gate = await requireBillingAdmin();
    if (!gate.ok) return gate;
    if (!isPolarBillingConfigured()) {
      return { ok: false, error: 'Polar billing is not configured.' };
    }
    const provider = createPolarBillingProvider();
    if (!provider) return { ok: false, error: 'Polar provider unavailable.' };
    const account = await gate.scope.billing.getAccount();
    if (compSuppressesPolarCharges(account)) {
      return {
        ok: false,
        error: 'This workspace is on a comped internal plan. Polar checkout is turned off.',
      };
    }
    const env = getEnv();
    try {
      return await withTeamBillingIdentity(
        { db, provider, teamId: gate.active.teamId, userId: gate.userId },
        async (identity, { account: current }) => {
          if (compSuppressesPolarCharges(current)) {
            return {
              ok: false as const,
              error: 'This workspace is on a comped internal plan. Polar checkout is turned off.',
            };
          }
          const portal = await provider.createCustomerPortalSession({
            ...identity,
            returnUrl: `${env.AUTH_URL}/app/team?section=billing`,
          });
          return { ok: true as const, url: portal.url };
        },
      );
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof PolarIdentityError
            ? error.message
            : 'Polar billing is temporarily unavailable. Please retry.',
      };
    }
  });
}
