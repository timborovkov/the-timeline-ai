import { billingPlanHistory, billingUsageLedger, type Db } from '@timeline/db';
import { and, desc, eq, lte } from 'drizzle-orm';

import { PLAN_CATALOG, type BillingPlanId } from '#src/billing/catalog.js';

function isBillingPlanId(value: string): value is BillingPlanId {
  return value in PLAN_CATALOG;
}

/** Append a row when the commercial plan actually changes. */
export async function recordBillingPlan(
  db: Db,
  teamId: string,
  planId: BillingPlanId,
  effectiveAt = new Date(),
): Promise<void> {
  const [latest] = await db
    .select({ planId: billingPlanHistory.planId })
    .from(billingPlanHistory)
    .where(eq(billingPlanHistory.teamId, teamId))
    .orderBy(desc(billingPlanHistory.effectiveAt))
    .limit(1);
  if (latest?.planId === planId) return;
  await db.insert(billingPlanHistory).values({ teamId, planId, effectiveAt });
}

/** Plan in force at the end of a UTC day. Falls back when no history exists yet. */
export async function planIdEffectiveOnDay(input: {
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
 * Catalog included-usage discount left for a calendar period, after discount
 * cents already recorded on that period's settlements.
 */
export async function includedDiscountRemainingForReplay(input: {
  db: Db;
  teamId: string;
  planId: BillingPlanId;
  periodYm: string;
}): Promise<number> {
  const budget = PLAN_CATALOG[input.planId].includedUsageDiscountCents;
  if (budget <= 0) return 0;
  const rows = await input.db
    .select({
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
    if (
      settlementMatchesDiscountPeriod({
        periodYm: input.periodYm,
        occurredAt: row.occurredAt,
        metadata: row.metadata,
      })
    ) {
      used += cents;
    }
  }
  return Math.max(0, budget - used);
}
