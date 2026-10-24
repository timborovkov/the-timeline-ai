import {
  type Db,
  billingFreeGrants,
  billingMemberDayLedger,
  billingUnbilledAlerts,
  billingUsageCounters,
  billingUsageLedger,
  billingUsageReservations,
  teamBillingAccounts,
  teamMembers,
} from '@timeline/db';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import type { BillingProvider, PolarUsageEvent } from '#src/billing/provider.js';
import type { TeamRole } from '#src/team-scope.js';

import { notifyBillingUsageAlerts } from '#src/billing/alerts.js';
import {
  BILLING_ENTITLEMENTS_VERSION,
  type BillingMeterId,
  type BillingPlanId,
  CAPACITY_BY_PLAN,
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  polarEventNameForMeter,
} from '#src/billing/catalog.js';
import {
  cumulativeBillableChargeCents,
  cumulativeChargeDeltaCents,
  daysInPeriodYm,
  memberDayChargeDelta,
  metersPlusPendingReservations,
  paygOverageCustomerChargeCents,
  pendingBillableChargeCents,
  pendingDiscountReservedCents,
  billingMeterIdForPolarEvent,
  polarCatalogUnitsForInvoiceCents,
  polarIngestDisposition,
  polarSubscriptionCoversMeter,
  POLAR_INGEST_BLOCK_MISSING_PRICE,
  settlementSegmentsForMeter,
  splitDiscountAndWallet,
  type PolarIngestDisposition,
  type PolarPlanProductIds,
  walletLockCentsFromMetadata,
} from '#src/billing/charge.js';
import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import {
  applyMeteredDiscountCents,
  compCostBearingPaused,
  compSuppressesPolarCharges,
  contractualEnterpriseAccount,
  effectiveBillingPlanId,
  resolveTeamCommercialTerms,
} from '#src/billing/operator.js';
import { cheapestPlanPreview, type PlanCommercialOverride } from '#src/billing/preview.js';
import { expireStaleBillingReservations } from '#src/billing/reservations.js';
import { accountUsesShadowBilling } from '#src/billing/shadow.js';
import {
  allFreeAllowancesExhausted,
  billingStateAllowsReservation,
  costBearingPausedFromAccount,
  deriveBillingNudge,
  deriveSidebarBillingSummary,
  freeAllowanceConsumedForMeter,
  freeAllowanceRemaining,
  restoredPaidBillingStateAfterWalletOrCapRecovery,
  spendCapUtilization,
} from '#src/billing/status.js';
import { getEnv } from '#src/env.js';
import { childLogger } from '#src/logger.js';

export type EnsureMember = (minRole?: TeamRole) => Promise<TeamRole>;

export interface BillingScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: EnsureMember;
  provider?: BillingProvider;
}

function polarPlanProductsFromEnv(): PolarPlanProductIds {
  const env = getEnv();
  return {
    ...(env.POLAR_PRODUCT_ID_PAYG ? { payg: env.POLAR_PRODUCT_ID_PAYG } : {}),
    ...(env.POLAR_PRODUCT_ID_TEAM ? { team: env.POLAR_PRODUCT_ID_TEAM } : {}),
    ...(env.POLAR_PRODUCT_ID_BUSINESS ? { business: env.POLAR_PRODUCT_ID_BUSINESS } : {}),
    ...(env.POLAR_PRODUCT_ID_ENTERPRISE ? { enterprise: env.POLAR_PRODUCT_ID_ENTERPRISE } : {}),
  };
}

function periodYm(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function defaultSpendCapForPlan(planId: BillingPlanId): number {
  return PLAN_CATALOG[planId].defaultSpendCapCents;
}

function polarIngestEventFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): PolarUsageEvent | null {
  if (!metadata) return null;
  const status = metadata.polar_ingest_status;
  if (status !== 'pending' && status !== 'in_progress') return null;
  const name = metadata.polar_ingest_name;
  const units = metadata.polar_ingest_units;
  const externalCustomerId = metadata.polar_ingest_customer_id;
  if (
    typeof name !== 'string' ||
    typeof units !== 'number' ||
    !Number.isFinite(units) ||
    typeof externalCustomerId !== 'string'
  ) {
    return null;
  }
  const operationId = metadata.polar_ingest_operation_id;
  const chargeCents = metadata.polar_ingest_charge_cents;
  return {
    name,
    units,
    externalCustomerId,
    ...(typeof operationId === 'string'
      ? { id: polarUsageEventId(externalCustomerId, operationId) }
      : {}),
    metadata: {
      ...(typeof operationId === 'string' ? { operation_id: operationId } : {}),
      ...(typeof chargeCents === 'number' ? { charge_cents: chargeCents } : {}),
    },
  };
}

function polarUsageEventId(teamId: string, operationId: string): string {
  return `timeline:${teamId}:${operationId}`;
}

function reservationWorkerSource(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const source = metadata.source;
  return typeof source === 'string' && source.length > 0 ? source : null;
}

const POLAR_INGEST_CLAIM_STALE_MS = 15 * 60 * 1000;

async function markPolarIngestStatus(
  db: Db,
  teamId: string,
  operationId: string,
  status: 'pending' | 'completed' | 'not_required' | 'in_progress',
  extra?: Record<string, unknown>,
): Promise<void> {
  await db
    .update(billingUsageLedger)
    .set({
      metadata: sql`${billingUsageLedger.metadata} || ${JSON.stringify({
        polar_ingest_status: status,
        ...extra,
      })}::jsonb`,
    })
    .where(
      and(eq(billingUsageLedger.teamId, teamId), eq(billingUsageLedger.operationId, operationId)),
    );
}

