import {
  OVERAGE_RATES,
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
 * PAYG keeps the Free native floor; only overage is Polar-billable.
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

/** Cumulative extra-member-day charge so daily rounding still totals the member-month price. */
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

/**
 * One extra member-day's cent delta. The divisor is the counter's period, not
 * the calendar day being backfilled, so a month of deltas still totals the price.
 */
export function memberDayChargeDelta(input: {
  previousNativeUnits: number;
  nextNativeUnits: number;
  centsPerMemberMonth: number;
  daysInMonth: number;
}): number {
  const previous = memberDaysChargeCents({
    extraMemberDays: input.previousNativeUnits,
    centsPerMemberMonth: input.centsPerMemberMonth,
    daysInMonth: input.daysInMonth,
  });
  const next = memberDaysChargeCents({
    extraMemberDays: input.nextNativeUnits,
    centsPerMemberMonth: input.centsPerMemberMonth,
    daysInMonth: input.daysInMonth,
  });
  return Math.max(0, next - previous);
}

export function listChargeCentsForMeter(meterId: BillingMeterId, nativeUnits: number): number {
  switch (meterId) {
    case 'ai':
      return Math.max(0, Math.round(nativeUnits));
    case 'member_days':
      return memberDaysChargeCents({
        extraMemberDays: nativeUnits,
        centsPerMemberMonth: OVERAGE_RATES.additionalMemberCentsPerMonth,
        daysInMonth: daysInPeriodYm(periodYmUtc()),
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

/**
 * Included invoice discount covers usage meters first. Polar invoices the
 * remainder on the card. Extra member-days skip that discount: they are a
 * separate Polar meter and still count on the local spend cap.
 */
export function splitDiscountAndWallet(input: {
  chargeCents: number;
  includedDiscountRemainingCents: number;
  meterId?: BillingMeterId;
}): { discountCents: number; invoiceCents: number } {
  const chargeCents = Math.max(0, input.chargeCents);
  if (input.meterId === 'member_days') {
    return { discountCents: 0, invoiceCents: chargeCents };
  }
  const discountCents = Math.min(Math.max(0, input.includedDiscountRemainingCents), chargeCents);
  return { discountCents, invoiceCents: chargeCents - discountCents };
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

/**
 * Cumulative customer charge before a percentage discount. PAYG subtracts the
 * Free floor from the running total. Member-days use the commercial price.
 * Discount the two cumulatives and settle the difference so a 1¢ delta is not
 * rounded back up to 1¢ on every call.
 */
export function cumulativeBillableChargeCents(input: {
  planId: BillingPlanId;
  meterId: BillingMeterId;
  nativeUnits: number;
  centsPerMemberMonth: number;
  daysInMonth: number;
}): number {
  if (input.meterId === 'member_days') {
    return memberDaysChargeCents({
      extraMemberDays: input.nativeUnits,
      centsPerMemberMonth: input.centsPerMemberMonth,
      daysInMonth: input.daysInMonth,
    });
  }
  const nativeUnits = Math.max(0, input.nativeUnits);
  if (input.planId !== 'payg') return listChargeCentsForMeter(input.meterId, nativeUnits);
  const allowance = freeAllowanceConsumedForMeter(input.meterId, {});
  if (!allowance) return listChargeCentsForMeter(input.meterId, nativeUnits);
  if (allowance.unit === 'cents') {
    return Math.max(0, listChargeCentsForMeter(input.meterId, nativeUnits) - allowance.limit);
  }
  const overageUnits = Math.max(0, nativeUnits - allowance.limit);
  if (overageUnits <= 0) return 0;
  return listChargeCentsForMeter(input.meterId, overageUnits);
}

/** Catalog price as integer cents per `units`, so sub-cent meters do not use floats. */
function catalogUnitPrice(meterId: BillingMeterId): { cents: number; units: number } {
  switch (meterId) {
    case 'ai':
      return { cents: 1, units: 1 };
    case 'recall_minutes':
      return { cents: OVERAGE_RATES.recallCentsPerMinute, units: 1 };
    case 'email_units':
      return { cents: OVERAGE_RATES.emailCentsPerThousandUnits, units: 1000 };
    case 'storage_gb_month':
      return { cents: OVERAGE_RATES.storageCentsPerGbMonth, units: 1 };
    case 'accepted_sources':
      return { cents: OVERAGE_RATES.acceptedSourcesCentsPerThousand, units: 1000 };
    case 'member_days':
      return { cents: OVERAGE_RATES.additionalMemberCentsPerMonth, units: 1 };
  }
}

/**
 * Native units whose catalog meter price equals `invoiceCents`.
 * One local cent of email is four €0.0025 units, and one cent of accepted
 * sources is twenty €0.0005 units, including usage from earlier sub-cent
 * settlements that were not ingested on their own.
 */
export function polarCatalogUnitsForInvoiceCents(
  meterId: BillingMeterId,
  invoiceCents: number,
): number {
  if (meterId === 'member_days') return polarMemberMonthUnits(invoiceCents);
  if (!Number.isFinite(invoiceCents) || invoiceCents <= 0) return 0;
  const price = catalogUnitPrice(meterId);
  if (price.cents <= 0 || price.units <= 0) return 0;
  const micros = Math.floor((invoiceCents * POLAR_INVOICE_UNIT_MICROS * price.units) / price.cents);
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return micros / POLAR_INVOICE_UNIT_MICROS;
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

/** Six decimal places. Flooring keeps float noise from invoicing above the payable ratio. */
const POLAR_INVOICE_UNIT_MICROS = 1_000_000;

/**
 * Member-month fractions for the catalog €2 Polar price.
 * Custom extra-member prices and metered-discount percent change the payable
 * cents, and therefore the units, so Polar's shared unit price still invoices
 * the team amount.
 */
export function polarMemberMonthUnits(invoiceCents: number): number {
  const centsPerMonth = OVERAGE_RATES.additionalMemberCentsPerMonth;
  if (!Number.isFinite(invoiceCents) || invoiceCents <= 0) return 0;
  const micros = Math.floor((invoiceCents * POLAR_INVOICE_UNIT_MICROS) / centsPerMonth);
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return micros / POLAR_INVOICE_UNIT_MICROS;
}

export function polarInvoiceNativeUnits(input: {
  polarUnits: number;
  chargeCents: number;
  invoiceCents: number;
}): number {
  if (input.polarUnits <= 0 || input.invoiceCents <= 0) return 0;
  if (
    !Number.isFinite(input.polarUnits) ||
    !Number.isFinite(input.chargeCents) ||
    !Number.isFinite(input.invoiceCents)
  ) {
    return 0;
  }
  if (input.chargeCents <= 0 || input.invoiceCents >= input.chargeCents) return input.polarUnits;
  const micros = Math.floor(
    (input.polarUnits * POLAR_INVOICE_UNIT_MICROS * input.invoiceCents) / input.chargeCents,
  );
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return micros / POLAR_INVOICE_UNIT_MICROS;
}

/**
 * Customer-payable metered usage. Included discount and sub-cent rounds
 * (invoice cents of 0) stay local. Shadow billing and comps are not payable.
 * A payable charge still needs a matching subscription price before Polar
 * ingest; see polarIngestDisposition.
 */
export function shouldIngestPolarMeteredUsage(input: {
  eventName: string | null | undefined;
  polarCustomerId: string | null | undefined;
  shadowBilling: boolean;
  billable: boolean;
  polarUnits: number;
  invoiceCents: number;
}): boolean {
  if (!input.eventName || !input.polarCustomerId) return false;
  if (input.shadowBilling || !input.billable) return false;
  if (input.polarUnits <= 0 || input.invoiceCents <= 0) return false;
  return true;
}

export const POLAR_INGEST_BLOCK_MISSING_PRICE = 'missing_subscription_price';

const POLAR_EVENT_TO_METER: Record<string, BillingMeterId> = {
  timeline_ai_eur_cents: 'ai',
  timeline_recall_minutes: 'recall_minutes',
  timeline_email_units: 'email_units',
  timeline_storage_gb_month: 'storage_gb_month',
  timeline_accepted_sources: 'accepted_sources',
  timeline_extra_member_days: 'member_days',
};

/** Billing states that still have a subscription price Polar can invoice. */
const POLAR_SUBSCRIPTION_PRICE_STATES = new Set([
  'payg_active',
  'team_active',
  'business_active',
  'enterprise_active',
  'past_due',
  'payment_retry',
  'read_only',
]);

export function billingMeterIdForPolarEvent(name: string): BillingMeterId | null {
  return POLAR_EVENT_TO_METER[name] ?? null;
}

export interface PolarPlanProductIds {
  payg?: string;
  team?: string;
  business?: string;
  enterprise?: string;
}

function configuredPolarProductId(
  planId: string,
  products: PolarPlanProductIds,
): string | undefined {
  switch (planId) {
    case 'payg':
      return products.payg;
    case 'team':
      return products.team;
    case 'business':
      return products.business;
    case 'enterprise':
      return products.enterprise;
    default:
      return undefined;
  }
}

/**
 * True when this plan's configured Polar product is the subscription product
 * and that product's priced-event list includes the meter. A matching product
 * id is not proof the meter has a price. `pricedEventNames` null means the
 * catalog could not be read, which does not cover the meter.
 */
export function polarSubscriptionCoversMeter(input: {
  planId: string;
  billingState: string;
  polarSubscriptionId: string | null | undefined;
  polarProductId: string | null | undefined;
  eventName: string | null | undefined;
  products: PolarPlanProductIds;
  pricedEventNames: readonly string[] | null;
}): boolean {
  if (!input.polarSubscriptionId || !input.polarProductId || !input.eventName) return false;
  if (!POLAR_SUBSCRIPTION_PRICE_STATES.has(input.billingState)) return false;
  if (!billingMeterIdForPolarEvent(input.eventName)) return false;
  const expected = configuredPolarProductId(input.planId, input.products);
  if (!expected || input.polarProductId !== expected) return false;
  if (!input.pricedEventNames) return false;
  return input.pricedEventNames.includes(input.eventName);
}

export type PolarIngestDisposition = 'ingest' | 'hold' | 'not_required';

/**
 * ingest: send the event. hold: keep the local ledger pending and alert an
 * operator. not_required: shadow, comp, non-billable, or a sub-cent round.
 * A missing customer is a hold, not a silent skip.
 */
export function polarIngestDisposition(input: {
  eventName: string | null | undefined;
  polarCustomerId: string | null | undefined;
  shadowBilling: boolean;
  comped: boolean;
  billable: boolean;
  polarUnits: number;
  invoiceCents: number;
  subscriptionCoversMeter: boolean;
}): PolarIngestDisposition {
  if (input.shadowBilling || input.comped || !input.billable) return 'not_required';
  if (!input.eventName || input.polarUnits <= 0 || input.invoiceCents <= 0) return 'not_required';
  if (!input.polarCustomerId || !input.subscriptionCoversMeter) return 'hold';
  return 'ingest';
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
