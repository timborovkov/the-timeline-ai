import {
  type Db,
  billingFreeGrants,
  billingUsageCounters,
  billingUsageLedger,
  billingUsageReservations,
  teamBillingAccounts,
  teamMembers,
} from '@timeline/db';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import type { BillingProvider } from '#src/billing/provider.js';
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
  isUniqueViolation,
  paygOverageCustomerChargeCents,
  paygOverageNativeUnits,
  splitDiscountAndWallet,
  walletReservedCentsFromMetadata,
} from '#src/billing/charge.js';
import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { cheapestPlanPreview } from '#src/billing/preview.js';
import { expireStaleBillingReservations } from '#src/billing/reservations.js';
import {
  costBearingPausedFromAccount,
  billingStateAllowsReservation,
  deriveBillingNudge,
  deriveSidebarBillingSummary,
  freeAllowanceConsumedForMeter,
  freeAllowanceRemaining,
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
      const planPreview = cheapestPlanPreview({
        activeMembers: activeMemberCount,
        meters: byMeter,
      });
      return {
        account,
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
          shadowBilling: account.shadowBilling,
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
      const [row] = await db
        .update(teamBillingAccounts)
        .set({ spendCapCents, updatedAt: new Date() })
        .where(eq(teamBillingAccounts.teamId, teamId))
        .returning();
      if (!row) throw new Error('Failed to update spend cap');
      return row;
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
      try {
        const [created] = await db
          .insert(billingFreeGrants)
          .values({ userId, assignedTeamId: teamId })
          .returning();
        if (!created) throw new Error('Failed to create free grant');
        return { ok: true as const, grant: created };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
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
        if (!raced) throw err;
        return { ok: true as const, grant: raced };
      }
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
      const agentTurnCap = CAPACITY_BY_PLAN[account.planId].agentTurnsPerMonth;
      if (
        agentTurnCap !== null &&
        (input.operationId.startsWith('ask:') || input.metadata?.operation_class === 'agent_ask')
      ) {
        const periodStart = new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
        );
        const [turnRow] = await db
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
          return { ok: false as const, code: 'usage_limit_reached' as const };
        }
      }
      const expiresAt = new Date(Date.now() + (input.ttlMs ?? 15 * 60_000));
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

      // Free plan hard-stops at native allowances even while shadow billing is on.
      if (account.planId === 'free' && account.billingState !== 'enterprise_active') {
        const allowance = freeAllowanceConsumedForMeter(input.meterId, byMeter);
        if (allowance) {
          const next =
            allowance.unit === 'cents'
              ? allowance.consumed + input.reservedChargeCents
              : allowance.consumed + input.reservedNativeUnits;
          if (next > allowance.limit) {
            return { ok: false as const, code: 'free_allowance_reached' as const };
          }
        }
      }

      const billableChargeCents = paygOverageCustomerChargeCents({
        planId: account.planId,
        meterId: input.meterId,
        nativeUnits: input.reservedNativeUnits,
        listChargeCents: input.reservedChargeCents,
        meters: byMeter,
      });
      const { walletCents, discountCents } = splitDiscountAndWallet({
        chargeCents: billableChargeCents,
        includedDiscountRemainingCents: account.includedDiscountRemainingCents,
      });

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

        const blocking =
          !locked.shadowBilling &&
          locked.billingState !== 'enterprise_active' &&
          billableChargeCents > 0;
        if (blocking) {
          const available = locked.walletBalanceCents - locked.reservedBalanceCents;
          if (walletCents > available) {
            return { kind: 'reject' as const, code: 'usage_limit_reached' as const };
          }
          if (locked.spendCapCents > 0) {
            const pending = await tx
              .select({
                metadata: billingUsageReservations.metadata,
                reservedChargeCents: billingUsageReservations.reservedChargeCents,
              })
              .from(billingUsageReservations)
              .where(
                and(
                  eq(billingUsageReservations.teamId, teamId),
                  eq(billingUsageReservations.state, 'reserved'),
                ),
              );
            const pendingBillable = pending.reduce((sum, row) => {
              const raw = row.metadata.billable_charge_cents;
              const cents =
                typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
                  ? raw
                  : Math.max(0, row.reservedChargeCents);
              return sum + cents;
            }, 0);
            const countersTx = await tx
              .select({ customerChargeCents: billingUsageCounters.customerChargeCents })
              .from(billingUsageCounters)
              .where(
                and(eq(billingUsageCounters.teamId, teamId), eq(billingUsageCounters.periodYm, ym)),
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

        const [row] = await tx
          .insert(billingUsageReservations)
          .values({
            teamId,
            operationId: input.operationId,
            meterId: input.meterId,
            reservedNativeUnits: String(input.reservedNativeUnits),
            reservedChargeCents: walletCents,
            expiresAt,
            metadata: {
              ...(input.metadata ?? {}),
              list_charge_cents: input.reservedChargeCents,
              billable_charge_cents: billableChargeCents,
              discount_reserved_cents: discountCents,
              wallet_reserved_cents: walletCents,
            },
          })
          .onConflictDoNothing()
          .returning();
        if (!row) return { kind: 'conflict' as const };
        if (blocking && walletCents > 0) {
          await tx
            .update(teamBillingAccounts)
            .set({
              reservedBalanceCents: sql`${teamBillingAccounts.reservedBalanceCents} + ${walletCents}`,
              updatedAt: new Date(),
            })
            .where(eq(teamBillingAccounts.teamId, teamId));
        }
        return { kind: 'created' as const, row };
      });

      if (outcome.kind === 'reject') {
        return { ok: false as const, code: outcome.code };
      }
      if (outcome.kind === 'conflict') {
        const existing = await db
          .select()
          .from(billingUsageReservations)
          .where(
            and(
              eq(billingUsageReservations.teamId, teamId),
              eq(billingUsageReservations.operationId, input.operationId),
            ),
          )
          .limit(1);
        const reservation = existing[0];
        if (!reservation) throw new Error('Reservation conflict without existing row');
        return { ok: true as const, reservation, reused: true as const };
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
      const ym = periodYm();
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

        const countersBefore = await tx
          .select()
          .from(billingUsageCounters)
          .where(
            and(eq(billingUsageCounters.teamId, teamId), eq(billingUsageCounters.periodYm, ym)),
          );
        const metersBefore = Object.fromEntries(
          countersBefore.map((row) => [
            row.meterId,
            {
              nativeUnits: Number(row.nativeUnits),
              customerChargeCents: row.customerChargeCents,
            },
          ]),
        ) as Partial<Record<BillingMeterId, { nativeUnits: number; customerChargeCents: number }>>;
        const actualChargeCents = paygOverageCustomerChargeCents({
          planId: account.planId,
          meterId: input.meterId,
          nativeUnits: input.nativeUnits,
          listChargeCents: input.customerChargeCents,
          meters: metersBefore,
        });
        const { discountCents, walletCents } = splitDiscountAndWallet({
          chargeCents: actualChargeCents,
          includedDiscountRemainingCents: account.includedDiscountRemainingCents,
        });

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
              list_charge_cents: input.customerChargeCents,
              discount_cents: discountCents,
              wallet_cents: walletCents,
            },
          })
          .onConflictDoNothing()
          .returning();

        if (!ledgerRow) {
          return { duplicate: true as const };
        }

        await tx
          .insert(billingUsageCounters)
          .values({
            teamId,
            periodYm: ym,
            meterId: input.meterId,
            nativeUnits: String(input.nativeUnits),
            customerChargeCents: actualChargeCents,
          })
          .onConflictDoUpdate({
            target: [
              billingUsageCounters.teamId,
              billingUsageCounters.periodYm,
              billingUsageCounters.meterId,
            ],
            set: {
              nativeUnits: sql`${billingUsageCounters.nativeUnits} + ${String(input.nativeUnits)}`,
              customerChargeCents: sql`${billingUsageCounters.customerChargeCents} + ${actualChargeCents}`,
              updatedAt: new Date(),
            },
          });

        const walletLockCents =
          reservation[0]?.state === 'reserved'
            ? walletReservedCentsFromMetadata(
                reservation[0].metadata,
                reservation[0].reservedChargeCents,
              )
            : 0;
        if (reservation[0]?.state === 'reserved') {
          await tx
            .update(billingUsageReservations)
            .set({ state: 'settled', updatedAt: new Date() })
            .where(eq(billingUsageReservations.id, reservation[0].id));
        }

        if (
          !account.shadowBilling &&
          (walletLockCents > 0 || walletCents > 0 || discountCents > 0)
        ) {
          await tx
            .update(teamBillingAccounts)
            .set({
              reservedBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.reservedBalanceCents} - ${walletLockCents})`,
              walletBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.walletBalanceCents} - ${walletCents})`,
              includedDiscountRemainingCents: sql`GREATEST(0, ${teamBillingAccounts.includedDiscountRemainingCents} - ${discountCents})`,
              updatedAt: new Date(),
            })
            .where(eq(teamBillingAccounts.teamId, teamId));
        }

        return {
          duplicate: false as const,
          ledger: ledgerRow,
          actualChargeCents,
          polarUnits: paygOverageNativeUnits({
            planId: account.planId,
            meterId: input.meterId,
            nativeUnits: input.nativeUnits,
            meters: metersBefore,
          }),
          eventName: polarEventNameForMeter(input.meterId),
          polarCustomerId: account.polarCustomerId,
          shadowBilling: account.shadowBilling,
          planId: account.planId,
          spendCapCents: account.spendCapCents,
        };
      });

      if (settled.duplicate) {
        return { ok: true as const, duplicate: true as const };
      }

      if (
        provider &&
        settled.eventName &&
        settled.polarCustomerId &&
        !settled.shadowBilling &&
        input.billable !== false &&
        settled.polarUnits > 0
      ) {
        await provider.ingestUsage({
          externalCustomerId: teamId,
          name: settled.eventName,
          units: settled.polarUnits,
          metadata: {
            operation_id: input.operationId,
            charge_cents: settled.actualChargeCents,
          },
        });
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
              and(eq(billingUsageCounters.teamId, teamId), eq(billingUsageCounters.periodYm, ym)),
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
      const account = await ensureAccount();
      const existing = await db
        .select()
        .from(billingUsageReservations)
        .where(
          and(
            eq(billingUsageReservations.teamId, teamId),
            eq(billingUsageReservations.operationId, operationId),
          ),
        )
        .limit(1);
      const reservation = existing[0];
      if (!reservation) return { ok: true as const, missing: true as const };
      if (reservation.state !== 'reserved') {
        return { ok: true as const, missing: false as const, alreadyFinal: true as const };
      }
      await db
        .update(billingUsageReservations)
        .set({ state: 'released', updatedAt: new Date() })
        .where(eq(billingUsageReservations.id, reservation.id));
      if (!account.shadowBilling) {
        const lockCents = walletReservedCentsFromMetadata(
          reservation.metadata,
          reservation.reservedChargeCents,
        );
        if (lockCents > 0) {
          await db
            .update(teamBillingAccounts)
            .set({
              reservedBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.reservedBalanceCents} - ${lockCents})`,
              updatedAt: new Date(),
            })
            .where(eq(teamBillingAccounts.teamId, teamId));
        }
      }
      return { ok: true as const, missing: false as const, alreadyFinal: false as const };
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
        const nextState =
          account.billingState === 'balance_exhausted' ? 'payg_active' : account.billingState;
        await tx
          .update(teamBillingAccounts)
          .set({
            walletBalanceCents: sql`${teamBillingAccounts.walletBalanceCents} + ${input.cents}`,
            billingState: nextState,
            updatedAt: new Date(),
          })
          .where(eq(teamBillingAccounts.teamId, teamId));
        return { ok: true as const, duplicate: false as const };
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
