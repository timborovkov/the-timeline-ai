import {
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  storageChargeCents,
  type BillingMeterId,
  type BillingPlanId,
} from '#src/billing/catalog.js';

export interface FreeAllowanceRemaining {
  aiChargeCents: number;
  recallMinutes: number;
  emailUnits: number;
  storageGb: number;
  acceptedSources: number;
}

export function freeAllowanceRemaining(meters: {
  ai?: { customerChargeCents: number; nativeUnits?: number } | null;
  recall_minutes?: { nativeUnits: number } | null;
  email_units?: { nativeUnits: number } | null;
  storage_gb_month?: { nativeUnits: number } | null;
  accepted_sources?: { nativeUnits: number } | null;
}): FreeAllowanceRemaining {
  const aiConsumed = Math.max(meters.ai?.nativeUnits ?? 0, meters.ai?.customerChargeCents ?? 0);
  return {
    aiChargeCents: Math.max(0, FREE_ALLOWANCES.aiChargeCents - aiConsumed),
    recallMinutes: Math.max(
      0,
      FREE_ALLOWANCES.recallMinutes - (meters.recall_minutes?.nativeUnits ?? 0),
    ),
    emailUnits: Math.max(0, FREE_ALLOWANCES.emailUnits - (meters.email_units?.nativeUnits ?? 0)),
    storageGb: Math.max(0, FREE_ALLOWANCES.storageGb - (meters.storage_gb_month?.nativeUnits ?? 0)),
    acceptedSources: Math.max(
      0,
      FREE_ALLOWANCES.acceptedSources - (meters.accepted_sources?.nativeUnits ?? 0),
    ),
  };
}

const EXHAUSTED_FREE_ALLOWANCE_LABELS = [
  ['aiChargeCents', 'AI'],
  ['recallMinutes', 'Meeting'],
  ['emailUnits', 'Email'],
  ['storageGb', 'Storage'],
  ['acceptedSources', 'Source'],
] as const satisfies readonly (readonly [keyof FreeAllowanceRemaining, string])[];

/**
 * Names the Free meters that are already exhausted. Empty when every allowance
 * still has room. The workspace pause flag stays false until all five are gone.
 */
export function exhaustedFreeAllowanceNotice(remaining: FreeAllowanceRemaining): string | null {
  const names = EXHAUSTED_FREE_ALLOWANCE_LABELS.filter(([key]) => remaining[key] <= 0).map(
    ([, label]) => label,
  );
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} allowance used up.`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')} and ${last} allowances used up.`;
}

/** True only when every Free native floor is gone — not a single exhausted meter. */
export function allFreeAllowancesExhausted(remaining: FreeAllowanceRemaining): boolean {
  return (
    remaining.aiChargeCents <= 0 &&
    remaining.recallMinutes <= 0 &&
    remaining.emailUnits <= 0 &&
    remaining.storageGb <= 0 &&
    remaining.acceptedSources <= 0
  );
}

/** States that may reserve usage. Past-due / canceled / restricted stay blocked. */
export function billingStateAllowsReservation(billingState: string): boolean {
  return (
    billingState === 'free' ||
    billingState === 'payg_active' ||
    billingState === 'team_active' ||
    billingState === 'business_active' ||
    billingState === 'enterprise_active' ||
    billingState === 'grace'
  );
}

export type PaidActiveBillingState =
  'payg_active' | 'team_active' | 'business_active' | 'enterprise_active';

/** Active commercial state for a paid plan. Free / unknown plans return null. */
export function billingStateForPaidPlan(planId: BillingPlanId): PaidActiveBillingState | null {
  switch (planId) {
    case 'payg':
      return 'payg_active';
    case 'team':
      return 'team_active';
    case 'business':
      return 'business_active';
    case 'enterprise':
      return 'enterprise_active';
    default:
      return null;
  }
}

