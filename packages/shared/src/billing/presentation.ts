import { FREE_ALLOWANCES, type BillingMeterId, type BillingPlanId } from '#src/billing/catalog.js';
import { resolveTeamCommercialTerms, type BillingOperatorAccount } from '#src/billing/operator.js';
import { settlementUsageInstant } from '#src/billing/plan-history.js';

export interface BillingPeriod {
  start: string;
  end: string;
}
export interface RecordedCharges {
  usageCents: number;
  creditAppliedCents: number;
  usageAfterCreditCents: number;
  extraMemberCents: number;
  totalCents: number;
}
export interface BillingPresentation {
  planId: BillingPlanId;
  comped: boolean;
  calendarPeriod: BillingPeriod;
  allowances: { meter: BillingMeterId; used: number; included: number; remaining: number }[];
  credit: {
    status: 'available' | 'updating' | 'not_applicable';
    period: BillingPeriod | null;
    totalCents: number;
    usedCents: number | null;
    remainingCents: number | null;
  };
  charges: {
    status: 'available' | 'unavailable' | 'updating';
    period: BillingPeriod | null;
    amounts: RecordedCharges | null;
  };
  recurringFeeCents: number | null;
  members: { current: number; included: number | null; additionalMemberCents: number | null };
  cap: { usedCents: number; limitCents: number; percent: number; reached: boolean };
}
export interface PresentationSettlement {
  operationId: string;
  meterId: BillingMeterId;
  nativeUnits: string;
  occurredAt: Date;
  billable: boolean;
  metadata: Record<string, unknown>;
}
const LIMITS: Partial<Record<BillingMeterId, number>> = {
  ai: FREE_ALLOWANCES.aiChargeCents,
  recall_minutes: FREE_ALLOWANCES.recallMinutes,
  email_units: FREE_ALLOWANCES.emailUnits,
  storage_gb_month: FREE_ALLOWANCES.storageGb,
  accepted_sources: FREE_ALLOWANCES.acceptedSources,
};
const cents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function addCharge(total: RecordedCharges, meter: BillingMeterId, credit: number, invoice: number) {
  if (meter === 'member_days') total.extraMemberCents += invoice;
  else {
    total.usageCents += credit + invoice;
    total.creditAppliedCents += credit;
    total.usageAfterCreditCents += invoice;
  }
  total.totalCents += invoice;
}

/** Reads recorded settlement splits, never reprices historical usage using today's plan. */
export function recordedChargesForPeriod(
  rows: PresentationSettlement[],
  period: BillingPeriod,
): RecordedCharges | null {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  const total: RecordedCharges = {
    usageCents: 0,
    creditAppliedCents: 0,
    usageAfterCreditCents: 0,
    extraMemberCents: 0,
    totalCents: 0,
  };
  for (const row of rows) {
    if (
      !row.billable ||
      row.metadata.presentation_comped === true ||
      row.metadata.presentation_chargeable === false
    )
      continue;
    // Legacy non-delivery can mean a comp or shadow usage. Do not label it payable.
    const legacyUncertain =
      row.metadata.presentation_chargeable === undefined &&
      row.metadata.polar_ingest_status === 'not_required' &&
      ((typeof row.metadata.invoice_cents === 'number' && row.metadata.invoice_cents > 0) ||
        (typeof row.metadata.discount_cents === 'number' && row.metadata.discount_cents > 0));
    const windows = row.metadata.discount_windows;
    if (Array.isArray(windows) && windows.length > 0) {
      for (const raw of windows) {
        if (!raw || typeof raw !== 'object') return null;
        const w = raw as Record<string, unknown>;
        const ws = typeof w.started_at === 'string' ? Date.parse(w.started_at) : NaN;
        const we = typeof w.ends_at === 'string' ? Date.parse(w.ends_at) : NaN;
        if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) return null;
        if (we <= start || ws >= end) continue;
        if (legacyUncertain) return null;
        // A partial window cannot safely be prorated from its totals.
        if (ws < start || we > end || !cents(w.discount_cents) || !cents(w.invoice_cents))
          return null;
        addCharge(total, row.meterId, w.discount_cents, w.invoice_cents);
      }
      continue;
    }
    const instant = settlementUsageInstant(row).getTime();
    const duration =
      row.meterId === 'recall_minutes' ? Math.max(0, Number(row.nativeUnits)) * 60000 : 0;
    if (instant >= end || (instant < start && instant + duration <= start)) continue;
    if (legacyUncertain || instant < start || (duration > 0 && instant + duration > end))
      return null;
    // A month-only backfill is ambiguous inside a subscription window.
    if (
      !row.metadata.usage_at &&
      (row.metadata.pricing_period_ym || row.metadata.polar_ingest_period_ym)
    )
      return null;
    if (!cents(row.metadata.discount_cents) || !cents(row.metadata.invoice_cents)) return null;
    addCharge(total, row.meterId, row.metadata.discount_cents, row.metadata.invoice_cents);
  }
  return total;
}

