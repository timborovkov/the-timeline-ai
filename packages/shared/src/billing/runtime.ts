import { randomUUID } from 'node:crypto';

import {
  billingMemberDayLedger,
  billingUsageCounters,
  billingUsageLedger,
  documentVersions,
  documents,
  teamBillingAccounts,
  teamMembers,
  teams,
  type Db,
} from '@timeline/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { BillingReserveFailureCode } from '#src/billing/admission.js';

import { maybeTriggerWalletAutoReload } from '#src/billing/auto-reload.js';
import {
  BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS,
  type BillingMeterId,
  PLAN_CATALOG,
  PREPAID_TOPUP_CENTS,
  customerAiChargeCentsFromOpenRouterUsd,
} from '#src/billing/catalog.js';
import {
  cumulativeChargeDeltaCents,
  memberDaysChargeCents,
  nextIncludedDiscountPeriod,
} from '#src/billing/charge.js';
import {
  BILLING_SYSTEM_USER_ID,
  getBillingContext,
  runWithBillingContext,
  type BillingAlsContext,
} from '#src/billing/context.js';
import { BillingAdmissionError } from '#src/billing/errors.js';
import {
  openRouterUsdCostFromFinishEvent,
  type OpenRouterFinishEvent,
} from '#src/billing/openrouter-usage.js';
import { createPolarBillingProvider } from '#src/billing/polar.js';
import { leaveOverdueRecallBots } from '#src/billing/recall-leave.js';
import { expireStaleBillingReservations } from '#src/billing/reservations.js';
import { createBillingScope, flushPendingPolarUsageIngest } from '#src/billing/scope.js';
import { accountUsesShadowBilling, shadowBillingFromChargesEnabled } from '#src/billing/shadow.js';

const GIB = 1024 ** 3;

export function periodYm(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function daysInUtcMonth(date = new Date()): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function billingScope(ctx: Pick<BillingAlsContext, 'db' | 'teamId' | 'userId'>) {
  const provider = createPolarBillingProvider() ?? undefined;
  return createBillingScope({
    db: ctx.db,
    teamId: ctx.teamId,
    userId: ctx.userId,
    ensureMember: () => Promise.resolve('owner'),
    ...(provider ? { provider } : {}),
  });
}

async function currentMeterNativeUnits(
  db: Db,
  teamId: string,
  meterId: BillingMeterId,
): Promise<number> {
  const [row] = await db
    .select()
    .from(billingUsageCounters)
    .where(
      and(
        eq(billingUsageCounters.teamId, teamId),
        eq(billingUsageCounters.periodYm, periodYm()),
        eq(billingUsageCounters.meterId, meterId),
      ),
    )
    .limit(1);
  return row ? Number(row.nativeUnits) : 0;
}

export async function runWorkerBilling<T>(
  db: Db,
  teamId: string,
  operationClass: string,
  fn: () => Promise<T>,
  options?: { skipMeters?: ReadonlySet<BillingMeterId> },
): Promise<T> {
  return runWithBillingContext(
    {
      db,
      teamId,
      userId: BILLING_SYSTEM_USER_ID,
      operationClass,
      source: 'worker',
      deliverySurface: 'worker',
      ...(options?.skipMeters ? { skipMeters: options.skipMeters } : {}),
    },
    fn,
  );
}

export async function creditWalletFromPolarOrder(input: {
  db: Db;
  teamId: string;
  orderId: string;
  cents: number;
}): Promise<{ duplicate: boolean }> {
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: BILLING_SYSTEM_USER_ID,
  });
  const result = await billing.creditWallet({
    operationId: `polar_topup:${input.orderId}`,
    cents: input.cents,
    source: 'polar_order',
  });
  await applyPendingPolarRefundsForOrder({
    db: input.db,
    teamId: input.teamId,
    orderId: input.orderId,
  });
  return { duplicate: result.duplicate };
}

