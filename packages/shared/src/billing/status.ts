import {
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  SPEND_CAP_WARN_THRESHOLDS,
  type BillingPlanId,
  formatEuroFromCents,
} from '#src/billing/catalog.js';

import type { BillingPresentation } from '#src/billing/presentation.js';

import { type FreeAllowanceRemaining, allFreeAllowancesExhausted } from '#src/billing/policy.js';
import {
  shouldShowPlanRecommendation,
  type CheapestPlanPreview,
} from '#src/billing/recommendation.js';

export {
  type FreeAllowanceRemaining,
  freeAllowanceRemaining,
  exhaustedFreeAllowanceNotice,
  allFreeAllowancesExhausted,
  billingStateAllowsReservation,
  type PaidActiveBillingState,
  billingStateForPaidPlan,
  restoredPaidBillingStateAfterWalletOrCapRecovery,
  restoredSpendCapCentsAfterShortfallUnfreeze,
  costBearingPausedFromAccount,
  freeAllowanceConsumedForMeter,
  freeAllowanceFloorCents,
} from '#src/billing/policy.js';

/**
 * Derived billing status for dashboards, upgrade nudges, and admission UX.
 */

export type SpendCapWarnLevel = (typeof SPEND_CAP_WARN_THRESHOLDS)[number] | null;

export interface SpendCapUtilization {
  spendCapCents: number;
  meteredSpendCents: number;
  /** 0–100+, null when there is no positive cap (Free hard-stop). */
  percent: number | null;
  warnLevel: SpendCapWarnLevel;
}

/** Live used/limit for catalog capacity that product gates actually enforce. */
export type PlanCapacityKind =
  | 'agent_turns'
  | 'concurrent_recall_bots'
  | 'custom_mcp_servers'
  | 'documents'
  | 'storage_gb'
  | 'indexed_chunks'
  | 'active_members';

