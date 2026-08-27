import { PLAN_CATALOG, type BillingMeterId, type BillingPlanId } from '#src/billing/catalog.js';
import {
  listChargeCentsForMeter,
  paygOverageCustomerChargeCents,
  type MeterTotals,
} from '#src/billing/charge.js';
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

function extraMemberCentsForPreview(input: {
  extraMembers: number;
  additionalMemberCents: number;
  activeMembers: number;
  includedActiveMembers: number | null;
  meters?: MeterTotals;
}): number {
  if (input.extraMembers <= 0 || input.additionalMemberCents <= 0) return 0;
  const nativeUnits = input.meters?.member_days?.nativeUnits;
  if (typeof nativeUnits !== 'number') {
    return input.extraMembers * input.additionalMemberCents;
  }
  const currentCharge = listChargeCentsForMeter('member_days', nativeUnits);
  const currentExtra = extraMembers(input.activeMembers, input.includedActiveMembers);
  if (currentExtra <= 0) {
    return input.extraMembers * input.additionalMemberCents;
  }
  return Math.round(currentCharge * (input.extraMembers / currentExtra));
}

function billForPlan(input: {
  planId: SelfServePaidPlanId;
  activeMembers: number;
  meteredSpendCents: number;
  meters?: MeterTotals;
  includedActiveMembers?: number | null;
}): PlanBillPreview {
  const plan = PLAN_CATALOG[input.planId];
  const extra = extraMembers(input.activeMembers, plan.includedActiveMembers);
  const extraMemberCents = extraMemberCentsForPreview({
    extraMembers: extra,
    additionalMemberCents: plan.additionalMemberCents ?? 0,
    activeMembers: input.activeMembers,
    includedActiveMembers: input.includedActiveMembers ?? PLAN_CATALOG.payg.includedActiveMembers,
    ...(input.meters !== undefined ? { meters: input.meters } : {}),
  });
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
}): CheapestPlanPreview {
  const gross = input.meters
    ? grossListChargeCentsFromMeters(input.meters)
    : Math.max(0, input.meteredSpendCents ?? 0);
  const paygMetered = input.meters
    ? paygOverageFromMeters(input.meters)
    : Math.max(0, gross - freeAllowanceFloorCents());
  const bills = {
    payg: billForPlan({
      planId: 'payg',
      activeMembers: input.activeMembers,
      meteredSpendCents: paygMetered,
      ...(input.meters !== undefined ? { meters: input.meters } : {}),
      ...(input.includedActiveMembers !== undefined
        ? { includedActiveMembers: input.includedActiveMembers }
        : {}),
    }),
    team: billForPlan({
      planId: 'team',
      activeMembers: input.activeMembers,
      meteredSpendCents: gross,
      ...(input.meters !== undefined ? { meters: input.meters } : {}),
      ...(input.includedActiveMembers !== undefined
        ? { includedActiveMembers: input.includedActiveMembers }
        : {}),
    }),
    business: billForPlan({
      planId: 'business',
      activeMembers: input.activeMembers,
      meteredSpendCents: gross,
      ...(input.meters !== undefined ? { meters: input.meters } : {}),
      ...(input.includedActiveMembers !== undefined
        ? { includedActiveMembers: input.includedActiveMembers }
        : {}),
    }),
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
