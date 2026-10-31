import {
  allFreeAllowancesExhausted,
  billingStateAllowsReservation,
  type FreeAllowanceRemaining,
} from '@timeline/shared/billing/status';

export const BILLING_NOTICE_TITLE = {
  payment_failed: 'Payment failed.',
  spend_cap: 'Spend cap reached.',
  allowance: 'Free allowance used up.',
  paused:
    'Metered work is paused for this workspace. Contact support to review its billing status.',
} as const;

/** Which exceptional state, if any, the customer billing surfaces should banner. */
export function customerBillingState(input: {
  planId: string;
  billingState: string;
  costBearingPaused: boolean;
  freeRemaining: FreeAllowanceRemaining;
  spendCapCents: number;
  meteredSpendCents: number;
  /** Spend-cap percent. Null when the plan has no positive cap. */
  warnPercent: number | null;
}): keyof typeof BILLING_NOTICE_TITLE | null {
  if (input.billingState === 'past_due' || input.billingState === 'payment_retry') {
    return 'payment_failed';
  }
  if (!billingStateAllowsReservation(input.billingState)) return 'paused';
  if (input.planId === 'free') {
    if (allFreeAllowancesExhausted(input.freeRemaining)) return 'allowance';
    return input.costBearingPaused ? 'paused' : null;
  }
  if (input.planId === 'enterprise') return null;
  const atCap = input.spendCapCents > 0 && (input.warnPercent ?? 0) >= 100;
  const hardStop = input.spendCapCents <= 0 && input.meteredSpendCents > 0;
  if (atCap || hardStop) return 'spend_cap';
  if (input.costBearingPaused) return 'paused';
  return null;
}