/**
 * Settlement/refund shortfall freezes (`read_only` / `balance_exhausted`) restore
 * the plan's active state. Polar delinquency, restricted Free, and canceled
 * workspaces stay frozen until those paths resolve them.
 */
export function restoredPaidBillingStateAfterWalletOrCapRecovery(input: {
  planId: BillingPlanId;
  billingState: string;
}): PaidActiveBillingState | null {
  if (input.billingState !== 'read_only' && input.billingState !== 'balance_exhausted') {
    return null;
  }
  return billingStateForPaidPlan(input.planId);
}

/**
 * Settlement freeze zeros the spend cap. Restore the catalog default when that
 * default is a positive paid ceiling so raising the cap can admit work again.
 * Enterprise (catalog default €0) and an already-positive cap are left alone.
 */
export function restoredSpendCapCentsAfterShortfallUnfreeze(input: {
  planId: BillingPlanId;
  spendCapCents: number;
}): number | null {
  if (input.spendCapCents > 0) return null;
  const catalogDefault = PLAN_CATALOG[input.planId].defaultSpendCapCents;
  return catalogDefault > 0 ? catalogDefault : null;
}

export function costBearingPausedFromAccount(input: {
  planId: BillingPlanId;
  billingState: string;
  shadowBilling: boolean;
  spendCapCents: number;
  meteredSpendCents: number;
  freeRemaining: FreeAllowanceRemaining;
}): boolean {
  if (!billingStateAllowsReservation(input.billingState)) return true;
  const allFreeGone = allFreeAllowancesExhausted(input.freeRemaining);
  if (input.planId === 'free') return allFreeGone;
  if (input.shadowBilling || input.billingState === 'enterprise_active') return false;
  if (input.planId === 'payg' && !allFreeGone) return false;
  if (input.spendCapCents <= 0 || input.meteredSpendCents >= input.spendCapCents) return true;
  return false;
}

export function freeAllowanceConsumedForMeter(
  meterId: BillingMeterId,
  meters: Partial<
    Record<BillingMeterId, { nativeUnits: number; customerChargeCents: number } | undefined>
  >,
): { consumed: number; limit: number; unit: 'cents' | 'native' } | null {
  switch (meterId) {
    case 'ai':
      return {
        // Gross AI cents live on nativeUnits. PAYG customerChargeCents is
        // post-floor overage and would otherwise reset the Free floor every call.
        consumed: Math.max(meters.ai?.nativeUnits ?? 0, meters.ai?.customerChargeCents ?? 0),
        limit: FREE_ALLOWANCES.aiChargeCents,
        unit: 'cents',
      };
    case 'recall_minutes':
      return {
        consumed: meters.recall_minutes?.nativeUnits ?? 0,
        limit: FREE_ALLOWANCES.recallMinutes,
        unit: 'native',
      };
    case 'email_units':
      return {
        consumed: meters.email_units?.nativeUnits ?? 0,
        limit: FREE_ALLOWANCES.emailUnits,
        unit: 'native',
      };
    case 'storage_gb_month':
      return {
        consumed: meters.storage_gb_month?.nativeUnits ?? 0,
        limit: FREE_ALLOWANCES.storageGb,
        unit: 'native',
      };
    case 'accepted_sources':
      return {
        consumed: meters.accepted_sources?.nativeUnits ?? 0,
        limit: FREE_ALLOWANCES.acceptedSources,
        unit: 'native',
      };
    case 'member_days':
      return null;
  }
}

/** Retail euro value of the monthly Free native floor (for overage display). */
export function freeAllowanceFloorCents(): number {
  return (
    FREE_ALLOWANCES.aiChargeCents +
    FREE_ALLOWANCES.recallMinutes * 3 +
    Math.round((FREE_ALLOWANCES.emailUnits * 250) / 1000) +
    storageChargeCents(FREE_ALLOWANCES.storageGb) +
    Math.round((FREE_ALLOWANCES.acceptedSources * 50) / 1000)
  );
}
