import {
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  SELF_SERVE_PLAN_ORDER,
  formatEuroFromCents,
  formatStorageGb,
} from '@timeline/shared/billing/catalog';

/** Paid self-serve plans that can be carried from pricing into Team → Billing. */
export type PaidSignupPlanId = 'payg' | 'team' | 'business';

export type SignupPlanId = (typeof SELF_SERVE_PLAN_ORDER)[number];

const SELF_SERVE_PLAN_IDS = new Set<string>(SELF_SERVE_PLAN_ORDER);

/** Validate `?plan=` against the public self-serve catalog; unknown values become Free. */
export function parseSignupPlan(value: unknown): SignupPlanId {
  return typeof value === 'string' && SELF_SERVE_PLAN_IDS.has(value)
    ? (value as SignupPlanId)
    : 'free';
}

export function paidSignupPlan(value: unknown): PaidSignupPlanId | undefined {
  const plan = parseSignupPlan(value);
  return plan === 'payg' || plan === 'team' || plan === 'business' ? plan : undefined;
}

/**
 * Prefer an explicit `?plan=` query; otherwise recover a paid selection from a
 * preserved Billing callback (Sign in → Create one).
 */
export function resolveSignupPlanDisplay(input: {
  plan?: string;
  callbackUrl?: string;
  planFromCallback?: PaidSignupPlanId;
}): SignupPlanId {
  if (typeof input.plan === 'string') return parseSignupPlan(input.plan);
  return input.planFromCallback ?? 'free';
}

export interface SignupPlanCopy {
  planId: SignupPlanId;
  name: string;
  subtitle: string;
  includes: string[];
  billingStarts: string;
  reviewWhere: string;
}

function includedMembersLabel(planId: SignupPlanId): string {
  const included = PLAN_CATALOG[planId].includedActiveMembers;
  return included === 1 ? '1 included member' : `${included} included members`;
}

function usageInclude(planId: SignupPlanId): string {
  const credit = PLAN_CATALOG[planId].includedUsageDiscountCents;
  if (credit > 0) {
    return `Up to ${formatEuroFromCents(credit)} usage credit / month`;
  }
  return `${formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} AI + ${FREE_ALLOWANCES.acceptedSources.toLocaleString('en-IE')} source units / month`;
}

function extraMemberInclude(planId: SignupPlanId): string {
  if (planId === 'free') return 'Stops at your allowance or capacity limit';
  return `${formatEuroFromCents(PLAN_CATALOG[planId].additionalMemberCents ?? 0)} per extra member / month`;
}

/**
 * Honest signup copy aligned with the pricing grid and Polar checkout behaviour.
 * Creating an account never starts checkout; paid plans wait for Team → Billing.
 */
export function signupPlanCopy(planId: SignupPlanId): SignupPlanCopy {
  const plan = PLAN_CATALOG[planId];
  const includes = [includedMembersLabel(planId), usageInclude(planId), extraMemberInclude(planId)];
  if (planId === 'free' || planId === 'payg') {
    includes.push(
      `Free monthly floor also covers ${FREE_ALLOWANCES.recallMinutes} meeting minutes, ${FREE_ALLOWANCES.emailUnits} email units, and ${formatStorageGb(FREE_ALLOWANCES.storageGb)} storage`,
    );
  }

  if (planId === 'free') {
    return {
      planId,
      name: plan.name,
      subtitle:
        'Free for up to 3 members — no card required. Name your team next, then connect one source and open the first record.',
      includes,
      billingStarts:
        'Creating an account does not charge you. Free has no card requirement and no platform fee.',
      reviewWhere:
        'After setup, open Team settings → Billing anytime to stay on Free or choose another plan. Checkout starts only if you confirm a paid plan there.',
    };
  }

  const fee =
    plan.platformFeeCents && plan.platformFeeCents > 0
      ? `${formatEuroFromCents(plan.platformFeeCents)}/month platform fee`
      : '€0 platform fee';

  return {
    planId,
    name: plan.name,
    subtitle: `${plan.name} — ${fee}. Creating an account does not charge you.`,
    includes,
    billingStarts:
      'Billing starts only after you confirm a plan in Team settings → Billing and complete Polar checkout. Setup and account creation do not open checkout or save a card. Your team stays on Free until Polar confirms payment.',
    reviewWhere: `After setup we’ll remind you to finish ${plan.name}. That prompt opens Team settings → Billing with ${plan.name} highlighted. You can dismiss it; cancelled checkout leaves you on Free.`,
  };
}
