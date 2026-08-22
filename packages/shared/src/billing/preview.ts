import { PLAN_CATALOG, type BillingPlanId } from '#src/billing/catalog.js';

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

function extraMembers(activeMembers: number, included: number | null): number {
  if (included === null) return 0;
  return Math.max(0, activeMembers - included);
}

function billForPlan(input: {
  planId: SelfServePaidPlanId;
  activeMembers: number;
  meteredSpendCents: number;
}): PlanBillPreview {
  const plan = PLAN_CATALOG[input.planId];
  const extra = extraMembers(input.activeMembers, plan.includedActiveMembers);
  const extraMemberCents = extra * (plan.additionalMemberCents ?? 0);
  const meteredAfterDiscountCents = Math.max(
    0,
    input.meteredSpendCents - plan.includedUsageDiscountCents,
  );
  const platformFeeCents = plan.platformFeeCents ?? 0;
  return {
    planId: input.planId,
    platformFeeCents,
    extraMemberCents,
    meteredAfterDiscountCents,
    totalCents: platformFeeCents + extraMemberCents + meteredAfterDiscountCents,
  };
}

/**
 * Invoice preview for PAYG vs Team vs Business from the same member-day
 * and native-usage totals. Recommendation is informational — never auto-switch.
 */
export function cheapestPlanPreview(input: {
  activeMembers: number;
  meteredSpendCents: number;
}): CheapestPlanPreview {
  const bills = {
    payg: billForPlan({ planId: 'payg', ...input }),
    team: billForPlan({ planId: 'team', ...input }),
    business: billForPlan({ planId: 'business', ...input }),
  };
  let recommended: SelfServePaidPlanId = 'payg';
  for (const id of ['team', 'business'] as const) {
    if (bills[id].totalCents < bills[recommended].totalCents) recommended = id;
  }
  return { recommended, bills };
}

export function isPaidSelfServePlan(planId: BillingPlanId): planId is SelfServePaidPlanId {
  return planId === 'payg' || planId === 'team' || planId === 'business';
}
