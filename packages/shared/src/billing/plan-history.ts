import { billingPlanHistory, billingUsageLedger, teamBillingAccounts, type Db } from '@timeline/db';
import { and, asc, desc, eq, lt, lte } from 'drizzle-orm';

import { PLAN_CATALOG, type BillingPlanId } from '#src/billing/catalog.js';
import { includedDiscountWindowContaining } from '#src/billing/charge.js';
import { historicalPlanIdOnDay, type BillingArrangement } from '#src/billing/operator.js';

function isBillingPlanId(value: string): value is BillingPlanId {
  return value in PLAN_CATALOG;
}

/**
 * Plan in force before this transition. Used when history is still empty so
 * days before the first recorded change keep the outgoing plan.
 */
export interface BillingPlanBaseline {
  planId: BillingPlanId;
  effectiveAt: Date;
}

/** Append a row when the commercial plan actually changes. */
export async function recordBillingPlan(
  db: Db,
  teamId: string,
  planId: BillingPlanId,
  effectiveAt = new Date(),
  openedFrom?: BillingPlanBaseline,
): Promise<void> {
  const [latest] = await db
    .select({ planId: billingPlanHistory.planId })
    .from(billingPlanHistory)
    .where(eq(billingPlanHistory.teamId, teamId))
    .orderBy(desc(billingPlanHistory.effectiveAt))
    .limit(1);
  if (!latest && openedFrom && openedFrom.effectiveAt.getTime() < effectiveAt.getTime()) {
    if (openedFrom.planId !== planId) {
      await db.insert(billingPlanHistory).values({
        teamId,
        planId: openedFrom.planId,
        effectiveAt: openedFrom.effectiveAt,
      });
    } else {
      await db.insert(billingPlanHistory).values({
        teamId,
        planId,
        effectiveAt: openedFrom.effectiveAt,
      });
      return;
    }
  }
  if (latest?.planId === planId) return;
  await db.insert(billingPlanHistory).values({ teamId, planId, effectiveAt });
}

/**
 * Accounts whose first history row is a paid plan were Free until that row.
 * Insert that baseline. Accounts with no history stay on the live-plan fallback.
 */
export async function backfillFreePlanBaselines(db: Db): Promise<number> {
  const accounts = await db
    .select({
      teamId: teamBillingAccounts.teamId,
      createdAt: teamBillingAccounts.createdAt,
    })
    .from(teamBillingAccounts);
  let inserted = 0;
  for (const account of accounts) {
    const [first] = await db
      .select({
        planId: billingPlanHistory.planId,
        effectiveAt: billingPlanHistory.effectiveAt,
      })
      .from(billingPlanHistory)
      .where(eq(billingPlanHistory.teamId, account.teamId))
      .orderBy(asc(billingPlanHistory.effectiveAt))
      .limit(1);
    if (!first || !isBillingPlanId(first.planId) || first.planId === 'free') continue;
    const [earlierFree] = await db
      .select({ id: billingPlanHistory.id })
      .from(billingPlanHistory)
      .where(
        and(
          eq(billingPlanHistory.teamId, account.teamId),
          eq(billingPlanHistory.planId, 'free'),
          lt(billingPlanHistory.effectiveAt, first.effectiveAt),
        ),
      )
      .limit(1);
    if (earlierFree) continue;
    const effectiveAt =
      first.effectiveAt.getTime() > account.createdAt.getTime()
        ? account.createdAt
        : new Date(first.effectiveAt.getTime() - 1);
    await db.insert(billingPlanHistory).values({
      teamId: account.teamId,
      planId: 'free',
      effectiveAt,
    });
    inserted += 1;
  }
  return inserted;
}

/** Plan in force at the end of a UTC day. Falls back when no history exists yet. */
async function planIdEffectiveOnDay(input: {
  db: Db;
  teamId: string;
  day: string;
  fallback: BillingPlanId;
}): Promise<BillingPlanId> {
  const end = new Date(`${input.day}T23:59:59.999Z`);
  const [row] = await input.db
    .select({ planId: billingPlanHistory.planId })
    .from(billingPlanHistory)
    .where(
      and(eq(billingPlanHistory.teamId, input.teamId), lte(billingPlanHistory.effectiveAt, end)),
    )
    .orderBy(desc(billingPlanHistory.effectiveAt))
    .limit(1);
  if (row && isBillingPlanId(row.planId)) return row.planId;
  return input.fallback;
}

const PERIOD_YM = /^(\d{4})-(\d{2})$/u;

function taggedPeriodYm(value: unknown): string | null {
  return typeof value === 'string' && PERIOD_YM.test(value) ? value : null;
}

/**
 * One settlement belongs to one discount period. `pricing_period_ym` wins,
 * then `polar_ingest_period_ym`. The ledger timestamp is used only when
 * neither tag is set, so a backfilled month is not also charged to the
 * month the row was written.
 */