async function claimPolarIngestRow(input: {
  db: Db;
  teamId: string;
  operationId: string;
}): Promise<Record<string, unknown> | null> {
  const staleBefore = new Date(Date.now() - POLAR_INGEST_CLAIM_STALE_MS).toISOString();
  const claimedAt = new Date().toISOString();
  const [row] = await input.db
    .update(billingUsageLedger)
    .set({
      metadata: sql`${billingUsageLedger.metadata} || ${JSON.stringify({
        polar_ingest_status: 'in_progress',
        polar_ingest_claimed_at: claimedAt,
      })}::jsonb`,
    })
    .where(
      and(
        eq(billingUsageLedger.teamId, input.teamId),
        eq(billingUsageLedger.operationId, input.operationId),
        sql`(
          ${billingUsageLedger.metadata}->>'polar_ingest_status' = 'pending'
          OR (
            ${billingUsageLedger.metadata}->>'polar_ingest_status' = 'in_progress'
            AND COALESCE(
              ${billingUsageLedger.metadata}->>'polar_ingest_claimed_at',
              '1970-01-01T00:00:00.000Z'
            ) < ${staleBefore}
          )
        )`,
      ),
    )
    .returning({ metadata: billingUsageLedger.metadata });
  return row?.metadata ?? null;
}

function meterIdFromIngestMetadata(metadata: Record<string, unknown>, eventName: string): string {
  const stored = metadata.polar_ingest_meter;
  if (typeof stored === 'string' && stored.length > 0) return stored;
  return billingMeterIdForPolarEvent(eventName) ?? eventName;
}

function periodYmFromIngestMetadata(metadata: Record<string, unknown>): string {
  const stored = metadata.polar_ingest_period_ym;
  if (typeof stored === 'string' && stored.length > 0) return stored;
  return periodYm();
}

async function recordMissingSubscriptionPriceAlert(
  db: Db,
  input: { teamId: string; meterId: string; periodYm: string; detail: string },
): Promise<void> {
  await db
    .insert(billingUnbilledAlerts)
    .values({
      teamId: input.teamId,
      meterId: input.meterId,
      periodYm: input.periodYm,
      reason: POLAR_INGEST_BLOCK_MISSING_PRICE,
      detail: input.detail,
    })
    .onConflictDoNothing();
}

async function resolveUnbilledAlerts(db: Db, teamId: string, meterId: string): Promise<void> {
  await db
    .update(billingUnbilledAlerts)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(billingUnbilledAlerts.teamId, teamId),
        eq(billingUnbilledAlerts.meterId, meterId),
        isNull(billingUnbilledAlerts.resolvedAt),
      ),
    );
}

async function pricedEventNamesForProduct(
  provider: BillingProvider | undefined,
  productId: string | null | undefined,
): Promise<readonly string[] | null> {
  if (!productId) return [];
  if (!provider?.listPricedEventNames) return null;
  try {
    return await provider.listPricedEventNames(productId);
  } catch {
    return null;
  }
}

async function dispositionForLiveAccount(
  account: typeof teamBillingAccounts.$inferSelect,
  event: PolarUsageEvent,
  provider: BillingProvider | undefined,
): Promise<PolarIngestDisposition> {
  const chargeCents = event.metadata?.charge_cents;
  const invoiceCents = typeof chargeCents === 'number' ? chargeCents : 0;
  const pricedEventNames = await pricedEventNamesForProduct(provider, account.polarProductId);
  return polarIngestDisposition({
    eventName: event.name,
    polarCustomerId: account.polarCustomerId,
    shadowBilling: accountUsesShadowBilling(account),
    comped: compSuppressesPolarCharges(account),
    billable: true,
    polarUnits: event.units,
    invoiceCents,
    subscriptionCoversMeter: polarSubscriptionCoversMeter({
      planId: account.planId,
      billingState: account.billingState,
      polarSubscriptionId: account.polarSubscriptionId,
      polarProductId: account.polarProductId,
      eventName: event.name,
      products: polarPlanProductsFromEnv(),
      pricedEventNames,
    }),
  });
}

async function ingestPolarUsageIfPending(input: {
  db: Db;
  teamId: string;
  operationId: string;
  metadata: Record<string, unknown>;
  provider?: BillingProvider;
}): Promise<void> {
  const event = polarIngestEventFromMetadata(input.metadata);
  if (!event) return;
  const [account] = await input.db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, input.teamId))
    .limit(1);
  const disposition = account
    ? await dispositionForLiveAccount(account, event, input.provider)
    : 'hold';
  // Shadow and comps are not billed. Leave the row pending so a later live
  // period can still invoice a charge that was payable when it was recorded.
  if (disposition === 'not_required') return;
  if (disposition === 'hold') {
    await recordMissingSubscriptionPriceAlert(input.db, {
      teamId: input.teamId,
      meterId: meterIdFromIngestMetadata(input.metadata, event.name),
      periodYm: periodYmFromIngestMetadata(input.metadata),
      detail: `${event.name} has no matching active subscription price`,
    });
    return;
  }
  if (!input.provider) return;
  const claimed = await claimPolarIngestRow({
    db: input.db,
    teamId: input.teamId,
    operationId: input.operationId,
  });
  if (!claimed) return;
  const claimedEvent = polarIngestEventFromMetadata(claimed) ?? event;
  try {
    await input.provider.ingestUsage(claimedEvent);
    await markPolarIngestStatus(input.db, input.teamId, input.operationId, 'completed');
    await resolveUnbilledAlerts(
      input.db,
      input.teamId,
      meterIdFromIngestMetadata(claimed, claimedEvent.name),
    );
  } catch (err) {
    await markPolarIngestStatus(input.db, input.teamId, input.operationId, 'pending');
    throw err;
  }
}

