/** Which exceptional state, if any, the customer billing surfaces should banner. */
export function customerBillingState(input: {
  planId: string;
  billingState: string;
  costBearingPaused: boolean;
  spendCapCents: number;
  meteredSpendCents: number;
  /** Spend-cap percent. Null when the plan has no positive cap. */
  warnPercent: number | null;
}): 'payment_failed' | 'spend_cap' | 'allowance' | null {
  if (input.billingState === 'past_due' || input.billingState === 'payment_retry') {
    return 'payment_failed';
  }
  if (input.planId === 'free') return input.costBearingPaused ? 'allowance' : null;
  if (input.planId === 'enterprise') return null;
  const atCap = input.spendCapCents > 0 && (input.warnPercent ?? 0) >= 100;
  const hardStop = input.spendCapCents <= 0 && input.meteredSpendCents > 0;
  if (atCap || hardStop || input.costBearingPaused) return 'spend_cap';
  return null;
}