async function applyPendingPolarRefundsForOrder(input: {
  db: Db;
  teamId: string;
  orderId: string;
}): Promise<void> {
  const pending = await input.db
    .select({
      operationId: billingUsageLedger.operationId,
      metadata: billingUsageLedger.metadata,
    })
    .from(billingUsageLedger)
    .where(
      and(
        eq(billingUsageLedger.teamId, input.teamId),
        eq(billingUsageLedger.kind, 'adjustment'),
        sql`${billingUsageLedger.metadata}->>'order_id' = ${input.orderId}`,
        sql`${billingUsageLedger.metadata}->>'pending' = 'true'`,
      ),
    );
  for (const row of pending) {
    const prefix = 'polar_refund_pending:';
    const refundKey = row.operationId.startsWith(prefix)
      ? row.operationId.slice(prefix.length)
      : row.operationId;
    const centsRaw = row.metadata.cents;
    const cents = typeof centsRaw === 'number' && centsRaw > 0 ? centsRaw : 0;
    await debitWalletFromPolarRefund({
      db: input.db,
      teamId: input.teamId,
      orderId: input.orderId,
      refundKey,
      cents,
    });
    await input.db
      .update(billingUsageLedger)
      .set({
        metadata: sql`${billingUsageLedger.metadata} || ${JSON.stringify({ pending: false })}::jsonb`,
      })
      .where(
        and(
          eq(billingUsageLedger.teamId, input.teamId),
          eq(billingUsageLedger.operationId, row.operationId),
        ),
      );
  }
}

export async function debitWalletFromPolarRefund(input: {
  db: Db;
  teamId: string;
  orderId: string;
  refundKey: string;
  cents: number;
}): Promise<{ duplicate: boolean; reversed: boolean; shortfallCents: number }> {
  const [original] = await input.db
    .select({
      metadata: billingUsageLedger.metadata,
    })
    .from(billingUsageLedger)
    .where(
      and(
        eq(billingUsageLedger.teamId, input.teamId),
        eq(billingUsageLedger.operationId, `polar_topup:${input.orderId}`),
      ),
    )
    .limit(1);
  if (!original) {
    await input.db
      .insert(billingUsageLedger)
      .values({
        teamId: input.teamId,
        operationId: `polar_refund_pending:${input.refundKey}`,
        kind: 'adjustment',
        meterId: 'ai',
        nativeUnits: '0',
        customerChargeCents: 0,
        billable: false,
        nonBillableReason: 'polar_refund_pending',
        operationClass: 'wallet_refund',
        source: 'polar_refund',
        metadata: {
          pending: true,
          order_id: input.orderId,
          cents: input.cents > 0 ? input.cents : PREPAID_TOPUP_CENTS,
        },
      })
      .onConflictDoNothing();
    return { duplicate: false, reversed: false, shortfallCents: 0 };
  }
  const originalCentsRaw = original.metadata.cents;
  const originalCents =
    typeof originalCentsRaw === 'number' && originalCentsRaw > 0
      ? originalCentsRaw
      : PREPAID_TOPUP_CENTS;
  const priorReversals = await input.db
    .select({ metadata: billingUsageLedger.metadata })
    .from(billingUsageLedger)
    .where(
      and(
        eq(billingUsageLedger.teamId, input.teamId),
        eq(billingUsageLedger.kind, 'reversal'),
        sql`${billingUsageLedger.metadata}->>'order_id' = ${input.orderId}`,
      ),
    );
  const alreadyReversed = priorReversals.reduce((sum, row) => {
    const cents = row.metadata.cents;
    return sum + (typeof cents === 'number' && cents > 0 ? cents : 0);
  }, 0);
  const remaining = Math.max(0, originalCents - alreadyReversed);
  const requested = input.cents > 0 ? input.cents : remaining;
  const debitCents = Math.min(remaining, requested);
  if (debitCents <= 0) {
    return { duplicate: true, reversed: false, shortfallCents: 0 };
  }
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: BILLING_SYSTEM_USER_ID,
  });
  const result = await billing.debitWallet({
    operationId: `polar_refund:${input.refundKey}`,
    cents: debitCents,
    source: 'polar_refund',
    freezeOnShortfall: true,
    metadata: { order_id: input.orderId, cents: debitCents },
  });
  return {
    duplicate: result.duplicate,
    reversed: !result.duplicate,
    shortfallCents: result.shortfallCents,
  };
}

