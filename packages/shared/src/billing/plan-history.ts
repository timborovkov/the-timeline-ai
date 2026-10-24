import { billingPlanHistory, billingUsageLedger, type Db } from '@timeline/db';
import { and, desc, eq, lte } from 'drizzle-orm';

import { PLAN_CATALOG, type BillingPlanId } from '#src/billing/catalog.js';
import { historicalPlanIdOnDay, type BillingArrangement } from '#src/billing/operator.js';

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
    arrangement?: BillingArrangement | null;
    compExpiresAt?: Date | null;
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
  const match = /^(\d{4})-(\d{2})$/u.exec(input.periodYm);
  const start = match ? new Date(`${input.periodYm}-01T00:00:00.000Z`) : null;
  const end = match && start ? new Date(Date.UTC(Number(match[1]), Number(match[2]), 1)) : null;
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
    const metadata = row.metadata;
    const cents = metadata.discount_cents;
    if (typeof cents !== 'number' || cents <= 0) continue;
    const tagged =
      metadata.pricing_period_ym === input.periodYm ||
      metadata.polar_ingest_period_ym === input.periodYm;
    const inMonth =
      start !== null && end !== null && row.occurredAt >= start && row.occurredAt < end;
    if (tagged || inMonth) used += cents;
  }
  return Math.max(0, budget - used);
}
