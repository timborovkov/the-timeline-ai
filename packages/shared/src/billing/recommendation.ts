import type { BillingPlanId } from '#src/billing/catalog.js';

export type SelfServePaidPlanId = 'payg' | 'team' | 'business';

export interface PlanBillPreview {
  planId: SelfServePaidPlanId;
  platformFeeCents: number;
  extraMemberCents: number;
  meteredAfterDiscountCents: number;
  totalCents: number;
}

export interface CheapestPlanPreview {
  recommended: SelfServePaidPlanId;
  bills: Record<SelfServePaidPlanId, PlanBillPreview>;
}

/**
 * Show the billing-settings recommendation only when another self-serve plan
 * saves at least €5 and at least 10% of the current plan's projected bill.
 */
export const PLAN_RECOMMENDATION_SAVINGS_THRESHOLD = {
  minCents: 500,
  minRatio: 0.1,
} as const;

/** Whether team billing settings should render the cheapest-plan section. */
export function shouldShowPlanRecommendation(
  preview: CheapestPlanPreview,
  currentPlanId: string,
): boolean {
  if (currentPlanId !== 'payg' && currentPlanId !== 'team' && currentPlanId !== 'business') {
    return false;
  }
  if (preview.recommended === currentPlanId) return false;
  const currentCents = preview.bills[currentPlanId].totalCents;
  const savingCents = currentCents - preview.bills[preview.recommended].totalCents;
  if (savingCents < PLAN_RECOMMENDATION_SAVINGS_THRESHOLD.minCents) return false;
  if (currentCents <= 0) return false;
  return savingCents / currentCents >= PLAN_RECOMMENDATION_SAVINGS_THRESHOLD.minRatio;
}

export function isPaidSelfServePlan(planId: BillingPlanId): planId is SelfServePaidPlanId {
  return planId === 'payg' || planId === 'team' || planId === 'business';
}