export async function settleTeamMeter(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  meterId: BillingMeterId;
  nativeUnits: number;
  customerChargeCents: number;
  operationClass?: string;
  provider?: string;
  source?: string;
  billable?: boolean;
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: BillingReserveFailureCode }> {
  const userId = input.userId ?? BILLING_SYSTEM_USER_ID;
  const billing = billingScope({ db: input.db, teamId: input.teamId, userId });
  const reserved = await billing.reserve({
    operationId: input.operationId,
    meterId: input.meterId,
    reservedNativeUnits: input.nativeUnits,
    reservedChargeCents: input.customerChargeCents,
  });
  if (!reserved.ok) return reserved;
  await billing.settle({
    operationId: input.operationId,
    meterId: input.meterId,
    nativeUnits: input.nativeUnits,
    customerChargeCents: input.customerChargeCents,
    ...(input.operationClass ? { operationClass: input.operationClass } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.billable !== undefined ? { billable: input.billable } : {}),
  });
  return { ok: true, duplicate: false };
}

export async function meterAcceptedSources(input: {
  db: Db;
  teamId: string;
  userId?: string;
  rawEventIds: string[];
}): Promise<{ ok: true } | { ok: false; code: BillingReserveFailureCode }> {
  if (input.rawEventIds.length === 0) return { ok: true };
  let previous = await currentMeterNativeUnits(input.db, input.teamId, 'accepted_sources');
  for (const rawEventId of input.rawEventIds) {
    const next = previous + 1;
    const result = await settleTeamMeter({
      db: input.db,
      teamId: input.teamId,
      ...(input.userId ? { userId: input.userId } : {}),
      operationId: `accepted_source:${rawEventId}`,
      meterId: 'accepted_sources',
      nativeUnits: 1,
      customerChargeCents: cumulativeChargeDeltaCents({
        meterId: 'accepted_sources',
        previousNativeUnits: previous,
        nextNativeUnits: next,
      }),
      operationClass: 'ingest',
      source: 'event_writer',
    });
    if (!result.ok) return result;
    previous = next;
  }
  return { ok: true };
}

export async function reserveEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  units: number;
}): Promise<
  { ok: true; alreadySettled?: boolean } | { ok: false; code: BillingReserveFailureCode }
> {
  const units = Math.max(0, Math.trunc(input.units));
  if (units === 0) return { ok: true };
  const previous = await currentMeterNativeUnits(input.db, input.teamId, 'email_units');
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId ?? BILLING_SYSTEM_USER_ID,
  });
  const reserved = await billing.reserve({
    operationId: input.operationId,
    meterId: 'email_units',
    reservedNativeUnits: units,
    reservedChargeCents: cumulativeChargeDeltaCents({
      meterId: 'email_units',
      previousNativeUnits: previous,
      nextNativeUnits: previous + units,
    }),
  });
  if (!reserved.ok) return reserved;
  return { ok: true, ...(reserved.alreadySettled ? { alreadySettled: true as const } : {}) };
}

export async function settleEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  units: number;
  operationClass: string;
}): Promise<{ ok: true } | { ok: false; code: BillingReserveFailureCode }> {
  const units = Math.max(0, Math.trunc(input.units));
  if (units === 0) return { ok: true };
  const previous = await currentMeterNativeUnits(input.db, input.teamId, 'email_units');
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId ?? BILLING_SYSTEM_USER_ID,
  });
  await billing.settle({
    operationId: input.operationId,
    meterId: 'email_units',
    nativeUnits: units,
    customerChargeCents: cumulativeChargeDeltaCents({
      meterId: 'email_units',
      previousNativeUnits: previous,
      nextNativeUnits: previous + units,
    }),
    operationClass: input.operationClass,
    provider: 'postmark',
    source: 'email',
  });
  return { ok: true };
}

export async function releaseEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
}): Promise<void> {
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId ?? BILLING_SYSTEM_USER_ID,
  });
  await billing.release(input.operationId);
}

export async function meterEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  units: number;
  operationClass: string;
}): Promise<{ ok: true } | { ok: false; code: BillingReserveFailureCode }> {
  const units = Math.max(0, Math.trunc(input.units));
  if (units === 0) return { ok: true };
  const reserved = await reserveEmailUnits(input);
  if (!reserved.ok) return reserved;
  return settleEmailUnits(input);
}

