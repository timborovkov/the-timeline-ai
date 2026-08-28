import {
  type Db,
  billingFreeGrants,
  billingMemberDayLedger,
  billingUsageCounters,
  billingUsageLedger,
  billingUsageReservations,
  teamBillingAccounts,
  teamMembers,
} from '@timeline/db';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import type { BillingProvider, PolarUsageEvent } from '#src/billing/provider.js';
import type { TeamRole } from '#src/team-scope.js';

import { notifyBillingUsageAlerts } from '#src/billing/alerts.js';
import { maybeTriggerWalletAutoReload } from '#src/billing/auto-reload.js';
import {
  BILLING_ENTITLEMENTS_VERSION,
  type BillingMeterId,
  type BillingPlanId,
  CAPACITY_BY_PLAN,
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  PREPAID_TOPUP_CENTS,
  planUsesPrepaidWallet,
  polarEventNameForMeter,
} from '#src/billing/catalog.js';
import {
  cumulativeChargeDeltaCents,
  metersPlusPendingReservations,
  paygOverageCustomerChargeCents,
  paygOverageNativeUnits,
  pendingBillableChargeCents,
  pendingDiscountReservedCents,
  settlementSegmentsForMeter,
  shouldIngestPolarMeteredUsage,
  splitDiscountAndWallet,
  walletLockCentsFromMetadata,
} from '#src/billing/charge.js';
import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { cheapestPlanPreview } from '#src/billing/preview.js';
import { expireStaleBillingReservations } from '#src/billing/reservations.js';
import { accountUsesShadowBilling } from '#src/billing/shadow.js';
import {
  billingStateAllowsReservation,
  costBearingPausedFromAccount,
  deriveBillingNudge,
  deriveSidebarBillingSummary,
  freeAllowanceConsumedForMeter,
  freeAllowanceRemaining,
  restoredPaidBillingStateAfterWalletOrCapRecovery,
  restoredSpendCapCentsAfterShortfallUnfreeze,
  spendCapUtilization,
} from '#src/billing/status.js';
import { childLogger } from '#src/logger.js';

export type EnsureMember = (minRole?: TeamRole) => Promise<TeamRole>;

export interface BillingScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: EnsureMember;
  provider?: BillingProvider;
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

