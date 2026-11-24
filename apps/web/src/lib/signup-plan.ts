import {
  FREE_ALLOWANCES,
  SELF_SERVE_PLAN_ORDER,
  TEAM_MONTHLY_SEAT_CENTS,
  formatUsdFromCents,
} from '@timeline/shared/billing/catalog';

export type PaidSignupPlanId = 'team';

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
  return plan === 'team' ? plan : undefined;
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

/** Signup records plan intent. Workspace billing owns checkout. */
export function signupPlanCopy(planId: SignupPlanId): SignupPlanCopy {
  if (planId === 'free') {
    return {
      planId,
      name: 'Free',
      subtitle: `Free for up to ${FREE_ALLOWANCES.activeMembers} full members. No card required.`,
      includes: [
        `Up to ${FREE_ALLOWANCES.activeMembers} full members`,
        'Shared monthly Included usage for AI processing and native meeting capture',
      ],
      billingStarts: 'Free requires no payment method.',
      reviewWhere: 'Open Team settings → Billing to review usage or upgrade to Team.',
    };
  }
  return {
    planId,
    name: 'Team',
    subtitle: `Team is ${formatUsdFromCents(TEAM_MONTHLY_SEAT_CENTS)} per full member each month, starting with one.`,
    includes: [
      'Each paid seat adds to shared Included usage',
      'Additional spending is off by default',
    ],
    billingStarts:
      'Your workspace stays on Free until you complete checkout in Team settings → Billing and Polar confirms activation.',
    reviewWhere: 'After setup, Team settings → Billing opens with Team selected.',
  };
}