/**
 * Wrap a provider AI call: reserve worst-case, run, settle exact OpenRouter USD.
 * No-ops when no billing ALS is set (tests, unmetered internal paths).
 */
export async function withAiMetering<T>(
  input: {
    operationClass?: string;
    model?: string;
    reservedChargeCents?: number;
  },
  fn: () => Promise<{ value: T; finish?: OpenRouterFinishEvent }>,
): Promise<T> {
  const ctx = getBillingContext();
  if (!ctx || ctx.skipMeters?.has('ai')) {
    return (await fn()).value;
  }
  const operationClass = input.operationClass ?? ctx.operationClass;
  const operationId = `ai:${operationClass}:${randomUUID()}`;
  const reservedChargeCents =
    input.reservedChargeCents ?? BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS;
  const billing = billingScope(ctx);
  const reserved = await billing.reserve({
    operationId,
    meterId: 'ai',
    reservedNativeUnits: reservedChargeCents,
    reservedChargeCents,
    metadata: { operation_class: operationClass },
  });
  if (!reserved.ok) throw new BillingAdmissionError(reserved.code);
  try {
    const { value, finish } = await fn();
    const usd = finish ? openRouterUsdCostFromFinishEvent(finish) : 0;
    const { providerCostCents, customerChargeExactCents } =
      customerAiChargeCentsFromOpenRouterUsd(usd);
    await billing.settle({
      operationId,
      meterId: 'ai',
      nativeUnits: customerChargeExactCents,
      customerChargeCents: Math.round(customerChargeExactCents),
      providerCostCents,
      operationClass,
      provider: 'openrouter',
      ...(input.model ? { model: input.model } : {}),
      ...(ctx.source ? { source: ctx.source } : {}),
      ...(ctx.deliverySurface ? { deliverySurface: ctx.deliverySurface } : {}),
      billable: ctx.billable !== false,
      metadata: { openrouter_usd: usd },
    });
    return value;
  } catch (err) {
    await billing.release(operationId);
    throw err;
  }
}

export async function snapshotTeamStorageGbMonth(input: {
  db: Db;
  teamId: string;
}): Promise<{ gb: number; settled: boolean }> {
  const [row] = await input.db
    .select({
      bytes: sql<number>`COALESCE(SUM(${documentVersions.byteSize}), 0)`,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.teamId, input.teamId),
        isNull(documents.deletedAt),
        sql`${documentVersions.byteSize} IS NOT NULL`,
      ),
    );
  const gb = (row?.bytes ?? 0) / GIB;
  if (gb <= 0) return { gb: 0, settled: false };
  const day = utcDay();
  const gbMonthSlice = gb / daysInUtcMonth();
  const previous = await currentMeterNativeUnits(input.db, input.teamId, 'storage_gb_month');
  const result = await settleTeamMeter({
    db: input.db,
    teamId: input.teamId,
    operationId: `storage_gb:${input.teamId}:${day}`,
    meterId: 'storage_gb_month',
    nativeUnits: gbMonthSlice,
    customerChargeCents: cumulativeChargeDeltaCents({
      meterId: 'storage_gb_month',
      previousNativeUnits: previous,
      nextNativeUnits: previous + gbMonthSlice,
    }),
    operationClass: 'storage_snapshot',
    source: 'janitor',
  });
  return { gb, settled: result.ok };
}