function outstandingWalletShortfallCents(metadata: Record<string, unknown>): number {
  const shortfall = metadata.wallet_shortfall_cents;
  const collected = metadata.wallet_shortfall_collected_cents;
  const owed = typeof shortfall === 'number' && Number.isFinite(shortfall) ? shortfall : 0;
  const paid = typeof collected === 'number' && Number.isFinite(collected) ? collected : 0;
  return Math.max(0, Math.trunc(owed) - Math.trunc(paid));
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

async function ingestPolarUsageIfPending(input: {
  db: Db;
  teamId: string;
  operationId: string;
  metadata: Record<string, unknown>;
  provider?: BillingProvider;
}): Promise<void> {
  const event = polarIngestEventFromMetadata(input.metadata);
  if (!event || !input.provider) return;
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
      const plan = PLAN_CATALOG[account.planId];
      const capacity = CAPACITY_BY_PLAN[account.planId];
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
      const planPreview = cheapestPlanPreview({
        activeMembers: activeMemberCount,
        meters: byMeter,
        includedActiveMembers: PLAN_CATALOG[account.planId].includedActiveMembers,
        billableMemberDays: memberDayRow?.billableMemberDays ?? 0,
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
        availableWalletCents: Math.max(
          0,
          account.walletBalanceCents - account.reservedBalanceCents,
        ),
        /** True when live charges would block the next costly action. */
        costBearingPaused: costBearingPausedFromAccount({
          planId: account.planId,
          billingState: account.billingState,
          shadowBilling,
          spendCapCents: account.spendCapCents,
          meteredSpendCents,
          walletBalanceCents: account.walletBalanceCents,
          reservedBalanceCents: account.reservedBalanceCents,
          includedDiscountRemainingCents: account.includedDiscountRemainingCents,
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
        if (!billingStateAllowsReservation(locked.billingState)) {
          return { kind: 'reject' as const, code: 'usage_limit_reached' as const };
        }
        if (isAskTurn) {
          const agentTurnCap = CAPACITY_BY_PLAN[locked.planId].agentTurnsPerMonth;
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
        const costlyWorkerCap = CAPACITY_BY_PLAN[locked.planId].costlyWorkerConcurrency;
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

        if (locked.planId === 'free' && locked.billingState !== 'enterprise_active') {
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

        const billableChargeCents = paygOverageCustomerChargeCents({
          planId: locked.planId,
          meterId: input.meterId,
          nativeUnits: input.reservedNativeUnits,
          listChargeCents: input.reservedChargeCents,
          meters: metersForAdmission,
        });
        const pendingDiscount = pending.reduce(
          (sum, row) => sum + pendingDiscountReservedCents(row.metadata),
          0,
        );
        const remainingDiscount = Math.max(
          0,
          locked.includedDiscountRemainingCents - pendingDiscount,
        );
        const { walletCents, discountCents } = splitDiscountAndWallet({
          chargeCents: billableChargeCents,
          includedDiscountRemainingCents: remainingDiscount,
          meterId: input.meterId,
        });
        const blocking =
          !accountUsesShadowBilling(locked) &&
          locked.billingState !== 'enterprise_active' &&
          billableChargeCents > 0;
        const walletLockCents = blocking && walletCents > 0 ? walletCents : 0;
        const reservationMetadata = {
          ...(input.metadata ?? {}),
          list_charge_cents: input.reservedChargeCents,
          billable_charge_cents: billableChargeCents,
          discount_reserved_cents: discountCents,
          wallet_reserved_cents: walletCents,
          wallet_lock_cents: walletLockCents,
        };

        if (blocking) {
          const available = locked.walletBalanceCents - locked.reservedBalanceCents;
          if (walletCents > available) {
            return { kind: 'reject' as const, code: 'usage_limit_reached' as const };
          }
          if (locked.planId !== 'free') {
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
        }

        const [created] = await tx
          .insert(billingUsageReservations)
          .values({
            teamId,
            operationId: input.operationId,
            meterId: input.meterId,
            reservedNativeUnits: String(input.reservedNativeUnits),
            reservedChargeCents: walletCents,
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
            reservedChargeCents: walletCents,
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

        const startedAt = reservation[0]?.createdAt ?? new Date();
        const segments = settlementSegmentsForMeter({
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
        const segmentCharges = segments.map((segment) => {
          const metersBefore = metersByPeriod.get(segment.periodYm) ?? {};
          const previousNative = metersBefore[input.meterId]?.nativeUnits ?? 0;
          const listChargeCents = cumulativeChargeDeltaCents({
            meterId: input.meterId,
            previousNativeUnits: previousNative,
            nextNativeUnits: previousNative + segment.nativeUnits,
          });
          const actualChargeCents = paygOverageCustomerChargeCents({
            planId: account.planId,
            meterId: input.meterId,
            nativeUnits: segment.nativeUnits,
            listChargeCents,
            meters: metersBefore,
          });
          const polarUnits = paygOverageNativeUnits({
            planId: account.planId,
            meterId: input.meterId,
            nativeUnits: segment.nativeUnits,
            meters: metersBefore,
          });
          return { ...segment, listChargeCents, actualChargeCents, polarUnits, metersBefore };
        });
        const listChargeCents = segmentCharges.reduce((sum, row) => sum + row.listChargeCents, 0);
        const actualChargeCents = segmentCharges.reduce(
          (sum, row) => sum + row.actualChargeCents,
          0,
        );
        const polarUnits = segmentCharges.reduce((sum, row) => sum + row.polarUnits, 0);
        const countersBefore = countersBeforeRows.filter((row) => row.periodYm === primaryYm);
        const { discountCents, walletCents } = splitDiscountAndWallet({
          chargeCents: actualChargeCents,
          includedDiscountRemainingCents: account.includedDiscountRemainingCents,
          meterId: input.meterId,
        });
        const enterpriseContract =
          account.planId === 'enterprise' || account.billingState === 'enterprise_active';
        const eventName = polarEventNameForMeter(input.meterId);
        const shouldIngestPolar = shouldIngestPolarMeteredUsage({
          eventName,
          polarCustomerId: account.polarCustomerId,
          shadowBilling: accountUsesShadowBilling(account),
          billable: input.billable !== false,
          polarUnits,
          // Enterprise is invoiced on Polar, not collected from prepaid wallet
          // or included discount. Passing those splits would skip ingest.
          walletCents: enterpriseContract ? 0 : walletCents,
          discountCents: enterpriseContract ? 0 : discountCents,
        });
        const polarIngestMetadata = shouldIngestPolar
          ? {
              polar_ingest_status: 'pending',
              polar_ingest_name: eventName,
              polar_ingest_units: polarUnits,
              polar_ingest_customer_id: teamId,
              polar_ingest_operation_id: input.operationId,
              polar_ingest_charge_cents: actualChargeCents,
            }
          : { polar_ingest_status: 'not_required' };

        const applyCharges = !accountUsesShadowBilling(account);
        const walletShortfallCents =
          applyCharges && !enterpriseContract && walletCents > account.walletBalanceCents
            ? walletCents - account.walletBalanceCents
            : 0;
        const periodSpendCents = countersBefore.reduce(
          (sum, row) => sum + row.customerChargeCents,
          0,
        );
        const spendCapExceeded =
          applyCharges &&
          !enterpriseContract &&
          account.planId !== 'free' &&
          periodSpendCents + actualChargeCents > account.spendCapCents;
        const freezeAccount = walletShortfallCents > 0 || spendCapExceeded;

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
              list_charge_cents: listChargeCents,
              discount_cents: discountCents,
              wallet_cents: walletCents,
              ...(walletShortfallCents > 0 ? { wallet_shortfall_cents: walletShortfallCents } : {}),
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

        if (
          walletLockCents > 0 ||
          (applyCharges && (walletCents > 0 || discountCents > 0)) ||
          freezeAccount
        ) {
          await tx
            .update(teamBillingAccounts)
            .set({
              ...(walletLockCents > 0
                ? {
                    reservedBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.reservedBalanceCents} - ${walletLockCents})`,
                  }
                : {}),
              ...(applyCharges && !enterpriseContract && (walletCents > 0 || discountCents > 0)
                ? {
                    walletBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.walletBalanceCents} - ${walletCents})`,
                    includedDiscountRemainingCents: sql`GREATEST(0, ${teamBillingAccounts.includedDiscountRemainingCents} - ${discountCents})`,
                  }
                : {}),
              ...(freezeAccount ? { billingState: 'read_only' as const, spendCapCents: 0 } : {}),
              updatedAt: new Date(),
            })
            .where(eq(teamBillingAccounts.teamId, teamId));
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

      try {
        const [after] = await db
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .limit(1);
        if (after) {
          const countersNow = await db
            .select()
            .from(billingUsageCounters)
            .where(
              and(
                eq(billingUsageCounters.teamId, teamId),
                eq(billingUsageCounters.periodYm, periodYm()),
              ),
            );
          await maybeTriggerWalletAutoReload({
            db,
            teamId,
            account: after,
            meteredSpendCents: countersNow.reduce((sum, row) => sum + row.customerChargeCents, 0),
            ...(provider ? { provider } : {}),
          });
        }
      } catch (err) {
        log.warn({ err, teamId }, 'wallet auto-reload trigger failed');
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

    async creditWallet(input: { operationId: string; cents: number; source?: string }) {
      await ensureMember('admin');
      if (!Number.isInteger(input.cents) || input.cents <= 0) {
        throw new Error('top-up amount must be a positive integer (euro cents)');
      }
      await ensureAccount();
      return db.transaction(async (tx) => {
        const [ledgerRow] = await tx
          .insert(billingUsageLedger)
          .values({
            teamId,
            operationId: input.operationId,
            kind: 'top_up',
            meterId: 'ai',
            nativeUnits: '0',
            customerChargeCents: 0,
            billable: false,
            nonBillableReason: 'wallet_top_up',
            operationClass: 'wallet_top_up',
            source: input.source ?? 'polar',
            actorUserId: userId === BILLING_SYSTEM_USER_ID ? null : userId,
            metadata: { cents: input.cents },
          })
          .onConflictDoNothing()
          .returning();
        if (!ledgerRow) return { ok: true as const, duplicate: true as const };
        const [account] = await tx
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .limit(1)
          .for('update');
        if (!account) throw new Error('Missing billing account');
        const shortfallRows = await tx
          .select({
            id: billingUsageLedger.id,
            metadata: billingUsageLedger.metadata,
          })
          .from(billingUsageLedger)
          .where(
            and(
              eq(billingUsageLedger.teamId, teamId),
              inArray(billingUsageLedger.kind, ['settlement', 'reversal']),
            ),
          )
          .orderBy(asc(billingUsageLedger.createdAt));
        let remainingCollection = input.cents;
        let collectedCents = 0;
        for (const row of shortfallRows) {
          const outstanding = outstandingWalletShortfallCents(row.metadata);
          if (outstanding <= 0 || remainingCollection <= 0) continue;
          const take = Math.min(outstanding, remainingCollection);
          remainingCollection -= take;
          collectedCents += take;
          const already =
            typeof row.metadata.wallet_shortfall_collected_cents === 'number'
              ? row.metadata.wallet_shortfall_collected_cents
              : 0;
          const patch = JSON.stringify({
            wallet_shortfall_collected_cents: already + take,
          });
          await tx
            .update(billingUsageLedger)
            .set({
              metadata: sql`COALESCE(${billingUsageLedger.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
            })
            .where(eq(billingUsageLedger.id, row.id));
        }
        const creditCents = input.cents - collectedCents;
        const remainingDebt =
          shortfallRows.reduce(
            (sum, row) => sum + outstandingWalletShortfallCents(row.metadata),
            0,
          ) - collectedCents;
        const restoredState =
          remainingDebt <= 0
            ? restoredPaidBillingStateAfterWalletOrCapRecovery({
                planId: account.planId,
                billingState: account.billingState,
              })
            : null;
        const restoredCap = restoredState
          ? restoredSpendCapCentsAfterShortfallUnfreeze({
              planId: account.planId,
              spendCapCents: account.spendCapCents,
            })
          : null;
        if (collectedCents > 0) {
          const topUpPatch = JSON.stringify({
            cents: input.cents,
            shortfall_collected_cents: collectedCents,
          });
          await tx
            .update(billingUsageLedger)
            .set({
              metadata: sql`COALESCE(${billingUsageLedger.metadata}, '{}'::jsonb) || ${topUpPatch}::jsonb`,
            })
            .where(eq(billingUsageLedger.id, ledgerRow.id));
        }
        await tx
          .update(teamBillingAccounts)
          .set({
            walletBalanceCents: sql`${teamBillingAccounts.walletBalanceCents} + ${creditCents}`,
            billingState: restoredState ?? account.billingState,
            ...(restoredCap !== null ? { spendCapCents: restoredCap } : {}),
            updatedAt: new Date(),
          })
          .where(eq(teamBillingAccounts.teamId, teamId));
        return { ok: true as const, duplicate: false as const };
      });
    },

    async debitWallet(input: {
      operationId: string;
      cents: number;
      source?: string;
      freezeOnShortfall?: boolean;
      metadata?: Record<string, unknown>;
    }) {
      await ensureMember('admin');
      if (!Number.isInteger(input.cents) || input.cents <= 0) {
        throw new Error('refund amount must be a positive integer (euro cents)');
      }
      await ensureAccount();
      return db.transaction(async (tx) => {
        const [ledgerRow] = await tx
          .insert(billingUsageLedger)
          .values({
            teamId,
            operationId: input.operationId,
            kind: 'reversal',
            meterId: 'ai',
            nativeUnits: '0',
            customerChargeCents: 0,
            billable: false,
            nonBillableReason: 'wallet_refund',
            operationClass: 'wallet_refund',
            source: input.source ?? 'polar',
            actorUserId: userId === BILLING_SYSTEM_USER_ID ? null : userId,
            metadata: { cents: input.cents, ...(input.metadata ?? {}) },
          })
          .onConflictDoNothing()
          .returning();
        if (!ledgerRow) return { ok: true as const, duplicate: true as const, shortfallCents: 0 };
        const [account] = await tx
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .limit(1)
          .for('update');
        if (!account) throw new Error('Missing billing account');
        const debit = Math.min(account.walletBalanceCents, input.cents);
        const shortfallCents = Math.max(0, input.cents - debit);
        const freeze = Boolean(input.freezeOnShortfall) && shortfallCents > 0;
        await tx
          .update(teamBillingAccounts)
          .set({
            walletBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.walletBalanceCents} - ${debit})`,
            ...(freeze ? { billingState: 'read_only' as const, spendCapCents: 0 } : {}),
            updatedAt: new Date(),
          })
          .where(eq(teamBillingAccounts.teamId, teamId));
        return { ok: true as const, duplicate: false as const, shortfallCents };
      });
    },

    async setAutoReload(input: {
      enabled: boolean;
      thresholdCents?: number | null;
      amountCents?: number | null;
    }) {
      await ensureMember('admin');
      const account = await ensureAccount();
      if (input.enabled && !planUsesPrepaidWallet(account.planId)) {
        throw new Error('Auto-reload is available on paid plans that spend the prepaid wallet.');
      }
      const [row] = await db
        .update(teamBillingAccounts)
        .set({
          autoReloadEnabled: input.enabled,
          autoReloadThresholdCents: input.enabled ? (input.thresholdCents ?? 500) : null,
          autoReloadAmountCents: input.enabled ? (input.amountCents ?? PREPAID_TOPUP_CENTS) : null,
          updatedAt: new Date(),
        })
        .where(eq(teamBillingAccounts.teamId, teamId))
        .returning();
      if (!row) throw new Error('Failed to update auto-reload');
      return row;
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
