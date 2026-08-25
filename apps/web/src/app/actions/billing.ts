'use server';

import {
  createPolarBillingProvider,
  isPolarBillingConfigured,
  isPolarTopUpConfigured,
  polarProductIdForPlan,
  polarTopUpProductId,
  PREPAID_TOPUP_CENTS,
  planUsesPrepaidWallet,
} from '@timeline/shared/billing';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

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
  return { ok: true as const, email, active, scope };
}

export async function startBillingCheckout(input: {
  plan: 'payg' | 'team' | 'business';
  discountCode?: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const gate = await requireBillingAdmin();
  if (!gate.ok) return gate;
  if (!isPolarBillingConfigured()) {
    return { ok: false, error: 'Polar billing is not configured.' };
  }
  const productId = polarProductIdForPlan(input.plan);
  if (!productId) return { ok: false, error: 'Missing Polar product id for plan.' };

  const provider = createPolarBillingProvider();
  if (!provider) return { ok: false, error: 'Polar provider unavailable.' };

  const env = getEnv();
  const submittedCode = input.discountCode?.trim();
  if (submittedCode) {
    const expected = env.POLAR_DISCOUNT_CODE?.trim();
    if (
      !expected ||
      !env.POLAR_DISCOUNT_ID ||
      submittedCode.toLowerCase() !== expected.toLowerCase()
    ) {
      return { ok: false, error: 'That discount code is not valid.' };
    }
  }
  await provider.ensureCustomer({
    externalId: gate.active.teamId,
    email: gate.email,
    name: gate.active.teamName,
  });
  const checkout = await provider.createCheckoutSession({
    externalCustomerId: gate.active.teamId,
    customerEmail: gate.email,
    productId,
    successUrl: `${env.AUTH_URL}/app/team?section=billing&checkout=success`,
    ...(submittedCode && env.POLAR_DISCOUNT_ID ? { discountId: env.POLAR_DISCOUNT_ID } : {}),
  });
  return { ok: true, url: checkout.url };
}

export async function updateBillingSpendCap(input: {
  spendCapCents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
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
}

export async function startWalletTopUp(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const gate = await requireBillingAdmin();
  if (!gate.ok) return gate;
  if (!isPolarTopUpConfigured()) {
    return { ok: false, error: 'Prepaid top-up is not configured.' };
  }
  const productId = polarTopUpProductId();
  if (!productId) return { ok: false, error: 'Missing Polar top-up product id.' };

  const account = await gate.scope.billing.getAccount();
  if (!planUsesPrepaidWallet(account.planId)) {
    return {
      ok: false,
      error: 'Prepaid top-up is available on paid plans. Free workspaces stop at native allowances.',
    };
  }

  const provider = createPolarBillingProvider();
  if (!provider) return { ok: false, error: 'Polar provider unavailable.' };

  const env = getEnv();
  await provider.ensureCustomer({
    externalId: gate.active.teamId,
    email: gate.email,
    name: gate.active.teamName,
  });
  const checkout = await provider.createCheckoutSession({
    externalCustomerId: gate.active.teamId,
    customerEmail: gate.email,
    productId,
    successUrl: `${env.AUTH_URL}/app/team?section=billing&checkout=topup`,
  });
  return { ok: true, url: checkout.url };
}

export async function updateBillingAutoReload(input: {
  enabled: boolean;
  thresholdCents?: number;
  amountCents?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireBillingAdmin();
  if (!gate.ok) return gate;
  try {
    const amountCents = input.amountCents ?? PREPAID_TOPUP_CENTS;
    if (input.enabled && (!Number.isInteger(amountCents) || amountCents <= 0)) {
      return { ok: false, error: 'Auto-reload amount must be a positive euro amount.' };
    }
    const account = await gate.scope.billing.getAccount();
    if (input.enabled && !planUsesPrepaidWallet(account.planId)) {
      return {
        ok: false,
        error: 'Auto-reload is available on paid plans that spend the prepaid wallet.',
      };
    }
    if (input.enabled && account.spendCapCents > 0 && amountCents > account.spendCapCents) {
      return {
        ok: false,
        error: 'Auto-reload cannot exceed the workspace monthly spend cap.',
      };
    }
    await gate.scope.billing.setAutoReload({
      enabled: input.enabled,
      thresholdCents: input.thresholdCents ?? 500,
      amountCents,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update auto-reload.',
    };
  }
}
