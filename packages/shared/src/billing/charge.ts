import {
  acceptedSourcesChargeCents,
  emailChargeCents,
  recallChargeCents,
  storageChargeCents,
  type BillingMeterId,
  type BillingPlanId,
} from '#src/billing/catalog.js';
import { freeAllowanceConsumedForMeter } from '#src/billing/status.js';

export type MeterTotals = Partial<
  Record<BillingMeterId, { nativeUnits: number; customerChargeCents: number } | undefined>
>;

/**
 * PAYG keeps the Free native floor; only overage is wallet/Polar-billable.
 * Free hard-stops separately. Team/Business use included invoice discount.
 */
export function paygOverageNativeUnits(input: {
  planId: BillingPlanId;
  meterId: BillingMeterId;
  nativeUnits: number;
  meters: MeterTotals;
}): number {
  if (input.planId !== 'payg') return Math.max(0, input.nativeUnits);
  const allowance = freeAllowanceConsumedForMeter(input.meterId, input.meters);
  if (!allowance) return Math.max(0, input.nativeUnits);
  const remaining = Math.max(0, allowance.limit - allowance.consumed);
  return Math.max(0, input.nativeUnits - remaining);
}

export function paygOverageCustomerChargeCents(input: {
  planId: BillingPlanId;
  meterId: BillingMeterId;
  nativeUnits: number;
  listChargeCents: number;
  meters: MeterTotals;
}): number {
  if (input.planId !== 'payg') return Math.max(0, input.listChargeCents);
  const allowance = freeAllowanceConsumedForMeter(input.meterId, input.meters);
  if (!allowance) return Math.max(0, input.listChargeCents);
  const remaining = Math.max(0, allowance.limit - allowance.consumed);
  if (remaining <= 0) return Math.max(0, input.listChargeCents);
  if (allowance.unit === 'cents') {
    return Math.max(0, input.listChargeCents - remaining);
  }
  const overageUnits = Math.max(0, input.nativeUnits - remaining);
  if (overageUnits <= 0) return 0;
  return listChargeCentsForMeter(input.meterId, overageUnits);
}

/** Cumulative extra-member-day charge so daily rounding still totals €2/member-month. */
export function memberDaysChargeCents(input: {
  extraMemberDays: number;
  centsPerMemberMonth: number;
  daysInMonth: number;
}): number {
  if (input.extraMemberDays <= 0 || input.centsPerMemberMonth <= 0 || input.daysInMonth <= 0) {
    return 0;
  }
  return Math.round((input.extraMemberDays * input.centsPerMemberMonth) / input.daysInMonth);
}

export function listChargeCentsForMeter(meterId: BillingMeterId, nativeUnits: number): number {
  switch (meterId) {
    case 'ai':
      return Math.max(0, Math.round(nativeUnits));
    case 'member_days':
      return memberDaysChargeCents({
        extraMemberDays: nativeUnits,
        centsPerMemberMonth: 200,
        daysInMonth: new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0),
        ).getUTCDate(),
      });
    case 'recall_minutes':
      return recallChargeCents(nativeUnits);
    case 'email_units':
      return emailChargeCents(nativeUnits);
    case 'storage_gb_month':
      return storageChargeCents(nativeUnits);
    case 'accepted_sources':
      return acceptedSourcesChargeCents(nativeUnits);
  }
}

/** Discount covers first; wallet funds the remainder. */
export function splitDiscountAndWallet(input: {
  chargeCents: number;
  includedDiscountRemainingCents: number;
}): { discountCents: number; walletCents: number } {
  const chargeCents = Math.max(0, input.chargeCents);
  const discountCents = Math.min(Math.max(0, input.includedDiscountRemainingCents), chargeCents);
  return { discountCents, walletCents: chargeCents - discountCents };
}

/**
 * Cumulative-vs-already-charged delta so fractional native units (0.05¢/source,
 * 0.25¢/email) still settle whole cents instead of rounding each unit to 0.
 */
export function cumulativeChargeDeltaCents(input: {
  meterId: BillingMeterId;
  previousNativeUnits: number;
  nextNativeUnits: number;
}): number {
  const previous = listChargeCentsForMeter(input.meterId, input.previousNativeUnits);
  const next = listChargeCentsForMeter(input.meterId, input.nextNativeUnits);
  return Math.max(0, next - previous);
}

export function walletReservedCentsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallbackChargeCents: number,
): number {
  const raw = metadata?.wallet_reserved_cents;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  return Math.max(0, fallbackChargeCents);
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}
