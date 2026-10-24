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
  if (remaining <= 0 && allowance.unit !== 'cents') return Math.max(0, input.listChargeCents);
  if (allowance.unit === 'cents') {
    // Difference of rounded cumulative totals above the allowance. Subtracting
    // the fractional remainder from an already-rounded list delta is not an
    // integer (499.4 → 499.6 is still inside the €5 floor).
    const previousGross = Math.max(0, allowance.consumed);
    const nextGross = previousGross + Math.max(0, input.nativeUnits);
    return (
      roundedPostAllowanceCents(nextGross, allowance.limit) -
      roundedPostAllowanceCents(previousGross, allowance.limit)
    );
  }
  const overageUnits = Math.max(0, input.nativeUnits - remaining);
  if (overageUnits <= 0) return 0;
  return listChargeCentsForMeter(input.meterId, overageUnits);
}

function roundedPostAllowanceCents(grossCents: number, allowanceLimitCents: number): number {
  return Math.max(0, Math.round(grossCents) - allowanceLimitCents);
}

export type PolarRefundAmountKind = 'incremental' | 'cumulative';

function metadataPositiveCents(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): number {
  const value = metadata?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

/** Prior wallet reversals for one top-up, split into debited cents and reported totals. */
export function summedPolarRefundReversals(
  rows: readonly { operationId: string; metadata: Record<string, unknown> | null }[],
  refundOperationId: string,
): {
  duplicate: boolean;
  alreadyDebitedCents: number;
  incrementalReportedCents: number;
  cumulativeReportedCents: number;
} {
  if (rows.some((row) => row.operationId === refundOperationId)) {
    return {
      duplicate: true,
      alreadyDebitedCents: 0,
      incrementalReportedCents: 0,
      cumulativeReportedCents: 0,
    };
  }
  let alreadyDebitedCents = 0;
  let incrementalReportedCents = 0;
  let cumulativeReportedCents = 0;
  for (const row of rows) {
    const metadata = row.metadata ?? {};
    const debited = metadataPositiveCents(metadata, 'cents');
    alreadyDebitedCents += debited;
    const reported = metadataPositiveCents(metadata, 'reported_cents') || debited;
    if (reported <= 0) continue;
    if (metadata.amount_kind === 'cumulative') {
      cumulativeReportedCents = Math.max(cumulativeReportedCents, reported);
    } else {
      incrementalReportedCents += reported;
    }
  }
  return {
    duplicate: false,
    alreadyDebitedCents,
    incrementalReportedCents,
    cumulativeReportedCents,
  };
}

/**
 * Wallet cents still to claw back for one Polar refund event.
 * `order.refunded` reports a cumulative refunded total. `refund.created` reports
 * that refund's own amount. The target is the larger of those figures, capped
 * at the original top-up, minus reversals already recorded.
 */
export function reconciledPolarRefundClawbackCents(input: {
  originalCents: number;
  alreadyDebitedCents: number;
  incrementalReportedCents: number;
  cumulativeReportedCents: number;
  incomingKind: PolarRefundAmountKind;
  incomingReportedCents: number;
}): number {
  const original = Math.max(0, Math.round(input.originalCents));
  const already = Math.max(0, Math.round(input.alreadyDebitedCents));
  const incoming = input.incomingReportedCents > 0 ? Math.round(input.incomingReportedCents) : 0;
  let incremental = Math.max(0, input.incrementalReportedCents);
  let cumulative = Math.max(0, input.cumulativeReportedCents);
  if (incoming > 0) {
    if (input.incomingKind === 'cumulative') cumulative = Math.max(cumulative, incoming);
    else incremental += incoming;
  }
  const target = incoming > 0 ? Math.min(original, Math.max(incremental, cumulative)) : original;
  return Math.max(0, target - already);
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

/** UTC days in `YYYY-MM`. Invalid periods use 31 so a bad key cannot divide by zero. */
export function daysInPeriodYm(periodYm: string): number {
  const match = /^(\d{4})-(\d{2})$/u.exec(periodYm);
  if (!match) return 31;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 31;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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
 * Prepaid wallet and included discount already collect locally, including
 * sub-cent rounds that settle at €0. Polar meters invoice the same native
 * units, so ingest only when Polar is the sole collector (Enterprise).
 */
export function shouldIngestPolarMeteredUsage(input: {
  eventName: string | null | undefined;
  polarCustomerId: string | null | undefined;
  shadowBilling: boolean;
  billable: boolean;
  polarUnits: number;
  walletCents: number;
  discountCents: number;
  enterpriseContract: boolean;
}): boolean {
  if (!input.eventName || !input.polarCustomerId) return false;
  if (input.shadowBilling || !input.billable) return false;
  if (input.polarUnits <= 0) return false;
  if (!input.enterpriseContract) return false;
  if (input.walletCents > 0 || input.discountCents > 0) return false;
  return true;
}

export function periodYmUtc(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The live spend cap applies to the current UTC period. A prior-month
 * settlement still records that month's counters; only a positive charge in
 * the current period can exceed the cap. A span that crosses into the current
 * period counts that slice alone.
 */
export function currentPeriodSpendCapExceeded(input: {
  currentPeriodYm: string;
  spendCapCents: number;
  segments: readonly { periodYm: string; chargeCents: number }[];
  counterChargeCents: readonly { periodYm: string; chargeCents: number }[];
}): boolean {
  const addedCents = input.segments.reduce(
    (sum, row) =>
      row.periodYm === input.currentPeriodYm ? sum + Math.max(0, row.chargeCents) : sum,
    0,
  );
  if (addedCents <= 0) return false;
  const alreadyCents = input.counterChargeCents.reduce(
    (sum, row) => (row.periodYm === input.currentPeriodYm ? sum + row.chargeCents : sum),
    0,
  );
  return alreadyCents + addedCents > input.spendCapCents;
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
      if (last?.periodYm === ym) last.nativeUnits += nativeUnits;
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

function utcMonthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** Keep the subscription anchor day. Shorter months clamp, then later months restore it. */
function addUtcMonths(anchor: Date, months: number, anchorDay: number): Date {
  const monthIndex = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchorDay, lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

/**
 * Advance a closed subscription window by its calendar-month span, using the
 * original anchor day. A February window therefore renews on the same day in
 * March, not one short month later. Returns null while the window is open.
 */
export function nextIncludedDiscountPeriod(input: {
  now: Date;
  periodStartedAt: Date | null;
  periodEndsAt: Date | null;
}): { periodStartedAt: Date; periodEndsAt: Date } | null {
  if (input.periodEndsAt && input.periodEndsAt > input.now) return null;
  if (input.periodStartedAt && input.periodEndsAt) {
    const anchorDay = input.periodStartedAt.getUTCDate();
    const span = Math.max(
      1,
      utcMonthIndex(input.periodEndsAt) - utcMonthIndex(input.periodStartedAt),
    );
    let steps = span;
    let periodStart = addUtcMonths(input.periodStartedAt, steps - span, anchorDay);
    let periodEnd = addUtcMonths(input.periodStartedAt, steps, anchorDay);
    while (periodEnd <= input.now && steps < span + 1200) {
      steps += span;
      periodStart = addUtcMonths(input.periodStartedAt, steps - span, anchorDay);
      periodEnd = addUtcMonths(input.periodStartedAt, steps, anchorDay);
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
