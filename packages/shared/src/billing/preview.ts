import { PLAN_CATALOG, type BillingMeterId, type BillingPlanId } from '#src/billing/catalog.js';
import {
  daysInPeriodYm,
  listChargeCentsForMeter,
  memberDaysChargeCents,
  paygOverageCustomerChargeCents,
  periodYmUtc,
  type MeterTotals,
} from '#src/billing/charge.js';
import { applyMeteredDiscountCents } from '#src/billing/operator.js';
import { freeAllowanceFloorCents } from '#src/billing/status.js';

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

function extraMembers(activeMembers: number, included: number | null): number {
  if (included === null) return 0;
  return Math.max(0, activeMembers - included);
}

export function grossListChargeCentsFromMeters(meters: MeterTotals): number {
  let sum = 0;
  for (const [meterId, row] of Object.entries(meters)) {
    if (!row) continue;
    const id = meterId as BillingMeterId;
    if (id === 'member_days') continue;
    sum += listChargeCentsForMeter(id, row.nativeUnits);
  }
  return sum;
}

function paygOverageFromMeters(meters: MeterTotals): number {
  let sum = 0;
  for (const [meterId, row] of Object.entries(meters)) {
    if (!row) continue;
    const id = meterId as BillingMeterId;
    if (id === 'member_days') continue;
    const listChargeCents = listChargeCentsForMeter(id, row.nativeUnits);
    sum += paygOverageCustomerChargeCents({
      planId: 'payg',
      meterId: id,
      nativeUnits: row.nativeUnits,
      listChargeCents,
      meters: {},
    });
  }
  return sum;
}

function memberDayPreviewChargeCents(extraMemberDays: number, centsPerMemberMonth: number): number {
  return memberDaysChargeCents({
    extraMemberDays,
    centsPerMemberMonth,
    daysInMonth: daysInPeriodYm(periodYmUtc()),
  });
}

function extraMemberCentsForPreview(input: {
  extraMembers: number;
  additionalMemberCents: number;
  activeMembers: number;
  includedActiveMembers: number | null;
  meters?: MeterTotals;
  billableMemberDays?: number;
}): number {
  if (input.extraMembers <= 0 || input.additionalMemberCents <= 0) return 0;
  const nativeUnits = input.meters?.member_days?.nativeUnits;
  const currentExtra = extraMembers(input.activeMembers, input.includedActiveMembers);
  if (typeof nativeUnits === 'number' && currentExtra > 0) {
    const scaledDays = nativeUnits * (input.extraMembers / currentExtra);
    return memberDayPreviewChargeCents(scaledDays, input.additionalMemberCents);
  }
  if (typeof input.billableMemberDays === 'number' && input.activeMembers > 0) {
    const extraDays = (input.billableMemberDays * input.extraMembers) / input.activeMembers;
    return memberDayPreviewChargeCents(extraDays, input.additionalMemberCents);
  }
  if (typeof nativeUnits === 'number') {
    return 0;
  }
  return input.extraMembers * input.additionalMemberCents;
}

export interface PlanCommercialOverride {
  platformFeeCents?: number | null;
  includedActiveMembers?: number | null;
  additionalMemberCents?: number | null;
  meteredDiscountPercent?: number | null;
}

function billForPlan(input: {
  planId: SelfServePaidPlanId;
  activeMembers: number;
  meteredSpendCents: number;
  meters?: MeterTotals;
  includedActiveMembers?: number | null;
  billableMemberDays?: number;
  terms?: PlanCommercialOverride;
}): PlanBillPreview {
  const plan = PLAN_CATALOG[input.planId];
  const includedSeats = input.terms?.includedActiveMembers ?? plan.includedActiveMembers;
  const extra = extraMembers(input.activeMembers, includedSeats);
  const extraMemberCents = extraMemberCentsForPreview({
    extraMembers: extra,
    additionalMemberCents: input.terms?.additionalMemberCents ?? plan.additionalMemberCents ?? 0,
    activeMembers: input.activeMembers,
    includedActiveMembers: input.includedActiveMembers ?? PLAN_CATALOG.payg.includedActiveMembers,
    ...(input.meters !== undefined ? { meters: input.meters } : {}),
    ...(input.billableMemberDays !== undefined
      ? { billableMemberDays: input.billableMemberDays }
      : {}),
  });
  // Settlement applies the metered percentage to the gross list charge, then
  // subtracts included credit. Preview uses that same order.
  const meteredAfterDiscountCents = Math.max(
    0,
    applyMeteredDiscountCents(input.meteredSpendCents, input.terms?.meteredDiscountPercent) -
      plan.includedUsageDiscountCents,
  );
  const platformFeeCents = input.terms?.platformFeeCents ?? plan.platformFeeCents ?? 0;
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
 *
 * Prefer `meters` (period native totals). `meteredSpendCents` is treated as
 * gross list charge when meters are omitted (tests / fallback).
 */
export function cheapestPlanPreview(input: {
  activeMembers: number;
  meters?: MeterTotals;
  meteredSpendCents?: number;
  /** Current plan included seats; used to prorate extra-member preview from member-days. */
  includedActiveMembers?: number | null;
  /** All recorded person-days this period (not only current-plan extras). */
  billableMemberDays?: number;
  /** Per-plan commercial overrides. Other plans stay on the catalog. */
  planTerms?: Partial<Record<SelfServePaidPlanId, PlanCommercialOverride>>;
}): CheapestPlanPreview {
  const gross = input.meters
    ? grossListChargeCentsFromMeters(input.meters)
    : Math.max(0, input.meteredSpendCents ?? 0);
  const paygMetered = input.meters
    ? paygOverageFromMeters(input.meters)
    : Math.max(0, gross - freeAllowanceFloorCents());
  const shared = {
    activeMembers: input.activeMembers,
    ...(input.meters !== undefined ? { meters: input.meters } : {}),
    ...(input.includedActiveMembers !== undefined
      ? { includedActiveMembers: input.includedActiveMembers }
      : {}),
    ...(input.billableMemberDays !== undefined
      ? { billableMemberDays: input.billableMemberDays }
      : {}),
  };
  const bills = {
    payg: billForPlan({
      planId: 'payg',
      meteredSpendCents: paygMetered,
      ...shared,
      ...(input.planTerms?.payg ? { terms: input.planTerms.payg } : {}),
    }),
    team: billForPlan({
      planId: 'team',
      meteredSpendCents: gross,
      ...shared,
      ...(input.planTerms?.team ? { terms: input.planTerms.team } : {}),
    }),
    business: billForPlan({
      planId: 'business',
      meteredSpendCents: gross,
      ...shared,
      ...(input.planTerms?.business ? { terms: input.planTerms.business } : {}),
    }),
  };
  let recommended: SelfServePaidPlanId = 'payg';
  for (const id of ['team', 'business'] as const) {
    if (bills[id].totalCents < bills[recommended].totalCents) recommended = id;
  }
  return { recommended, bills };
}

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
