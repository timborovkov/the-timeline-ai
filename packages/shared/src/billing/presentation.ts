import {
  FREE_ALLOWANCES,
  FREE_MONTHLY_USAGE_CENTS,
  TEAM_MONTHLY_SEAT_CENTS,
  type BillingMeterId,
  type BillingPlanId,
} from '#src/billing/catalog.js';
import type { TeamSeatTerms } from '#src/billing/membership.js';
import {
  contractualEnterpriseAccount,
  localChargeSpendCapApplies,
  resolveTeamCommercialTerms,
  type BillingOperatorAccount,
} from '#src/billing/operator.js';
import { settlementUsageInstant } from '#src/billing/plan-history.js';
import { freeIncludedUsageRemainingCents } from '#src/billing/policy.js';

export interface BillingPeriod {
  start: string;
  end: string;
}
export interface RecordedCharges {
  currency: 'USD' | 'EUR' | null;
  invoiceCentsByMeter: Partial<Record<BillingMeterId, number>>;
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
  includedUsage?: { totalCents: number; remainingCents: number | null; resetAt: string | null };
  paidSeats?: number;
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
  recurringFeeCurrency?: 'EUR' | 'USD';
  members: { current: number; included: number | null; additionalMemberCents: number | null };
  cap: {
    applicable: boolean;
    exemption: 'enterprise_contract' | 'shadow_billing' | 'free_plan' | null;
    usedCents: number;
    limitCents: number;
    percent: number;
    reached: boolean;
  };
}
export interface PresentationSettlement {
  operationId: string;
  meterId: BillingMeterId;
  nativeUnits: string;
  occurredAt: Date;
  billable: boolean;
  metadata: Record<string, unknown>;
  reservationMetadata?: Record<string, unknown> | null;
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
function settlementCurrency(row: PresentationSettlement): 'USD' | 'EUR' | null {
  const currency = row.metadata.presentation_currency;
  if (currency === 'USD' || currency === 'EUR') return currency;
  if (currency === null || row.metadata.pricing_plan_id === 'enterprise') return null;
  // Failed attempts link to a parent reservation that can be admitted again.
  if (typeof row.metadata.failed_attempt_for === 'string') return null;
  if (row.meterId === 'member_days') return 'EUR';
  const pricing = row.reservationMetadata?.team_seat_pricing_at_admission;
  const cap = row.reservationMetadata?.team_overage_cap_at_admission;
  // Earlier seat settlements stored their pricing generation on the reservation.
  if (pricing !== undefined)
    return pricing !== null && typeof pricing === 'object' && !Array.isArray(pricing)
      ? 'USD'
      : 'EUR';
  return typeof cap === 'number' && cap > 0 ? 'USD' : 'EUR';
}

function addCharge(
  total: RecordedCharges,
  row: PresentationSettlement,
  credit: number,
  invoice: number,
): boolean {
  if (credit === 0 && invoice === 0) return true;
  const currency = settlementCurrency(row);
  if (!currency || (total.currency && total.currency !== currency)) return false;
  total.currency = currency;
  total.invoiceCentsByMeter[row.meterId] = (total.invoiceCentsByMeter[row.meterId] ?? 0) + invoice;
  if (row.meterId === 'member_days') total.extraMemberCents += invoice;
  else {
    total.usageCents += credit + invoice;
    total.creditAppliedCents += credit;
    total.usageAfterCreditCents += invoice;
  }
  total.totalCents += invoice;
  return true;
}

/** Reads recorded settlement splits, never reprices historical usage using today's plan. */
export function recordedChargesForPeriod(
  rows: PresentationSettlement[],
  period: BillingPeriod,
): RecordedCharges | null {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  const total: RecordedCharges = {
    currency: null,
    invoiceCentsByMeter: {},
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
        if (!addCharge(total, row, w.discount_cents, w.invoice_cents)) return null;
      }
      continue;
    }
    const instant = settlementUsageInstant(row).getTime();
    const duration =
      row.meterId === 'recall_minutes' ? Math.max(0, Number(row.nativeUnits)) * 60000 : 0;
    const actualEnd =
      row.meterId === 'recall_minutes' && typeof row.metadata.usage_ended_at === 'string'
        ? Date.parse(row.metadata.usage_ended_at)
        : NaN;
    const billedEnd =
      actualEnd > instant ? Math.min(actualEnd, instant + duration) : instant + duration;
    if (instant >= end || (instant < start && billedEnd <= start)) continue;
    if (legacyUncertain || instant < start || billedEnd > end) return null;
    // A month-only backfill is ambiguous inside a subscription window.
    if (
      !row.metadata.usage_at &&
      (row.metadata.pricing_period_ym || row.metadata.polar_ingest_period_ym)
    )
      return null;
    if (!cents(row.metadata.discount_cents) || !cents(row.metadata.invoice_cents)) return null;
    if (!addCharge(total, row, row.metadata.discount_cents, row.metadata.invoice_cents))
      return null;
  }
  return total;
}

