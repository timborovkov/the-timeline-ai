import { PLAN_CATALOG } from '@timeline/shared/billing/catalog';

import { selectedPlanCallback } from '@/lib/auth-redirect';
import { paidSignupPlan, type PaidSignupPlanId } from '@/lib/signup-plan';

/**
 * Pricing intent is navigation-only. Cookie/query never change planId, capacity,
 * or meter entitlements — only a confirmed Polar subscription (or operator path)
 * does that via billing account state.
 */
export function planIntentGrantsEntitlements(_intent: unknown, _accountPlanId: string): boolean {
  return false;
}

export function shouldClearPlanIntentCookie(input: {
  intent: unknown;
  accountPlanId: string;
  hasPolarSubscription: boolean;
}): boolean {
  const paid = paidSignupPlan(input.intent);
  if (!paid) return Boolean(input.intent);
  if (input.hasPolarSubscription) return true;
  return input.accountPlanId === paid;
}

export function resolvePlanIntentPrompt(input: {
  intent: unknown;
  accountPlanId: string;
  hasPolarSubscription: boolean;
  canManageBilling: boolean;
  teamName: string;
}): {
  planId: PaidSignupPlanId;
  planName: string;
  title: string;
  body: string;
  ctaLabel: string;
  href: string;
} | null {
  if (planIntentGrantsEntitlements(input.intent, input.accountPlanId)) return null;
  if (!input.canManageBilling) return null;
  if (input.hasPolarSubscription) return null;
  if (input.accountPlanId !== 'free') return null;
  const planId = paidSignupPlan(input.intent);
  if (!planId) return null;
  const href = selectedPlanCallback(planId);
  if (!href) return null;
  const planName = PLAN_CATALOG[planId].name;
  return {
    planId,
    planName,
    title: `Finish setting up ${input.teamName}`,
    body: `Choose your ${planName} plan when you’re ready. Your team stays on Free until Polar confirms payment.`,
    ctaLabel: `Choose ${planName}`,
    href,
  };
}
