import { billingPlanHistory, billingUsageLedger, teamBillingAccounts, type Db } from '@timeline/db';
import { and, asc, desc, eq, lt, lte, sql } from 'drizzle-orm';

import { PLAN_CATALOG, type BillingPlanId } from '#src/billing/catalog.js';
import {
  includedDiscountWindowContaining,
  nextIncludedDiscountPeriod,
} from '#src/billing/charge.js';
import {
  effectiveBillingPlanId,
  historicalPlanIdOnDay,
  type BillingArrangement,
} from '#src/billing/operator.js';

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
  db: Pick<Db, 'select'>;
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
 * then `polar_ingest_period_ym`. With neither tag, the timestamp decides the
 * calendar month. Callers pass the usage instant when the row has one, and
 * the ledger time only for an untagged row with no usage instant.
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
  db: Pick<Db, 'select'>;
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
  const usageAt = settlementUsageInstant(row);
  if (calendarMonthWindow(window)) {
    const periodYm = `${window.startedAt.getUTCFullYear()}-${String(window.startedAt.getUTCMonth() + 1).padStart(2, '0')}`;
    return settlementMatchesDiscountPeriod({
      periodYm,
      occurredAt: usageAt,
      metadata: row.metadata,
    });
  }
  return (
    usageAt.getTime() >= window.startedAt.getTime() && usageAt.getTime() < window.endsAt.getTime()
  );
}

/**
 * Refill the included-usage discount when the stored renewal window has
 * closed. A missing window is left alone unless the caller is the janitor,
 * which opens the current calendar month. The next bounds advance from the
 * stored Polar window.
 */
export async function rollIncludedDiscountIfElapsed(
  tx: Pick<Db, 'update'>,
  account: typeof teamBillingAccounts.$inferSelect,
  now: Date,
  options?: { openMissingBounds?: boolean },
): Promise<{ account: typeof teamBillingAccounts.$inferSelect; rolled: boolean }> {
  const hasBounds = Boolean(account.periodStartedAt && account.periodEndsAt);
  if (!hasBounds && options?.openMissingBounds !== true) {
    return { account, rolled: false };
  }
  if (account.periodEndsAt && account.periodEndsAt > now) {
    return { account, rolled: false };
  }
  const next = nextIncludedDiscountPeriod({
    now,
    periodStartedAt: account.periodStartedAt,
    periodEndsAt: account.periodEndsAt,
  });
  if (!next) return { account, rolled: false };
  const included = PLAN_CATALOG[effectiveBillingPlanId(account, now)].includedUsageDiscountCents;
  const [updated] = await tx
    .update(teamBillingAccounts)
    .set({
      includedDiscountRemainingCents: included,
      periodStartedAt: next.periodStartedAt,
      periodEndsAt: next.periodEndsAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(teamBillingAccounts.teamId, account.teamId),
        eq(teamBillingAccounts.planId, account.planId),
        account.periodStartedAt
          ? eq(teamBillingAccounts.periodStartedAt, account.periodStartedAt)
          : sql`${teamBillingAccounts.periodStartedAt} IS NULL`,
        account.periodEndsAt
          ? eq(teamBillingAccounts.periodEndsAt, account.periodEndsAt)
          : sql`${teamBillingAccounts.periodEndsAt} IS NULL`,
      ),
    )
    .returning();
  if (!updated) return { account, rolled: false };
  return { account: updated, rolled: true };
}

/**
 * Catalog included-usage discount left for the subscription window that
 * contains `usageAt`, after discount cents already recorded in that window.
 */
export async function includedDiscountRemainingForReplay(input: {
  db: Pick<Db, 'select'>;
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

/**
 * Discount pool for one settlement. An explicit historical pool wins. Usage
 * before the current window uses that earlier window's remaining catalog
 * discount, so a recovered reservation does not draw the refilled balance.
 * Usage inside the current window returns undefined and the caller keeps the
 * live balance.
 */
export async function includedDiscountCentsBeforeCurrentWindow(input: {
  db: Pick<Db, 'select'>;
  teamId: string;
  account: {
    planId: BillingPlanId;
    arrangement?: BillingArrangement | null | undefined;
    compExpiresAt?: Date | null | undefined;
    periodStartedAt: Date | null;
    periodEndsAt: Date | null;
  };
  usageAt: Date;
  now: Date;
  pricingPlanId?: BillingPlanId;
  historicalIncludedDiscountCents?: number;
}): Promise<number | undefined> {
  if (input.historicalIncludedDiscountCents !== undefined) {
    return input.historicalIncludedDiscountCents;
  }
  const current = includedDiscountWindowContaining({
    usageAt: input.now,
    periodStartedAt: input.account.periodStartedAt,
    periodEndsAt: input.account.periodEndsAt,
  });
  if (input.usageAt.getTime() >= current.startedAt.getTime()) return undefined;
  const planId =
    input.pricingPlanId ??
    (await billingPlanIdOnDay({
      db: input.db,
      teamId: input.teamId,
      day: input.usageAt.toISOString().slice(0, 10),
      account: input.account,
    }));
  return includedDiscountRemainingForReplay({
    db: input.db,
    teamId: input.teamId,
    planId,
    usageAt: input.usageAt,
    periodStartedAt: input.account.periodStartedAt,
    periodEndsAt: input.account.periodEndsAt,
  });
}