export async function accrueTeamMemberDays(input: {
  db: Db;
  teamId: string;
  day?: string;
}): Promise<{ extraMembers: number; chargeCents: number }> {
  const day = input.day ?? utcDay();
  const [account] = await input.db
    .select({ planId: teamBillingAccounts.planId })
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, input.teamId))
    .limit(1);
  const planId = account?.planId ?? 'free';
  const included = PLAN_CATALOG[planId].includedActiveMembers ?? 0;
  const members = await input.db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, input.teamId), isNull(teamMembers.removedAt)));

  for (const member of members) {
    await input.db
      .insert(billingMemberDayLedger)
      .values({
        teamId: input.teamId,
        userId: member.userId,
        day,
        role: member.role,
        billable: planId !== 'free',
        chargeCents: 0,
      })
      .onConflictDoNothing();
  }

  const additionalMemberCents = PLAN_CATALOG[planId].additionalMemberCents;
  if (planId === 'free' || additionalMemberCents === null) {
    return { extraMembers: 0, chargeCents: 0 };
  }
  const extraMembers = Math.max(0, members.length - included);
  if (extraMembers === 0) {
    return { extraMembers: 0, chargeCents: 0 };
  }
  const previousNative = await currentMeterNativeUnits(input.db, input.teamId, 'member_days');
  const daysInMonth = daysInUtcMonth();
  const chargeCents =
    memberDaysChargeCents({
      extraMemberDays: previousNative + extraMembers,
      centsPerMemberMonth: additionalMemberCents,
      daysInMonth,
    }) -
    memberDaysChargeCents({
      extraMemberDays: previousNative,
      centsPerMemberMonth: additionalMemberCents,
      daysInMonth,
    });
  await settleTeamMeter({
    db: input.db,
    teamId: input.teamId,
    operationId: `member_days:${input.teamId}:${day}`,
    meterId: 'member_days',
    nativeUnits: extraMembers,
    customerChargeCents: chargeCents,
    operationClass: 'member_day',
    source: 'janitor',
    billable: true,
  });
  return { extraMembers, chargeCents };
}

export async function runBillingMaintenanceTick(db: Db): Promise<{ teams: number }> {
  await expireStaleBillingReservations({ db });
  await leaveOverdueRecallBots(db);
  await reconcileShadowBillingFromChargesEnabled(db);
  const polarProvider = createPolarBillingProvider();
  if (polarProvider) {
    await flushPendingPolarUsageIngest({ db, provider: polarProvider });
  }
  const rows = await db.select({ id: teams.id }).from(teams);
  for (const team of rows) {
    try {
      await resetIncludedDiscountIfPeriodElapsed({ db, teamId: team.id });
      await snapshotTeamStorageGbMonth({ db, teamId: team.id });
      await accrueTeamMemberDays({ db, teamId: team.id });
      const [account] = await db
        .select()
        .from(teamBillingAccounts)
        .where(eq(teamBillingAccounts.teamId, team.id))
        .limit(1);
      if (account) {
        const counters = await db
          .select()
          .from(billingUsageCounters)
          .where(
            and(
              eq(billingUsageCounters.teamId, team.id),
              eq(billingUsageCounters.periodYm, periodYm()),
            ),
          );
        await maybeTriggerWalletAutoReload({
          db,
          teamId: team.id,
          account: { ...account, shadowBilling: accountUsesShadowBilling(account) },
          meteredSpendCents: counters.reduce((sum, row) => sum + row.customerChargeCents, 0),
        });
      }
    } catch {
      // Keep the janitor tick alive if one workspace's ledger fails.
    }
  }
  return { teams: rows.length };
}

async function reconcileShadowBillingFromChargesEnabled(db: Db): Promise<void> {
  const shadowBilling = shadowBillingFromChargesEnabled();
  await db
    .update(teamBillingAccounts)
    .set({ shadowBilling, updatedAt: new Date() })
    .where(eq(teamBillingAccounts.shadowBilling, !shadowBilling));
}

export async function resetIncludedDiscountIfPeriodElapsed(input: {
  db: Db;
  teamId: string;
  now?: Date;
}): Promise<boolean> {
  const [account] = await input.db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, input.teamId))
    .limit(1);
  if (!account) return false;
  const now = input.now ?? new Date();
  const next = nextIncludedDiscountPeriod({
    now,
    periodStartedAt: account.periodStartedAt,
    periodEndsAt: account.periodEndsAt,
  });
  if (!next) return false;
  const included = PLAN_CATALOG[account.planId].includedUsageDiscountCents;
  await input.db
    .update(teamBillingAccounts)
    .set({
      includedDiscountRemainingCents: included,
      periodStartedAt: next.periodStartedAt,
      periodEndsAt: next.periodEndsAt,
      updatedAt: now,
    })
    .where(eq(teamBillingAccounts.teamId, input.teamId));
  return true;
}