export function createBillingScope(deps: BillingScopeDeps) {
  const { db, teamId, userId, ensureMember, provider } = deps;
  const log = childLogger('billing:scope');

  async function ensureAccount() {
    const existing = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, teamId))
      .limit(1);
    if (existing[0]) return existing[0];
    const [created] = await db
      .insert(teamBillingAccounts)
      .values({
        teamId,
        planId: 'free',
        billingState: 'free',
        securityState: 'normal',
        entitlementsVersion: BILLING_ENTITLEMENTS_VERSION,
        spendCapCents: defaultSpendCapForPlan('free'),
        shadowBilling: true,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const again = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, teamId))
      .limit(1);
    if (!again[0]) throw new Error('Failed to ensure team billing account');
    return again[0];
  }

  return {
    async getAccount() {
      await ensureMember();
      return ensureAccount();
    },

    async getDashboard(options?: { canManageBilling?: boolean }) {
      await ensureMember();
      const account = await ensureAccount();
      const commercial = resolveTeamCommercialTerms(account);
      const plan = PLAN_CATALOG[commercial.planId];
      const capacity = CAPACITY_BY_PLAN[commercial.planId];
      const ym = periodYm();
      const counters = await db
        .select()
        .from(billingUsageCounters)
        .where(and(eq(billingUsageCounters.teamId, teamId), eq(billingUsageCounters.periodYm, ym)));
      const byMeter = Object.fromEntries(
        counters.map((row) => [
          row.meterId,
          {
            nativeUnits: Number(row.nativeUnits),
            customerChargeCents: row.customerChargeCents,
          },
        ]),
      ) as Partial<Record<BillingMeterId, { nativeUnits: number; customerChargeCents: number }>>;
      const meteredSpendCents = counters.reduce((sum, row) => sum + row.customerChargeCents, 0);
      const utilization = spendCapUtilization(meteredSpendCents, account.spendCapCents);
      const freeRemaining = freeAllowanceRemaining(byMeter);
      const canManageBilling = options?.canManageBilling ?? false;
      const nudge = deriveBillingNudge({
        planId: account.planId,
        canManageBilling,
        utilization,
        freeRemaining,
        meteredSpendCents,
      });
      const sidebar = deriveSidebarBillingSummary({
        planId: account.planId,
        canManageBilling,
        meteredSpendCents,
        spendCapCents: account.spendCapCents,
        includedDiscountRemainingCents: account.includedDiscountRemainingCents,
        freeRemaining,
      });
      const [memberCountRow] = await db
        .select({
          activeMemberCount: sql<number>`count(*)::int`,
        })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt)));
      const activeMemberCount = memberCountRow?.activeMemberCount ?? 0;
      const [memberDayRow] = await db
        .select({
          billableMemberDays: sql<number>`count(*)::int`,
        })
        .from(billingMemberDayLedger)
        .where(
          and(
            eq(billingMemberDayLedger.teamId, teamId),
            sql`${billingMemberDayLedger.day} LIKE ${`${ym}-%`}`,
          ),
        );
      const previewTerms: PlanCommercialOverride = {
        ...(commercial.platformFeeCents !== null
          ? { platformFeeCents: commercial.platformFeeCents }
          : {}),
        includedActiveMembers: commercial.includedActiveMembers,
        ...(commercial.additionalMemberCents !== null
          ? { additionalMemberCents: commercial.additionalMemberCents }
          : {}),
        ...(commercial.meteredDiscountPercent !== null
          ? { meteredDiscountPercent: commercial.meteredDiscountPercent }
          : {}),
      };
      const planPreview = cheapestPlanPreview({
        activeMembers: activeMemberCount,
        meters: byMeter,
        includedActiveMembers: commercial.includedActiveMembers,
        billableMemberDays: memberDayRow?.billableMemberDays ?? 0,
        ...(commercial.planId === 'payg' ||
        commercial.planId === 'team' ||
        commercial.planId === 'business'
          ? { planTerms: { [commercial.planId]: previewTerms } }
          : {}),
      });
      const shadowBilling = accountUsesShadowBilling(account);
      return {
        account: { ...account, shadowBilling },
        plan,
        capacity,
        freeAllowances: FREE_ALLOWANCES,
        freeRemaining,
        utilization,
        nudge,
        sidebar,
        periodYm: ym,
        meters: byMeter,
        meteredSpendCents,
        activeMemberCount,
        planPreview,
        /** True when live charges would block the next costly action. */
        costBearingPaused: compSuppressesPolarCharges(account)
          ? compCostBearingPaused({
              billingState: account.billingState,
              shadowBilling,
              entitlementsPlanId: commercial.planId,
              spendCapCents: account.spendCapCents,
              meteredSpendCents,
              freeAllowanceExhausted: allFreeAllowancesExhausted(freeRemaining),
            })
          : costBearingPausedFromAccount({
              planId: account.planId,
              billingState: account.billingState,
              shadowBilling,
              spendCapCents: account.spendCapCents,
              meteredSpendCents,
              freeRemaining,
            }),
      };
    },

    async setSpendCap(spendCapCents: number) {
      await ensureMember('admin');
      if (!Number.isInteger(spendCapCents) || spendCapCents < 0) {
        throw new Error('spendCapCents must be a non-negative integer');
      }
      await ensureAccount();
      return db.transaction(async (tx) => {
        const [account] = await tx
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .limit(1)
          .for('update');
        if (!account) throw new Error('Failed to update spend cap');
        if (compSuppressesPolarCharges(account)) {
          throw new Error('Spend cap on a comped workspace is set by Timeline operators.');
        }
        const restoredState =
          spendCapCents > 0
            ? restoredPaidBillingStateAfterWalletOrCapRecovery({
                planId: account.planId,
                billingState: account.billingState,
              })
            : null;
        const [row] = await tx
          .update(teamBillingAccounts)
          .set({
            spendCapCents,
            ...(restoredState ? { billingState: restoredState } : {}),
            updatedAt: new Date(),
          })
          .where(eq(teamBillingAccounts.teamId, teamId))
          .returning();
        if (!row) throw new Error('Failed to update spend cap');
        return row;
      });
    },

    /**
     * Claim the person-level Free grant for this team (idempotent). Extra
     * workspaces created by the same user do not receive a second grant.
     */
    async claimFreeGrant() {
      await ensureMember('owner');
      await ensureAccount();
      const existing = await db
        .select()
        .from(billingFreeGrants)
        .where(
          and(eq(billingFreeGrants.userId, userId), sql`${billingFreeGrants.revokedAt} IS NULL`),
        )
        .limit(1);
      if (existing[0]) {
        if (existing[0].assignedTeamId && existing[0].assignedTeamId !== teamId) {
          return {
            ok: false as const,
            reason: 'free_grant_elsewhere' as const,
            grant: existing[0],
          };
        }
        if (!existing[0].assignedTeamId) {
          const [updated] = await db
            .update(billingFreeGrants)
            .set({ assignedTeamId: teamId })
            .where(
              and(
                eq(billingFreeGrants.id, existing[0].id),
                isNull(billingFreeGrants.assignedTeamId),
              ),
            )
            .returning();
          if (!updated) {
            const [raced] = await db
              .select()
              .from(billingFreeGrants)
              .where(
                and(
                  eq(billingFreeGrants.userId, userId),
                  sql`${billingFreeGrants.revokedAt} IS NULL`,
                ),
              )
              .limit(1);
            if (raced?.assignedTeamId && raced.assignedTeamId !== teamId) {
              return {
                ok: false as const,
                reason: 'free_grant_elsewhere' as const,
                grant: raced,
              };
            }
            if (raced?.assignedTeamId === teamId) {
              return { ok: true as const, grant: raced };
            }
            throw new Error('Failed to assign free grant');
          }
          return { ok: true as const, grant: updated };
        }
        return { ok: true as const, grant: existing[0] };
      }
      const [created] = await db
        .insert(billingFreeGrants)
        .values({ userId, assignedTeamId: teamId })
        .onConflictDoNothing({
          target: billingFreeGrants.userId,
          where: sql`${billingFreeGrants.revokedAt} IS NULL`,
        })
        .returning();
      if (created) return { ok: true as const, grant: created };
      const [raced] = await db
        .select()
        .from(billingFreeGrants)
        .where(
          and(eq(billingFreeGrants.userId, userId), sql`${billingFreeGrants.revokedAt} IS NULL`),
        )
        .limit(1);
      if (raced?.assignedTeamId && raced.assignedTeamId !== teamId) {
        return {
          ok: false as const,
          reason: 'free_grant_elsewhere' as const,
          grant: raced,
        };
      }
      if (!raced) throw new Error('Failed to assign free grant');
      return { ok: true as const, grant: raced };
    },

    /**
     * Reserve worst-case customer charge before provider work. Fail-closed for
     * costly paths when the account cannot afford the reservation (unless
     * shadow billing is on — then we record but do not block).
     */
    async reserve(input: {
      operationId: string;
      meterId: BillingMeterId;
      reservedNativeUnits: number;
      reservedChargeCents: number;
      ttlMs?: number;
      metadata?: Record<string, unknown>;
    }) {
      await ensureMember();
      await expireStaleBillingReservations({ db, teamId });
      const account = await ensureAccount();
      if (account.securityState === 'suspended' || account.securityState === 'terminated') {
        return { ok: false as const, code: 'security_blocked' as const };
      }
      if (!billingStateAllowsReservation(account.billingState)) {
        return { ok: false as const, code: 'usage_limit_reached' as const };
      }
      const isAskTurn =
        input.operationId.startsWith('ask:') || input.metadata?.operation_class === 'agent_ask';
      const expiresAt = new Date(Date.now() + (input.ttlMs ?? 15 * 60_000));
      const ym = periodYm();

      const outcome = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .limit(1)
          .for('update');
        if (!locked) throw new Error('Missing billing account');
        if (locked.securityState === 'suspended' || locked.securityState === 'terminated') {
          return { kind: 'reject' as const, code: 'security_blocked' as const };
        }
        const [existingReservation] = await tx
          .select()
          .from(billingUsageReservations)
          .where(
            and(
              eq(billingUsageReservations.teamId, teamId),
              eq(billingUsageReservations.operationId, input.operationId),
            ),
          )
          .limit(1)
          .for('update');
        if (existingReservation?.state === 'settled') {
          return { kind: 'already_settled' as const, row: existingReservation };
        }
        if (
          existingReservation?.state === 'reserved' &&
          existingReservation.expiresAt.getTime() > Date.now()
        ) {
          return { kind: 'reused' as const, row: existingReservation };
        }
        if (!billingStateAllowsReservation(locked.billingState)) {
          return { kind: 'reject' as const, code: 'usage_limit_reached' as const };
        }
        const entitlementsPlanId = effectiveBillingPlanId(locked);
        const commercial = resolveTeamCommercialTerms(locked);
        const comped = compSuppressesPolarCharges(locked);
        const enterpriseContract = contractualEnterpriseAccount(locked);
        if (isAskTurn) {
          const agentTurnCap = CAPACITY_BY_PLAN[entitlementsPlanId].agentTurnsPerMonth;
          if (agentTurnCap !== null) {
            const periodStart = new Date(
              Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
            );
            const [turnRow] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(billingUsageReservations)
              .where(
                and(
                  eq(billingUsageReservations.teamId, teamId),
                  sql`${billingUsageReservations.operationId} LIKE 'ask:%'`,
                  gte(billingUsageReservations.createdAt, periodStart),
                ),
              );
            if ((turnRow?.n ?? 0) >= agentTurnCap) {
              return { kind: 'reject' as const, code: 'usage_limit_reached' as const };
            }
          }
        }

        const countersTx = await tx
          .select()
          .from(billingUsageCounters)
          .where(
            and(eq(billingUsageCounters.teamId, teamId), eq(billingUsageCounters.periodYm, ym)),
          );
        const pending = (
          await tx
            .select()
            .from(billingUsageReservations)
            .where(
              and(
                eq(billingUsageReservations.teamId, teamId),
                eq(billingUsageReservations.state, 'reserved'),
              ),
            )
        ).filter((row) => row.operationId !== input.operationId);
        const costlyWorkerCap = CAPACITY_BY_PLAN[entitlementsPlanId].costlyWorkerConcurrency;
        if (
          costlyWorkerCap !== null &&
          input.meterId === 'ai' &&
          reservationWorkerSource(input.metadata) === 'worker'
        ) {
          const inFlight = pending.filter(
            (row) => row.meterId === 'ai' && reservationWorkerSource(row.metadata) === 'worker',
          ).length;
          if (inFlight >= costlyWorkerCap) {
            return { kind: 'reject' as const, code: 'costly_worker_busy' as const };
          }
        }
        const byMeter = Object.fromEntries(
          countersTx.map((row) => [
            row.meterId,
            {
              nativeUnits: Number(row.nativeUnits),
              customerChargeCents: row.customerChargeCents,
            },
          ]),
        ) as Partial<Record<BillingMeterId, { nativeUnits: number; customerChargeCents: number }>>;
        const metersForAdmission = metersPlusPendingReservations(byMeter, pending);

        if (entitlementsPlanId === 'free' && !enterpriseContract) {
          const allowance = freeAllowanceConsumedForMeter(input.meterId, metersForAdmission);
          if (allowance) {
            const next =
              allowance.unit === 'cents'
                ? allowance.consumed + input.reservedChargeCents
                : allowance.consumed + input.reservedNativeUnits;
            if (next > allowance.limit) {
              return { kind: 'reject' as const, code: 'free_allowance_reached' as const };
            }
          }
        }

        const billableChargeCents = applyMeteredDiscountCents(
          paygOverageCustomerChargeCents({
            planId: entitlementsPlanId,
            meterId: input.meterId,
            nativeUnits: input.reservedNativeUnits,
            listChargeCents: input.reservedChargeCents,
            meters: metersForAdmission,
          }),
          commercial.meteredDiscountPercent,
        );
        const pendingDiscount = pending.reduce(
          (sum, row) => sum + pendingDiscountReservedCents(row.metadata),
          0,
        );
        const remainingDiscount = Math.max(
          0,
          locked.includedDiscountRemainingCents - pendingDiscount,
        );
        const inFreeNativeAllowance = entitlementsPlanId === 'free' && !enterpriseContract;
        const invoiceBillableChargeCents = inFreeNativeAllowance ? 0 : billableChargeCents;
        const { invoiceCents, discountCents } = splitDiscountAndWallet({
          chargeCents: invoiceBillableChargeCents,
          includedDiscountRemainingCents: remainingDiscount,
          meterId: input.meterId,
        });
        const walletLockCents = 0;
        const reservationMetadata = {
          ...(input.metadata ?? {}),
          list_charge_cents: input.reservedChargeCents,
          billable_charge_cents: invoiceBillableChargeCents,
          discount_reserved_cents: discountCents,
          invoice_reserved_cents: invoiceCents,
          wallet_lock_cents: walletLockCents,
        };

        const enforceSpendCap =
          !accountUsesShadowBilling(locked) &&
          !enterpriseContract &&
          (comped || entitlementsPlanId !== 'free') &&
          invoiceBillableChargeCents > 0;
        if (enforceSpendCap) {
          const pendingBillable = pending.reduce(
            (sum, row) => sum + pendingBillableChargeCents(row.metadata, row.reservedChargeCents),
            0,
          );
          const periodSpend =
            countersTx.reduce((sum, row) => sum + row.customerChargeCents, 0) +
            pendingBillable +
            billableChargeCents;
          if (periodSpend > locked.spendCapCents) {
            return { kind: 'reject' as const, code: 'spend_cap_reached' as const };
          }
        }

        const [created] = await tx
          .insert(billingUsageReservations)
          .values({
            teamId,
            operationId: input.operationId,
            meterId: input.meterId,
            reservedNativeUnits: String(input.reservedNativeUnits),
            reservedChargeCents: invoiceCents,
            expiresAt,
            metadata: reservationMetadata,
          })
          .onConflictDoNothing()
          .returning();

        const lockWallet = async (cents: number) => {
          if (cents <= 0) return;
          await tx
            .update(teamBillingAccounts)
            .set({
              reservedBalanceCents: sql`${teamBillingAccounts.reservedBalanceCents} + ${cents}`,
              updatedAt: new Date(),
            })
            .where(eq(teamBillingAccounts.teamId, teamId));
        };

        if (created) {
          await lockWallet(walletLockCents);
          return { kind: 'created' as const, row: created };
        }

        const [existing] = await tx
          .select()
          .from(billingUsageReservations)
          .where(
            and(
              eq(billingUsageReservations.teamId, teamId),
              eq(billingUsageReservations.operationId, input.operationId),
            ),
          )
          .limit(1)
          .for('update');
        if (!existing) throw new Error('Reservation conflict without existing row');
        if (existing.state === 'settled') {
          return { kind: 'already_settled' as const, row: existing };
        }
        if (existing.state === 'reserved' && existing.expiresAt.getTime() > Date.now()) {
          return { kind: 'reused' as const, row: existing };
        }

        if (existing.state === 'reserved') {
          const oldLock = walletLockCentsFromMetadata(existing.metadata);
          if (oldLock > 0) {
            await tx
              .update(teamBillingAccounts)
              .set({
                reservedBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.reservedBalanceCents} - ${oldLock})`,
                updatedAt: new Date(),
              })
              .where(eq(teamBillingAccounts.teamId, teamId));
          }
        }

        const [reactivated] = await tx
          .update(billingUsageReservations)
          .set({
            meterId: input.meterId,
            reservedNativeUnits: String(input.reservedNativeUnits),
            reservedChargeCents: invoiceCents,
            state: 'reserved',
            expiresAt,
            metadata: reservationMetadata,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(billingUsageReservations.id, existing.id),
              inArray(billingUsageReservations.state, ['reserved', 'released', 'expired']),
            ),
          )
          .returning();
        if (!reactivated) {
          const [raced] = await tx
            .select()
            .from(billingUsageReservations)
            .where(eq(billingUsageReservations.id, existing.id))
            .limit(1);
          if (raced?.state === 'settled') {
            return { kind: 'already_settled' as const, row: raced };
          }
          if (raced?.state === 'reserved') {
            return { kind: 'reused' as const, row: raced };
          }
          throw new Error('Failed to replace finalized reservation');
        }
        await lockWallet(walletLockCents);
        return { kind: 'created' as const, row: reactivated };
      });

      if (outcome.kind === 'reject') {
        return { ok: false as const, code: outcome.code };
      }
      if (outcome.kind === 'already_settled') {
        return {
          ok: true as const,
          reservation: outcome.row,
          reused: true as const,
          alreadySettled: true as const,
        };
      }
      if (outcome.kind === 'reused') {
        return { ok: true as const, reservation: outcome.row, reused: true as const };
      }

      return { ok: true as const, reservation: outcome.row, reused: false as const };
    },

    async settle(input: {
      operationId: string;
      meterId: BillingMeterId;
      nativeUnits: number;
      customerChargeCents: number;
      providerCostCents?: number;
      billable?: boolean;
      nonBillableReason?: string;
      operationClass?: string;
      provider?: string;
      model?: string;
      source?: string;
      deliverySurface?: string;
      metadata?: Record<string, unknown>;
      /** Price this settlement as the plan in force on a replayed day. */
      pricingPlanId?: BillingPlanId;
      /**
       * Extra-member price of that historical plan, in cents per member-month.
       * Live settlement omits this and uses the current commercial rate.
       */
      pricingAdditionalMemberCents?: number | null;
      /** Included-discount pool for that day. Skips the live balance when set. */
      historicalIncludedDiscountCents?: number;
      pricingPeriodYm?: string;
      /** When the usage happened. Backfills use this instead of reservation time. */
      usageAt?: Date;
    }) {
      await ensureMember();
      await ensureAccount();
      const settled = await db.transaction(async (tx) => {
        const [account] = await tx
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .limit(1)
          .for('update');
        if (!account) throw new Error('Missing billing account');
        const reservation = await tx
          .select()
          .from(billingUsageReservations)
          .where(
            and(
              eq(billingUsageReservations.teamId, teamId),
              eq(billingUsageReservations.operationId, input.operationId),
            ),
          )
          .limit(1);

        const startedAt = input.usageAt ?? reservation[0]?.createdAt ?? new Date();
        const segments =
          input.pricingPeriodYm && input.meterId !== 'recall_minutes'
            ? [{ periodYm: input.pricingPeriodYm, nativeUnits: Math.max(0, input.nativeUnits) }]
            : settlementSegmentsForMeter({
                meterId: input.meterId,
                nativeUnits: input.nativeUnits,
                startedAt,
              });
        const primaryYm = segments[0]?.periodYm ?? periodYm(startedAt);
        const uniquePeriods = [...new Set(segments.map((row) => row.periodYm))];
        const countersBeforeRows = await tx
          .select()
          .from(billingUsageCounters)
          .where(
            and(
              eq(billingUsageCounters.teamId, teamId),
              inArray(billingUsageCounters.periodYm, uniquePeriods),
            ),
          );
        const metersByPeriod = new Map<
          string,
          Partial<Record<BillingMeterId, { nativeUnits: number; customerChargeCents: number }>>
        >();
        for (const row of countersBeforeRows) {
          const current = metersByPeriod.get(row.periodYm) ?? {};
          current[row.meterId] = {
            nativeUnits: Number(row.nativeUnits),
            customerChargeCents: row.customerChargeCents,
          };
          metersByPeriod.set(row.periodYm, current);
        }
        const livePlanId = effectiveBillingPlanId(account);
        const entitlementsPlanId = input.pricingPlanId ?? livePlanId;
        const commercial = resolveTeamCommercialTerms(account);
        const meteredDiscountPercent =
          input.pricingPlanId && input.pricingPlanId !== livePlanId
            ? 0
            : commercial.meteredDiscountPercent;
        const comped = compSuppressesPolarCharges(account);
        const enterpriseContract = contractualEnterpriseAccount(account);
        // member_days ignore the caller's customerChargeCents and recompute from
        // the commercial extra-member price so a custom rate cannot be bypassed.
        // A replay passes the historical plan's rate instead of the live price.
        const memberRateCents =
          input.pricingAdditionalMemberCents !== undefined
            ? Math.max(0, input.pricingAdditionalMemberCents ?? 0)
            : (commercial.additionalMemberCents ?? 0);
        const segmentCharges = segments.map((segment) => {
          const metersBefore = metersByPeriod.get(segment.periodYm) ?? {};
          const previousNative = metersBefore[input.meterId]?.nativeUnits ?? 0;
          const nextNative = previousNative + segment.nativeUnits;
          const listChargeCents =
            input.meterId === 'member_days'
              ? memberDayChargeDelta({
                  previousNativeUnits: previousNative,
                  nextNativeUnits: nextNative,
                  centsPerMemberMonth: memberRateCents,
                  daysInMonth: daysInPeriodYm(segment.periodYm),
                })
              : cumulativeChargeDeltaCents({
                  meterId: input.meterId,
                  previousNativeUnits: previousNative,
                  nextNativeUnits: nextNative,
                });
          const billableInput = {
            planId: entitlementsPlanId,
            meterId: input.meterId,
            centsPerMemberMonth: memberRateCents,
            daysInMonth: daysInPeriodYm(segment.periodYm),
          };
          const previousBillableCents = cumulativeBillableChargeCents({
            ...billableInput,
            nativeUnits: previousNative,
          });
          const nextBillableCents = cumulativeBillableChargeCents({
            ...billableInput,
            nativeUnits: nextNative,
          });
          const actualChargeCents = Math.max(
            0,
            applyMeteredDiscountCents(nextBillableCents, meteredDiscountPercent) -
              applyMeteredDiscountCents(previousBillableCents, meteredDiscountPercent),
          );
          return { ...segment, listChargeCents, actualChargeCents, metersBefore };
        });
        const listChargeCents = segmentCharges.reduce((sum, row) => sum + row.listChargeCents, 0);
        const actualChargeCents = segmentCharges.reduce(
          (sum, row) => sum + row.actualChargeCents,
          0,
        );
        const countersBefore = countersBeforeRows.filter((row) => row.periodYm === primaryYm);
        const historicalDiscount = input.historicalIncludedDiscountCents;
        const freeAllowanceSettlement = entitlementsPlanId === 'free' && !enterpriseContract;
        const { discountCents, invoiceCents } = splitDiscountAndWallet({
          chargeCents: freeAllowanceSettlement ? 0 : actualChargeCents,
          includedDiscountRemainingCents:
            historicalDiscount ?? account.includedDiscountRemainingCents,
          meterId: input.meterId,
        });
        const eventName = polarEventNameForMeter(input.meterId);
        const unitsToInvoice = polarCatalogUnitsForInvoiceCents(input.meterId, invoiceCents);
        const pricedEventNames = await pricedEventNamesForProduct(provider, account.polarProductId);
        const disposition = polarIngestDisposition({
          eventName,
          polarCustomerId: account.polarCustomerId,
          shadowBilling: accountUsesShadowBilling(account),
          comped,
          billable: input.billable !== false,
          polarUnits: unitsToInvoice,
          invoiceCents,
          subscriptionCoversMeter: polarSubscriptionCoversMeter({
            planId: account.planId,
            billingState: account.billingState,
            polarSubscriptionId: account.polarSubscriptionId,
            polarProductId: account.polarProductId,
            eventName,
            products: polarPlanProductsFromEnv(),
            pricedEventNames,
          }),
        });
        const polarIngestMetadata =
          disposition === 'not_required' || !eventName
            ? { polar_ingest_status: 'not_required' as const }
            : {
                polar_ingest_status: 'pending' as const,
                polar_ingest_name: eventName,
                polar_ingest_units: unitsToInvoice,
                polar_ingest_customer_id: teamId,
                polar_ingest_operation_id: input.operationId,
                polar_ingest_charge_cents: invoiceCents,
                polar_ingest_meter: input.meterId,
                polar_ingest_period_ym: primaryYm,
                ...(disposition === 'hold'
                  ? { polar_ingest_block: POLAR_INGEST_BLOCK_MISSING_PRICE }
                  : {}),
              };

        const applyCharges = !accountUsesShadowBilling(account);
        const collectDiscount =
          historicalDiscount === undefined &&
          applyCharges &&
          !enterpriseContract &&
          !comped &&
          discountCents > 0;
        const periodSpendCents = countersBefore.reduce(
          (sum, row) => sum + row.customerChargeCents,
          0,
        );
        const spendCapExceeded =
          applyCharges &&
          !enterpriseContract &&
          (comped || entitlementsPlanId !== 'free') &&
          periodSpendCents + actualChargeCents > account.spendCapCents;
        const freezeAccount = spendCapExceeded;

        const [ledgerRow] = await tx
          .insert(billingUsageLedger)
          .values({
            teamId,
            operationId: input.operationId,
            kind: 'settlement',
            meterId: input.meterId,
            nativeUnits: String(input.nativeUnits),
            providerCostCents: input.providerCostCents ?? null,
            customerChargeCents: actualChargeCents,
            billable: input.billable ?? true,
            nonBillableReason: input.nonBillableReason ?? null,
            operationClass: input.operationClass ?? null,
            provider: input.provider ?? null,
            model: input.model ?? null,
            actorUserId: userId === BILLING_SYSTEM_USER_ID ? null : userId,
            source: input.source ?? null,
            deliverySurface: input.deliverySurface ?? null,
            reservationId: reservation[0]?.id ?? null,
            metadata: {
              ...(input.metadata ?? {}),
              ...(input.pricingPlanId ? { pricing_plan_id: input.pricingPlanId } : {}),
              ...(input.pricingPeriodYm ? { pricing_period_ym: input.pricingPeriodYm } : {}),
              list_charge_cents: listChargeCents,
              discount_cents: discountCents,
              invoice_cents: invoiceCents,
              ...(segmentCharges.length > 1
                ? {
                    period_segments: segmentCharges.map((row) => ({
                      period_ym: row.periodYm,
                      native_units: row.nativeUnits,
                      customer_charge_cents: row.actualChargeCents,
                    })),
                  }
                : {}),
              ...polarIngestMetadata,
            },
          })
          .onConflictDoNothing()
          .returning();

        if (!ledgerRow) {
          const [existingLedger] = await tx
            .select()
            .from(billingUsageLedger)
            .where(
              and(
                eq(billingUsageLedger.teamId, teamId),
                eq(billingUsageLedger.operationId, input.operationId),
              ),
            )
            .limit(1);
          return {
            duplicate: true as const,
            ledger: existingLedger ?? null,
            planId: account.planId,
            spendCapCents: account.spendCapCents,
          };
        }

        for (const segment of segmentCharges) {
          await tx
            .insert(billingUsageCounters)
            .values({
              teamId,
              periodYm: segment.periodYm,
              meterId: input.meterId,
              nativeUnits: String(segment.nativeUnits),
              customerChargeCents: segment.actualChargeCents,
            })
            .onConflictDoUpdate({
              target: [
                billingUsageCounters.teamId,
                billingUsageCounters.periodYm,
                billingUsageCounters.meterId,
              ],
              set: {
                nativeUnits: sql`${billingUsageCounters.nativeUnits} + ${String(segment.nativeUnits)}`,
                customerChargeCents: sql`${billingUsageCounters.customerChargeCents} + ${segment.actualChargeCents}`,
                updatedAt: new Date(),
              },
            });
        }

        const walletLockCents =
          reservation[0]?.state === 'reserved'
            ? walletLockCentsFromMetadata(reservation[0].metadata)
            : 0;
        if (reservation[0]?.state === 'reserved') {
          await tx
            .update(billingUsageReservations)
            .set({ state: 'settled', updatedAt: new Date() })
            .where(
              and(
                eq(billingUsageReservations.id, reservation[0].id),
                eq(billingUsageReservations.state, 'reserved'),
              ),
            );
        }

        if (walletLockCents > 0 || collectDiscount || freezeAccount) {
          await tx
            .update(teamBillingAccounts)
            .set({
              ...(walletLockCents > 0
                ? {
                    reservedBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.reservedBalanceCents} - ${walletLockCents})`,
                  }
                : {}),
              ...(collectDiscount
                ? {
                    includedDiscountRemainingCents: sql`GREATEST(0, ${teamBillingAccounts.includedDiscountRemainingCents} - ${discountCents})`,
                  }
                : {}),
              ...(freezeAccount ? { billingState: 'read_only' as const, spendCapCents: 0 } : {}),
              updatedAt: new Date(),
            })
            .where(eq(teamBillingAccounts.teamId, teamId));
        }

        if (disposition === 'hold' && eventName) {
          await recordMissingSubscriptionPriceAlert(tx as unknown as Db, {
            teamId,
            meterId: input.meterId,
            periodYm: primaryYm,
            detail: `${eventName} has no matching active subscription price`,
          });
        }

        return {
          duplicate: false as const,
          ledger: ledgerRow,
          planId: account.planId,
          spendCapCents: freezeAccount ? 0 : account.spendCapCents,
        };
      });

      try {
        if (settled.ledger) {
          await ingestPolarUsageIfPending({
            db,
            teamId,
            operationId: input.operationId,
            metadata: settled.ledger.metadata,
            ...(provider ? { provider } : {}),
          });
        }
      } catch (err) {
        log.warn({ err, teamId, operationId: input.operationId }, 'polar usage ingest deferred');
      }

      if (settled.duplicate) {
        return { ok: true as const, duplicate: true as const };
      }

      try {
        const ymNow = periodYm();
        const countersAfter = await db
          .select()
          .from(billingUsageCounters)
          .where(
            and(eq(billingUsageCounters.teamId, teamId), eq(billingUsageCounters.periodYm, ymNow)),
          );
        const byMeter = Object.fromEntries(
          countersAfter.map((row) => [
            row.meterId,
            {
              nativeUnits: Number(row.nativeUnits),
              customerChargeCents: row.customerChargeCents,
            },
          ]),
        );
        const meteredSpendCents = countersAfter.reduce(
          (sum, row) => sum + row.customerChargeCents,
          0,
        );
        await notifyBillingUsageAlerts({
          db,
          teamId,
          planId: settled.planId,
          spendCapCents: settled.spendCapCents,
          meteredSpendCents,
          meters: byMeter,
        });
      } catch (err) {
        log.warn({ err, teamId }, 'billing usage alert notification failed');
      }

      return { ok: true as const, duplicate: false as const, ledger: settled.ledger };
    },

    /** Release an unused reservation (failed work, cancelled meeting, etc.). */
    async release(operationId: string) {
      await ensureMember();
      await ensureAccount();
      return db.transaction(async (tx) => {
        const [reservation] = await tx
          .update(billingUsageReservations)
          .set({ state: 'released', updatedAt: new Date() })
          .where(
            and(
              eq(billingUsageReservations.teamId, teamId),
              eq(billingUsageReservations.operationId, operationId),
              eq(billingUsageReservations.state, 'reserved'),
            ),
          )
          .returning();
        if (!reservation) {
          const [existing] = await tx
            .select({ id: billingUsageReservations.id })
            .from(billingUsageReservations)
            .where(
              and(
                eq(billingUsageReservations.teamId, teamId),
                eq(billingUsageReservations.operationId, operationId),
              ),
            )
            .limit(1);
          return {
            ok: true as const,
            missing: !existing,
            alreadyFinal: Boolean(existing),
          };
        }
        const [account] = await tx
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .limit(1)
          .for('update');
        if (!account) throw new Error('Missing billing account');
        const lockCents = walletLockCentsFromMetadata(reservation.metadata);
        if (lockCents > 0) {
          await tx
            .update(teamBillingAccounts)
            .set({
              reservedBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.reservedBalanceCents} - ${lockCents})`,
              updatedAt: new Date(),
            })
            .where(eq(teamBillingAccounts.teamId, teamId));
        }
        return { ok: true as const, missing: false as const, alreadyFinal: false as const };
      });
    },

    async patchReservationMetadata(operationId: string, metadata: Record<string, unknown>) {
      await ensureMember();
      await ensureAccount();
      const patch = JSON.stringify(metadata);
      await db
        .update(billingUsageReservations)
        .set({
          metadata: sql`COALESCE(${billingUsageReservations.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(billingUsageReservations.teamId, teamId),
            eq(billingUsageReservations.operationId, operationId),
            eq(billingUsageReservations.state, 'reserved'),
          ),
        );
    },
  };
}

export type BillingScope = ReturnType<typeof createBillingScope>;

export async function flushPendingPolarUsageIngest(input: {
  db: Db;
  provider?: BillingProvider | null;
  teamId?: string;
}): Promise<number> {
  if (!input.provider) return 0;
  const rows = await input.db
    .select({
      teamId: billingUsageLedger.teamId,
      operationId: billingUsageLedger.operationId,
      metadata: billingUsageLedger.metadata,
    })
    .from(billingUsageLedger)
    .where(
      and(
        sql`(
          ${billingUsageLedger.metadata}->>'polar_ingest_status' = 'pending'
          OR ${billingUsageLedger.metadata}->>'polar_ingest_status' = 'in_progress'
        )`,
        ...(input.teamId ? [eq(billingUsageLedger.teamId, input.teamId)] : []),
      ),
    );
  let flushed = 0;
  for (const row of rows) {
    try {
      await ingestPolarUsageIfPending({
        db: input.db,
        teamId: row.teamId,
        operationId: row.operationId,
        metadata: row.metadata,
        provider: input.provider,
      });
      flushed += 1;
    } catch {
      // Leave pending for the next maintenance tick.
    }
  }
  return flushed;
}
