/**
 * Derived billing status for dashboards, upgrade nudges, and admission UX.
 */

import {
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  SPEND_CAP_WARN_THRESHOLDS,
  type BillingMeterId,
  type BillingPlanId,
  formatEuroFromCents,
} from '#src/billing/catalog.js';

export type SpendCapWarnLevel = (typeof SPEND_CAP_WARN_THRESHOLDS)[number] | null;

export interface SpendCapUtilization {
  spendCapCents: number;
  meteredSpendCents: number;
  /** 0–100+, null when there is no positive cap (Free hard-stop). */
  percent: number | null;
  warnLevel: SpendCapWarnLevel;
}

export interface FreeAllowanceRemaining {
  aiChargeCents: number;
  recallMinutes: number;
  emailUnits: number;
  storageGb: number;
  acceptedSources: number;
}

export type BillingNudgeKind =
  | 'none'
  | 'approaching_cap'
  | 'at_cap'
  | 'free_near_limit'
  | 'free_exhausted'
  | 'suggest_payg'
  | 'suggest_commitment';

export interface BillingNudge {
  kind: BillingNudgeKind;
  title: string;
  body: string;
  href: string;
  ctaLabel: string;
}

export function spendCapUtilization(
  meteredSpendCents: number,
  spendCapCents: number,
): SpendCapUtilization {
  if (spendCapCents <= 0) {
    return {
      spendCapCents,
      meteredSpendCents,
      percent: null,
      warnLevel: meteredSpendCents > 0 ? 100 : null,
    };
  }
  const percent = Math.min(999, Math.round((meteredSpendCents / spendCapCents) * 100));
  let warnLevel: SpendCapWarnLevel = null;
  for (const threshold of SPEND_CAP_WARN_THRESHOLDS) {
    if (percent >= threshold) warnLevel = threshold;
  }
  return { spendCapCents, meteredSpendCents, percent, warnLevel };
}

export function freeAllowanceRemaining(meters: {
  ai?: { customerChargeCents: number } | null;
  recall_minutes?: { nativeUnits: number } | null;
  email_units?: { nativeUnits: number } | null;
  storage_gb_month?: { nativeUnits: number } | null;
  accepted_sources?: { nativeUnits: number } | null;
}): FreeAllowanceRemaining {
  return {
    aiChargeCents: Math.max(
      0,
      FREE_ALLOWANCES.aiChargeCents - (meters.ai?.customerChargeCents ?? 0),
    ),
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

function freeAllowanceExhausted(remaining: FreeAllowanceRemaining): boolean {
  return (
    remaining.aiChargeCents <= 0 ||
    remaining.recallMinutes <= 0 ||
    remaining.emailUnits <= 0 ||
    remaining.storageGb <= 0 ||
    remaining.acceptedSources <= 0
  );
}

function freeAllowanceNearLimit(remaining: FreeAllowanceRemaining): boolean {
  return (
    remaining.aiChargeCents <= FREE_ALLOWANCES.aiChargeCents * 0.25 ||
    remaining.recallMinutes <= FREE_ALLOWANCES.recallMinutes * 0.25 ||
    remaining.emailUnits <= FREE_ALLOWANCES.emailUnits * 0.25 ||
    remaining.acceptedSources <= FREE_ALLOWANCES.acceptedSources * 0.25
  );
}

/**
 * Quiet product nudge for Home / Usage / Billing. Prefer gray surfaces in UI;
 * never a mandatory upgrade gate.
 */
export function deriveBillingNudge(input: {
  planId: BillingPlanId;
  canManageBilling: boolean;
  utilization: SpendCapUtilization;
  freeRemaining: FreeAllowanceRemaining;
  meteredSpendCents: number;
}): BillingNudge | null {
  const billingHref = '/app/team?section=billing';
  const usageHref = '/app/usage';
  const manage = input.canManageBilling;

  if (input.planId === 'free') {
    if (freeAllowanceExhausted(input.freeRemaining)) {
      return {
        kind: 'free_exhausted',
        title: 'Free allowance used up',
        body: 'Reading, export, and billing stay available. Add a payment method to continue metered work under a spend cap.',
        href: manage ? billingHref : usageHref,
        ctaLabel: manage ? 'Add payment method' : 'View usage',
      };
    }
    if (freeAllowanceNearLimit(input.freeRemaining)) {
      return {
        kind: 'free_near_limit',
        title: 'Approaching Free allowance',
        body: 'Pay as you go keeps the Free monthly floor and only charges measured overage under your spend cap.',
        href: manage ? billingHref : usageHref,
        ctaLabel: manage ? 'Review billing' : 'View usage',
      };
    }
    return null;
  }

  if (input.utilization.warnLevel === 100) {
    return {
      kind: 'at_cap',
      title: 'Monthly spend cap reached',
      body: 'New cost-bearing work is paused. Raise the cap, top up, or wait for the next period. Existing data stays readable and exportable.',
      href: manage ? billingHref : usageHref,
      ctaLabel: manage ? 'Manage spend cap' : 'View usage',
    };
  }

  if (input.utilization.warnLevel === 90 || input.utilization.warnLevel === 75) {
    const pct = input.utilization.percent ?? input.utilization.warnLevel;
    return {
      kind: 'approaching_cap',
      title: `${pct}% of spend cap used`,
      body: `Metered this period: ${formatEuroFromCents(input.utilization.meteredSpendCents)} of ${formatEuroFromCents(input.utilization.spendCapCents)}.`,
      href: usageHref,
      ctaLabel: 'View usage',
    };
  }

  if (input.utilization.warnLevel === 50 && manage) {
    return {
      kind: 'approaching_cap',
      title: 'Halfway through this month’s spend cap',
      body: `You have used ${formatEuroFromCents(input.utilization.meteredSpendCents)} of ${formatEuroFromCents(input.utilization.spendCapCents)}.`,
      href: usageHref,
      ctaLabel: 'View usage',
    };
  }

  if (
    manage &&
    (input.planId === 'payg' || input.planId === 'team') &&
    input.meteredSpendCents >= PLAN_CATALOG.team.includedUsageDiscountCents * 0.7
  ) {
    const target = input.planId === 'payg' ? 'Team' : 'Business';
    return {
      kind: 'suggest_commitment',
      title: `Optional ${target} commitment`,
      body:
        input.planId === 'payg'
          ? 'Team includes members and up to €60 metered usage on the invoice — never a mandatory upgrade.'
          : 'Business includes more members and up to €250 metered usage on the invoice.',
      href: billingHref,
      ctaLabel: `Compare ${target}`,
    };
  }

  return null;
}

/** Native units (or AI charge cents) already consumed for free-plan hard stops. */
export function freeAllowanceConsumedForMeter(
  meterId: BillingMeterId,
  meters: Partial<
    Record<BillingMeterId, { nativeUnits: number; customerChargeCents: number } | undefined>
  >,
): { consumed: number; limit: number; unit: 'cents' | 'native' } | null {
  switch (meterId) {
    case 'ai':
      return {
        consumed: meters.ai?.customerChargeCents ?? 0,
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