export function buildBillingPresentation(input: {
  account: BillingOperatorAccount & {
    includedDiscountRemainingCents: number;
    periodStartedAt: Date | null;
    periodEndsAt: Date | null;
    spendCapCents: number;
  };
  meters: Partial<Record<BillingMeterId, { nativeUnits: number }>>;
  meteredSpendCents: number;
  activeMembers: number;
  settlements: PresentationSettlement[];
  now?: Date;
}): BillingPresentation {
  const now = input.now ?? new Date();
  const terms = resolveTeamCommercialTerms(input.account, now);
  const comped = input.account.arrangement === 'comped';
  const calendarPeriod = {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
  const native = terms.planId === 'free' || terms.planId === 'payg';
  const validWindow =
    input.account.periodStartedAt &&
    input.account.periodEndsAt &&
    input.account.periodStartedAt <= now &&
    input.account.periodEndsAt > now;
  const subscriptionPeriod =
    validWindow && input.account.periodStartedAt && input.account.periodEndsAt
      ? {
          start: input.account.periodStartedAt.toISOString(),
          end: input.account.periodEndsAt.toISOString(),
        }
      : null;
  const period = terms.planId === 'free' ? calendarPeriod : subscriptionPeriod;
  const totalCredit = terms.includedUsageDiscountCents;
  const balance = input.account.includedDiscountRemainingCents;
  const validCredit = Boolean(subscriptionPeriod) && cents(balance) && balance <= totalCredit;
  let amounts = period ? recordedChargesForPeriod(input.settlements, period) : null;
  // A consumed balance without matching settlement evidence is incomplete history.
  if (
    !comped &&
    totalCredit > 0 &&
    validCredit &&
    amounts &&
    amounts.creditAppliedCents < totalCredit - balance
  )
    amounts = null;
  return {
    planId: terms.planId,
    comped,
    calendarPeriod,
    allowances: native
      ? Object.entries(LIMITS).map(([key, included]) => {
          const meter = key as BillingMeterId;
          const used = Math.max(0, input.meters[meter]?.nativeUnits ?? 0);
          return { meter, used, included, remaining: Math.max(0, included - used) };
        })
      : [],
    credit: {
      status:
        totalCredit === 0 || comped ? 'not_applicable' : validCredit ? 'available' : 'updating',
      period: subscriptionPeriod,
      totalCents: totalCredit,
      usedCents: validCredit ? totalCredit - balance : null,
      remainingCents: validCredit ? balance : null,
    },
    charges: {
      status: amounts ? 'available' : period ? 'unavailable' : 'updating',
      period,
      amounts,
    },
    recurringFeeCents: comped ? 0 : terms.platformFeeCents,
    members: {
      current: input.activeMembers,
      included: terms.includedActiveMembers,
      additionalMemberCents: comped ? 0 : terms.additionalMemberCents,
    },
    cap: {
      usedCents: input.meteredSpendCents,
      limitCents: input.account.spendCapCents,
      percent:
        input.account.spendCapCents > 0
          ? Math.min(100, Math.round((input.meteredSpendCents / input.account.spendCapCents) * 100))
          : 0,
      reached:
        input.account.spendCapCents <= 0 || input.meteredSpendCents >= input.account.spendCapCents,
    },
  };
}
