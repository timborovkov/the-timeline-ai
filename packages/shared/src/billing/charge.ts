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

/** Discount covers first; wallet funds the remainder. Extra member-days are wallet-only. */
export function splitDiscountAndWallet(input: {
  chargeCents: number;
  includedDiscountRemainingCents: number;
  meterId?: BillingMeterId;
}): { discountCents: number; walletCents: number } {
  const chargeCents = Math.max(0, input.chargeCents);
  if (input.meterId === 'member_days') {
    return { discountCents: 0, walletCents: chargeCents };
  }
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

export function metadataNonNegativeInteger(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  fallback = 0,
): number {
  const raw = metadata?.[key];
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  return Math.max(0, fallback);
}

/** Cents actually added to `reservedBalanceCents` when this reservation was created. */
export function walletLockCentsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): number {
  return metadataNonNegativeInteger(metadata, 'wallet_lock_cents', 0);
}

export function pendingListChargeCents(
  metadata: Record<string, unknown> | null | undefined,
  fallbackChargeCents: number,
): number {
  return metadataNonNegativeInteger(metadata, 'list_charge_cents', fallbackChargeCents);
}

export function pendingBillableChargeCents(
  metadata: Record<string, unknown> | null | undefined,
  fallbackChargeCents: number,
): number {
  const raw = metadata?.billable_charge_cents;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  return pendingListChargeCents(metadata, fallbackChargeCents);
}

export function pendingDiscountReservedCents(
  metadata: Record<string, unknown> | null | undefined,
): number {
  return metadataNonNegativeInteger(metadata, 'discount_reserved_cents', 0);
}

/** Fold in-flight reservations into settled meter totals for admission. */
export function metersPlusPendingReservations(
  meters: MeterTotals,
  pending: readonly {
    meterId: BillingMeterId;
    reservedNativeUnits: string | number;
    reservedChargeCents: number;
    metadata: Record<string, unknown> | null;
  }[],
): MeterTotals {
  const next: MeterTotals = { ...meters };
  for (const row of pending) {
    const current = next[row.meterId] ?? { nativeUnits: 0, customerChargeCents: 0 };
    const list = pendingListChargeCents(row.metadata, row.reservedChargeCents);
    next[row.meterId] = {
      nativeUnits: current.nativeUnits + Number(row.reservedNativeUnits),
      customerChargeCents: current.customerChargeCents + list,
    };
  }
  return next;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}

/**
 * Prepaid wallet and included discount already collect locally. Polar meters
 * invoice the same native units, so ingest only when Polar would be the sole
 * collector (no wallet or included-discount debit).
 */
export function shouldIngestPolarMeteredUsage(input: {
  eventName: string | null | undefined;
  polarCustomerId: string | null | undefined;
  shadowBilling: boolean;
  billable: boolean;
  polarUnits: number;
  walletCents: number;
  discountCents: number;
}): boolean {
  if (!input.eventName || !input.polarCustomerId) return false;
  if (input.shadowBilling || !input.billable) return false;
  if (input.polarUnits <= 0) return false;
  if (input.walletCents > 0 || input.discountCents > 0) return false;
  return true;
}

export function periodYmUtc(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Split duration-based native units across UTC month boundaries so a Recall
 * meeting that crosses midnight on the 1st is not charged wholly to the new
 * month. Non-duration meters stay in the operation's start period.
 */
export function splitDurationNativeUnitsByUtcMonth(input: {
  startedAt: Date;
  nativeUnits: number;
  unitMs: number;
}): { periodYm: string; nativeUnits: number }[] {
  const total = Math.max(0, input.nativeUnits);
  if (!(input.startedAt instanceof Date) || Number.isNaN(input.startedAt.getTime())) {
    return [{ periodYm: periodYmUtc(), nativeUnits: total }];
  }
  if (total === 0 || input.unitMs <= 0) {
    return [{ periodYm: periodYmUtc(input.startedAt), nativeUnits: total }];
  }
  const startMs = input.startedAt.getTime();
  const endMs = startMs + total * input.unitMs;
  const segments: { periodYm: string; nativeUnits: number }[] = [];
  let cursorMs = startMs;
  let remaining = total;
  while (remaining > 0) {
    const cursor = new Date(cursorMs);
    const ym = periodYmUtc(cursor);
    const nextMonthMs = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
    const sliceEndMs = Math.min(endMs, nextMonthMs);
    const rawUnits = Math.max(0, (sliceEndMs - cursorMs) / input.unitMs);
    const isLast = sliceEndMs >= endMs;
    const nativeUnits = isLast ? remaining : Math.min(remaining, Math.floor(rawUnits));
    if (nativeUnits > 0 || segments.length === 0) {
      const last = segments.at(-1);
      if (last && last.periodYm === ym) last.nativeUnits += nativeUnits;
      else segments.push({ periodYm: ym, nativeUnits });
      remaining -= nativeUnits;
    }
    if (isLast || nextMonthMs <= cursorMs) {
      if (remaining > 0) {
        const last = segments.at(-1);
        if (last) last.nativeUnits += remaining;
        else segments.push({ periodYm: ym, nativeUnits: remaining });
        remaining = 0;
      }
      break;
    }
    cursorMs = nextMonthMs;
  }
  return segments.filter((row) => row.nativeUnits > 0 || segments.length === 1);
}

export function settlementSegmentsForMeter(input: {
  meterId: BillingMeterId;
  nativeUnits: number;
  startedAt: Date;
}): { periodYm: string; nativeUnits: number }[] {
  if (input.meterId === 'recall_minutes') {
    return splitDurationNativeUnitsByUtcMonth({
      startedAt: input.startedAt,
      nativeUnits: input.nativeUnits,
      unitMs: 60_000,
    });
  }
  return [{ periodYm: periodYmUtc(input.startedAt), nativeUnits: Math.max(0, input.nativeUnits) }];
}

/**
 * Advance from the stored Polar/subscription window instead of snapping to
 * UTC calendar months. Returns null while the current window is still open.
 */
export function nextIncludedDiscountPeriod(input: {
  now: Date;
  periodStartedAt: Date | null;
  periodEndsAt: Date | null;
}): { periodStartedAt: Date; periodEndsAt: Date } | null {
  if (input.periodEndsAt && input.periodEndsAt > input.now) return null;
  if (input.periodStartedAt && input.periodEndsAt) {
    const durationMs = input.periodEndsAt.getTime() - input.periodStartedAt.getTime();
    const duration = durationMs > 0 ? durationMs : 31 * 24 * 60 * 60 * 1000;
    let periodStart = input.periodEndsAt;
    let periodEnd = new Date(periodStart.getTime() + duration);
    while (periodEnd <= input.now) {
      periodStart = periodEnd;
      periodEnd = new Date(periodStart.getTime() + duration);
    }
    return { periodStartedAt: periodStart, periodEndsAt: periodEnd };
  }
  const periodStartedAt = new Date(
    Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), 1),
  );
  const periodEndsAt = new Date(
    Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth() + 1, 1),
  );
  return { periodStartedAt, periodEndsAt };
}
