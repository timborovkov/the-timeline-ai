'use server';

import { getEnv } from '@timeline/shared/env';
import {
  createPolarBillingProvider,
  isPolarBillingConfigured,
  polarProductIdForPlan,
} from '@timeline/shared/billing';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

async function requireBillingAdmin() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false as const, error: 'Only owners and admins can manage billing.' };
  }
  return { ok: true as const, session, active, scope };
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
  await provider.ensureCustomer({
    externalId: gate.active.teamId,
    email: gate.session.user.email!,
    name: gate.active.teamName,
  });
  const checkout = await provider.createCheckoutSession({
    externalCustomerId: gate.active.teamId,
    customerEmail: gate.session.user.email!,
    productId,
    successUrl: `${env.AUTH_URL}/app/team?section=billing&checkout=success`,
    ...(env.POLAR_DISCOUNT_ID && input.discountCode
      ? { discountId: env.POLAR_DISCOUNT_ID }
      : {}),
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