export interface PlanCapacityUsageRow {
  kind: PlanCapacityKind;
  label: string;
  used: number;
  /** Null means no self-serve ceiling (Enterprise). */
  limit: number | null;
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

function freeAllowanceNearLimit(remaining: FreeAllowanceRemaining): boolean {
  return (
    remaining.aiChargeCents <= FREE_ALLOWANCES.aiChargeCents * 0.25 ||
    remaining.recallMinutes <= FREE_ALLOWANCES.recallMinutes * 0.25 ||
    remaining.emailUnits <= FREE_ALLOWANCES.emailUnits * 0.25 ||
    remaining.storageGb <= FREE_ALLOWANCES.storageGb * 0.25 ||
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
  planPreview?: CheapestPlanPreview;
}): BillingNudge | null {
  const billingHref = '/app/team?section=billing';
  const usageHref = '/app/usage';
  const manage = input.canManageBilling;

  if (input.planId === 'free') {
    if (allFreeAllowancesExhausted(input.freeRemaining)) {
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
      body: 'New cost-bearing work is paused. Raise the cap or wait for the next period. Existing data stays readable and exportable.',
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
    input.planPreview &&
    shouldShowPlanRecommendation(input.planPreview, input.planId)
  ) {
    const target = PLAN_CATALOG[input.planPreview.recommended];
    return {
      kind: 'suggest_commitment',
      title: `Compare ${target.name}`,
      body: 'Your recorded usage and member costs suggest this plan may cost less. Review the estimate before changing plans; future usage can differ.',
      href: billingHref,
      ctaLabel: 'Review estimate',
    };
  }

  return null;
}

export interface SidebarBillingSummary {
  presentation?: BillingPresentation;
  secondaryLabel?: string | null;
  resetLabel?: string;
  warningLabel?: string;
  planId: BillingPlanId;
  planName: string;
  /** 0–100 for the progress bar (capped visually). */
  progressPercent: number;
  /** True when progress is at/over the commercial limit. */
  atLimit: boolean;
  /** Primary line under the plan name, e.g. "€12 of €25" or "48% of Free". */
  detailLabel: string;
  /** Optional overage line, e.g. "+€4.20 overage". Null when none. */
  overageLabel: string | null;
  overageCents: number;
  href: string;
  canManageBilling: boolean;
}

/**
 * Compact sidebar view-model: plan name, usage progress, and overage hint.
 */
export function deriveSidebarBillingSummary(input: {
  planId: BillingPlanId;
  canManageBilling: boolean;
  meteredSpendCents: number;
  spendCapCents: number;
  /** Reserved for future discount-remaining progress; included discount uses catalog. */
  includedDiscountRemainingCents: number;
  freeRemaining: FreeAllowanceRemaining;
}): SidebarBillingSummary {
  const plan = PLAN_CATALOG[input.planId];
  const href = input.canManageBilling ? '/app/team?section=billing' : '/app/usage';

  if (input.planId === 'free') {
    const fractions = [
      1 - input.freeRemaining.aiChargeCents / FREE_ALLOWANCES.aiChargeCents,
      1 - input.freeRemaining.recallMinutes / FREE_ALLOWANCES.recallMinutes,
      1 - input.freeRemaining.emailUnits / FREE_ALLOWANCES.emailUnits,
      1 - input.freeRemaining.storageGb / FREE_ALLOWANCES.storageGb,
      1 - input.freeRemaining.acceptedSources / FREE_ALLOWANCES.acceptedSources,
    ];
    const worst = Math.max(0, ...fractions);
    const progressPercent = Math.min(100, Math.round(worst * 100));
    const atLimit = allFreeAllowancesExhausted(input.freeRemaining);
    return {
      planId: input.planId,
      planName: plan.name,
      progressPercent,
      atLimit,
      detailLabel: atLimit ? 'Allowance used up' : `${progressPercent}% of Free`,
      overageLabel: null,
      overageCents: 0,
      href,
      canManageBilling: input.canManageBilling,
    };
  }

  const includedDiscount = plan.includedUsageDiscountCents;
  const overageCents =
    input.planId === 'payg'
      ? Math.max(0, input.meteredSpendCents)
      : Math.max(0, input.meteredSpendCents - includedDiscount);

  // Prefer spend-cap progress when a positive cap exists; otherwise show metered vs discount.
  const utilization = spendCapUtilization(input.meteredSpendCents, input.spendCapCents);
  let progressPercent: number;
  let detailLabel: string;
  let atLimit: boolean;

  if (input.spendCapCents > 0) {
    progressPercent = Math.min(100, utilization.percent ?? 0);
    atLimit = (utilization.percent ?? 0) >= 100;
    detailLabel = `${formatEuroFromCents(input.meteredSpendCents)} of ${formatEuroFromCents(input.spendCapCents)} cap`;
  } else if (includedDiscount > 0) {
    progressPercent = Math.min(100, Math.round((input.meteredSpendCents / includedDiscount) * 100));
    atLimit = input.meteredSpendCents >= includedDiscount;
    detailLabel = `${formatEuroFromCents(input.meteredSpendCents)} of ${formatEuroFromCents(includedDiscount)} included`;
  } else {
    progressPercent =
      input.meteredSpendCents > 0
        ? Math.min(100, 40 + Math.round(input.meteredSpendCents / 100))
        : 0;
    atLimit = false;
    detailLabel =
      input.meteredSpendCents > 0
        ? `${formatEuroFromCents(input.meteredSpendCents)} metered`
        : 'No usage yet';
  }

  const overageLabel = overageCents > 0 ? `+${formatEuroFromCents(overageCents)} overage` : null;

  return {
    planId: input.planId,
    planName: plan.name,
    progressPercent,
    atLimit,
    detailLabel,
    overageLabel,
    overageCents,
    href,
    canManageBilling: input.canManageBilling,
  };
}

/** Shared periods and balances drive the compact view too; no invoice estimates. */
export function applyBillingPresentationToSidebar(
  summary: SidebarBillingSummary,
  presentation: BillingPresentation,
): void {
  summary.presentation = presentation;
  const capLabel = presentation.cap.applicable
    ? `${formatEuroFromCents(presentation.cap.usedCents)} of ${formatEuroFromCents(presentation.cap.limitCents)} monthly cap`
    : presentation.cap.exemption === 'enterprise_contract'
      ? 'Contract spending limits'
      : 'No enforced spend cap';
  if (presentation.planId !== 'free') summary.atLimit = presentation.cap.reached;
  delete summary.warningLabel;
  const reset =
    presentation.credit.status === 'available'
      ? presentation.credit.period?.end
      : presentation.calendarPeriod.end;
  if (reset)
    summary.resetLabel = `${presentation.credit.status === 'available' ? 'Credit renews' : 'Month resets'} ${new Date(reset).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} (UTC)`;
  if (presentation.planId !== 'free' && presentation.cap.reached)
    summary.warningLabel = 'Spend cap reached';

  if (presentation.planId === 'free') {
    summary.detailLabel = `${summary.progressPercent}% of most-used allowance`;
    summary.secondaryLabel = 'View remaining allowances';
    summary.href = '/app/usage';
  } else if (presentation.comped) {
    summary.detailLabel = 'Comped · no usage charges';
    summary.secondaryLabel = capLabel;
  } else if (presentation.credit.status !== 'not_applicable') {
    summary.detailLabel =
      presentation.credit.status === 'available' && presentation.credit.remainingCents !== null
        ? `${formatEuroFromCents(presentation.credit.remainingCents)} credit remaining`
        : 'Updating billing period';
    summary.progressPercent =
      presentation.credit.status === 'available' &&
      presentation.credit.usedCents !== null &&
      presentation.credit.totalCents > 0
        ? Math.round((presentation.credit.usedCents / presentation.credit.totalCents) * 100)
        : 0;
    summary.secondaryLabel = capLabel;
  } else {
    summary.detailLabel = capLabel;
    if (!presentation.cap.applicable) summary.progressPercent = 0;
    summary.secondaryLabel = presentation.planId === 'payg' ? 'View remaining allowances' : null;
  }
}