export function buildBillingPresentation(input: {
  account: BillingOperatorAccount & {
    includedDiscountRemainingCents: number;
    periodStartedAt: Date | null;
    periodEndsAt: Date | null;
    spendCapCents: number;
    teamSeatTerms?: TeamSeatTerms | null;
  };
  meters: Partial<Record<BillingMeterId, { nativeUnits: number; customerChargeCents?: number }>>;
  meteredSpendCents: number;
  activeMembers: number;
  shadowBilling: boolean;
  settlements: PresentationSettlement[];
  now?: Date;
}): BillingPresentation {
  const now = input.now ?? new Date();
  const terms = resolveTeamCommercialTerms(input.account, now);
  const comped = input.account.arrangement === 'comped';
  const enterpriseContract = contractualEnterpriseAccount(input.account);
  const seatTerms = terms.planId === 'team' ? input.account.teamSeatTerms : null;
  const capApplies =
    Boolean(seatTerms) ||
    localChargeSpendCapApplies({
      shadowBilling: input.shadowBilling,
      comped,
      enterpriseContract,
      entitlementsPlanId: terms.planId,
    });
  const calendarPeriod = {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
  const native = terms.planId === 'payg';
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
  const totalCredit = seatTerms?.includedUsageCents ?? terms.includedUsageDiscountCents;
  const balance = input.account.includedDiscountRemainingCents;
  const validCredit = Boolean(subscriptionPeriod) && cents(balance) && balance <= totalCredit;
  let amounts = period ? recordedChargesForPeriod(input.settlements, period) : null;
  // A consumed balance without matching settlement evidence is incomplete history.
  if (
    !comped &&
    totalCredit > 0 &&
    validCredit &&
    amounts &&
    (amounts.currency === (seatTerms ? 'USD' : 'EUR') ? amounts.creditAppliedCents : 0) <
      totalCredit - balance
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
    ...(terms.planId === 'free'
      ? {
          includedUsage: {
            totalCents: FREE_MONTHLY_USAGE_CENTS,
            remainingCents: freeIncludedUsageRemainingCents(input.meters),
            resetAt: calendarPeriod.end,
          },
        }
      : {}),
    ...(seatTerms
      ? {
          paidSeats: seatTerms.paidSeats,
          includedUsage: {
            totalCents: totalCredit,
            remainingCents: validCredit ? balance : null,
            resetAt: subscriptionPeriod?.end ?? null,
          },
        }
      : {}),
    credit: {
      status:
        seatTerms || totalCredit === 0 || comped
          ? 'not_applicable'
          : validCredit
            ? 'available'
            : 'updating',
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
    recurringFeeCents: comped
      ? 0
      : seatTerms
        ? seatTerms.paidSeats * TEAM_MONTHLY_SEAT_CENTS
        : terms.platformFeeCents,
    recurringFeeCurrency: seatTerms ? 'USD' : terms.platformFeeCurrency,
    members: {
      current: input.activeMembers,
      included: terms.includedActiveMembers,
      additionalMemberCents: comped ? 0 : terms.additionalMemberCents,
    },
    cap: {
      applicable: capApplies,
      exemption: capApplies
        ? null
        : enterpriseContract
          ? 'enterprise_contract'
          : input.shadowBilling
            ? 'shadow_billing'
            : 'free_plan',
      usedCents: input.meteredSpendCents,
      limitCents: input.account.spendCapCents,
      percent:
        input.account.spendCapCents > 0
          ? Math.min(100, Math.round((input.meteredSpendCents / input.account.spendCapCents) * 100))
          : 0,
      reached:
        capApplies &&
        (input.account.spendCapCents <= 0 ||
          input.meteredSpendCents >= input.account.spendCapCents),
    },
  };
}