export function settlementMatchesDiscountPeriod(input: {
  periodYm: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}): boolean {
  const tag =
    taggedPeriodYm(input.metadata.pricing_period_ym) ??
    taggedPeriodYm(input.metadata.polar_ingest_period_ym);
  if (tag) return tag === input.periodYm;
  const match = PERIOD_YM.exec(input.periodYm);
  if (!match) return false;
  const start = new Date(`${input.periodYm}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return input.occurredAt >= start && input.occurredAt < end;
}

/**
 * Plan used to price one UTC day. History first, then comp expiry, then the
 * stored plan. A contractual Enterprise account is not a comp, so it stays
 * Enterprise. An expired comp is Free for days after `compExpiresAt`.
 */
export async function billingPlanIdOnDay(input: {
  db: Db;
  teamId: string;
  day: string;
  account: {
    planId: BillingPlanId;
    arrangement?: BillingArrangement | null | undefined;
    compExpiresAt?: Date | null | undefined;
  };
}): Promise<BillingPlanId> {
  const storedPlanId = await planIdEffectiveOnDay({
    db: input.db,
    teamId: input.teamId,
    day: input.day,
    fallback: input.account.planId,
  });
  return historicalPlanIdOnDay({
    storedPlanId,
    arrangement: input.account.arrangement,
    compExpiresAt: input.account.compExpiresAt,
    day: input.day,
  });
}

const USAGE_DAY_IN_OPERATION_ID = /(?:^|:)(\d{4}-\d{2}-\d{2})(?:$|:)/u;

function calendarMonthWindow(window: { startedAt: Date; endsAt: Date }): boolean {
  const { startedAt, endsAt } = window;
  return (
    startedAt.getUTCDate() === 1 &&
    startedAt.getUTCHours() === 0 &&
    startedAt.getUTCMinutes() === 0 &&
    startedAt.getUTCSeconds() === 0 &&
    startedAt.getUTCMilliseconds() === 0 &&
    endsAt.getTime() === Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth() + 1, 1)
  );
}

/**
 * When the usage happened. `usage_at` wins, then a day embedded in the
 * operation id. Live settlements stamp `usage_at`, so a month tag does not
 * move them to the 15th. A month tag with no instant is the 15th of that
 * month so a backfill is not placed on the day it was written. Untagged rows
 * use the ledger time.
 */
function settlementUsageInstant(row: {
  operationId: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}): Date {
  const stamped = row.metadata.usage_at;
  if (typeof stamped === 'string') {
    const parsed = new Date(stamped);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const dated = USAGE_DAY_IN_OPERATION_ID.exec(row.operationId);
  const day = dated?.[1];
  if (day) return new Date(`${day}T12:00:00.000Z`);
  const tag =
    taggedPeriodYm(row.metadata.pricing_period_ym) ??
    taggedPeriodYm(row.metadata.polar_ingest_period_ym);
  if (tag) {
    const match = PERIOD_YM.exec(tag);
    if (match) {
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12));
    }
  }
  return row.occurredAt;
}

function settlementInDiscountWindow(
  row: {
    operationId: string;
    occurredAt: Date;
    metadata: Record<string, unknown>;
  },
  window: { startedAt: Date; endsAt: Date },
): boolean {
  if (calendarMonthWindow(window)) {
    const periodYm = `${window.startedAt.getUTCFullYear()}-${String(window.startedAt.getUTCMonth() + 1).padStart(2, '0')}`;
    return settlementMatchesDiscountPeriod({
      periodYm,
      occurredAt: row.occurredAt,
      metadata: row.metadata,
    });
  }
  const usageAt = settlementUsageInstant(row);
  return (
    usageAt.getTime() >= window.startedAt.getTime() && usageAt.getTime() < window.endsAt.getTime()
  );
}

/**
 * Catalog included-usage discount left for the subscription window that
 * contains `usageAt`, after discount cents already recorded in that window.
 */
export async function includedDiscountRemainingForReplay(input: {
  db: Db;
  teamId: string;
  planId: BillingPlanId;
  usageAt: Date;
  periodStartedAt: Date | null;
  periodEndsAt: Date | null;
}): Promise<number> {
  const budget = PLAN_CATALOG[input.planId].includedUsageDiscountCents;
  if (budget <= 0) return 0;
  const window = includedDiscountWindowContaining({
    usageAt: input.usageAt,
    periodStartedAt: input.periodStartedAt,
    periodEndsAt: input.periodEndsAt,
  });
  const rows = await input.db
    .select({
      operationId: billingUsageLedger.operationId,
      metadata: billingUsageLedger.metadata,
      occurredAt: billingUsageLedger.occurredAt,
    })
    .from(billingUsageLedger)
    .where(
      and(eq(billingUsageLedger.teamId, input.teamId), eq(billingUsageLedger.kind, 'settlement')),
    );
  let used = 0;
  for (const row of rows) {
    const cents = row.metadata.discount_cents;
    if (typeof cents !== 'number' || cents <= 0) continue;
    if (settlementInDiscountWindow(row, window)) used += cents;
  }
  return Math.max(0, budget - used);
}
