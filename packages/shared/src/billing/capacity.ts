import {
  billingUsageReservations,
  documentChunks,
  documentVersions,
  documents,
  mcpServers,
  meetings,
  teamBillingAccounts,
  teamInvites,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { and, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { BillingReserveFailureCode } from '#src/billing/admission.js';
import type { PlanCapacityUsageRow } from '#src/billing/status.js';

import { CAPACITY_BY_PLAN, PLAN_CATALOG, type BillingPlanId } from '#src/billing/catalog.js';
import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { BillingAdmissionError } from '#src/billing/errors.js';
import { createPolarBillingProvider } from '#src/billing/polar.js';
import { createBillingScope } from '#src/billing/scope.js';

const GIB = 1024 ** 3;

function admissionCodeForPlan(planId: string): BillingReserveFailureCode {
  return planId === 'free' ? 'free_allowance_reached' : 'usage_limit_reached';
}

function billingScopeForDb(db: Db, teamId: string) {
  const provider = createPolarBillingProvider() ?? undefined;
  return createBillingScope({
    db,
    teamId,
    userId: BILLING_SYSTEM_USER_ID,
    ensureMember: () => Promise.resolve('owner'),
    ...(provider ? { provider } : {}),
  });
}

/**
 * Serialize concurrent Recall count+claim on one DB client. Same-URL live-bot
 * reuse must happen before this lock.
 */
export async function runWithConcurrentRecallJoinLock<T>(
  db: Db,
  teamId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 0))`);
    return fn(tx as unknown as Db);
  });
}

/** Count + claim a joinable meeting under one advisory lock. */
export async function claimMeetingJoinUnderRecallCap(input: {
  db: Db;
  teamId: string;
  meetingId: string;
}): Promise<typeof meetings.$inferSelect | null> {
  return runWithConcurrentRecallJoinLock(input.db, input.teamId, async (tx) => {
    await assertTeamConcurrentRecallCapacity({ db: tx, teamId: input.teamId });
    const rows = await tx
      .update(meetings)
      .set({
        status: 'joining',
        updatedAt: new Date(),
        metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || '{"manual_join_claimed":true}'::jsonb`,
      })
      .where(
        and(
          eq(meetings.id, input.meetingId),
          eq(meetings.teamId, input.teamId),
          inArray(meetings.status, ['pending', 'scheduled']),
          sql`NOT EXISTS (
            SELECT 1 FROM meetings active
            WHERE active.team_id = ${meetings.teamId}
              AND active.meeting_url = ${meetings.meetingUrl}
              AND active.status IN ('joining', 'active')
              AND active.id <> ${meetings.id}
          )`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  });
}

export async function insertRestrictedFreeBillingAccount(input: {
  db: Pick<Db, 'insert' | 'update' | 'select'>;
  teamId: string;
}): Promise<void> {
  await input.db
    .insert(teamBillingAccounts)
    .values({
      teamId: input.teamId,
      planId: 'free',
      billingState: 'restricted',
      spendCapCents: 0,
      shadowBilling: true,
    })
    .onConflictDoNothing();
}

/**
 * Stock entitlements from the commercial table — not Polar meters.
 * Call this on the same DB client the caller is using, and never from
 * inside an open transaction that still uses a different client (PGlite
 * will deadlock).
 */
export async function assertTeamWriteCapacity(input: {
  db: Db;
  teamId: string;
  additionalBytes?: number;
  additionalDocuments?: number;
  additionalChunks?: number;
  excludeDocumentVersionId?: string;
}): Promise<void> {
  const billing = billingScopeForDb(input.db, input.teamId);
  const account = await billing.getAccount();
  if (account.billingState === 'restricted') {
    throw new BillingAdmissionError(
      'usage_limit_reached',
      'This extra workspace has no Free allowance. Add a payment method in Billing to write.',
    );
  }
  const cap = CAPACITY_BY_PLAN[account.planId];
  const code = admissionCodeForPlan(account.planId);

  if (cap.documents !== null && (input.additionalDocuments ?? 0) > 0) {
    const [row] = await input.db
      .select({ n: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(eq(documents.teamId, input.teamId), isNull(documents.deletedAt)));
    if ((row?.n ?? 0) + (input.additionalDocuments ?? 0) > cap.documents) {
      throw new BillingAdmissionError(code, 'Document limit reached for this plan');
    }
  }

  if (cap.storageGb !== null) {
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
    const gb = ((row?.bytes ?? 0) + (input.additionalBytes ?? 0)) / GIB;
    if (gb > cap.storageGb) {
      throw new BillingAdmissionError(code, 'Storage limit reached for this plan');
    }
  }

  if (cap.indexedChunks !== null && (input.additionalChunks ?? 0) > 0) {
    const filters = [eq(documentChunks.teamId, input.teamId)];
    if (input.excludeDocumentVersionId) {
      filters.push(ne(documentChunks.documentVersionId, input.excludeDocumentVersionId));
    }
    const [row] = await input.db
      .select({ n: sql<number>`count(*)::int` })
      .from(documentChunks)
      .where(and(...filters));
    if ((row?.n ?? 0) + (input.additionalChunks ?? 0) > cap.indexedChunks) {
      throw new BillingAdmissionError(code, 'Indexed chunk limit reached for this plan');
    }
  }
}

/**
 * Serialize concurrent member-seat count+claim on one DB client.
 * Callers must invoke this inside the membership/invite write transaction so
 * the advisory lock covers the subsequent insert. Hash key 4 is reserved for
 * member seats (0 Recall, 1 storage, 2 chunks, 3 MCP).
 */
export async function assertTeamMemberSeatCapacity(input: {
  db: Db;
  teamId: string;
  additionalSeats?: number;
  includePendingInvites?: boolean;
}): Promise<void> {
  const additionalSeats = input.additionalSeats ?? 1;
  if (additionalSeats <= 0) return;
  await input.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.teamId}, 4))`);
  const billing = billingScopeForDb(input.db, input.teamId);
  const account = await billing.getAccount();
  const max = PLAN_CATALOG[account.planId].maxActiveMembers;
  if (max === null) return;
  const [memberRow] = await input.db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, input.teamId), isNull(teamMembers.removedAt)));
  const includePendingInvites = input.includePendingInvites ?? true;
  let pendingInvites = 0;
  if (includePendingInvites) {
    const [inviteRow] = await input.db
      .select({ n: sql<number>`count(*)::int` })
      .from(teamInvites)
      .where(
        and(
          eq(teamInvites.teamId, input.teamId),
          isNull(teamInvites.acceptedAt),
          isNull(teamInvites.revokedAt),
          sql`${teamInvites.expiresAt} > now()`,
        ),
      );
    pendingInvites = inviteRow?.n ?? 0;
  }
  if ((memberRow?.n ?? 0) + pendingInvites + additionalSeats > max) {
    throw new BillingAdmissionError(
      admissionCodeForPlan(account.planId),
      'Active member limit reached for this plan',
    );
  }
}

export async function assertTeamCustomMcpCapacity(input: {
  db: Db;
  teamId: string;
  additionalServers?: number;
}): Promise<void> {
  const additionalServers = input.additionalServers ?? 1;
  if (additionalServers <= 0) return;
  const billing = billingScopeForDb(input.db, input.teamId);
  const account = await billing.getAccount();
  const cap = CAPACITY_BY_PLAN[account.planId].customMcpServers;
  if (cap === null) return;
  const [row] = await input.db
    .select({ n: sql<number>`count(*)::int` })
    .from(mcpServers)
    .where(eq(mcpServers.teamId, input.teamId));
  if ((row?.n ?? 0) + additionalServers > cap) {
    throw new BillingAdmissionError(
      admissionCodeForPlan(account.planId),
      'Custom MCP server limit reached for this plan',
    );
  }
}

function utcMonthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function countOrZero(row: { n?: number } | undefined): number {
  return row?.n ?? 0;
}

/**
 * Live used/limit for stock the product actually gates. Does not invent Polar
 * meters, and omits catalog fields that stay on Redis burst buckets (webhook /
 * search) or billed native meters (inbound email, accepted sources, Recall minutes).
 */
export async function getTeamCapacityUsage(input: {
  db: Db;
  teamId: string;
  planId: BillingPlanId;
}): Promise<PlanCapacityUsageRow[]> {
  const cap = CAPACITY_BY_PLAN[input.planId];
  const maxMembers = PLAN_CATALOG[input.planId].maxActiveMembers;
  const periodStart = utcMonthStart();
  const [documentRow, storageRow, chunkRow, memberRow, inviteRow, mcpRow, recallRow, turnRow] =
    await Promise.all([
      input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(eq(documents.teamId, input.teamId), isNull(documents.deletedAt)))
        .then((rows) => rows[0]),
      input.db
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
        )
        .then((rows) => rows[0]),
      input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documentChunks)
        .where(eq(documentChunks.teamId, input.teamId))
        .then((rows) => rows[0]),
      input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, input.teamId), isNull(teamMembers.removedAt)))
        .then((rows) => rows[0]),
      input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(teamInvites)
        .where(
          and(
            eq(teamInvites.teamId, input.teamId),
            isNull(teamInvites.acceptedAt),
            isNull(teamInvites.revokedAt),
            sql`${teamInvites.expiresAt} > now()`,
          ),
        )
        .then((rows) => rows[0]),
      input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(mcpServers)
        .where(eq(mcpServers.teamId, input.teamId))
        .then((rows) => rows[0]),
      input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(meetings)
        .where(
          and(eq(meetings.teamId, input.teamId), inArray(meetings.status, ['joining', 'active'])),
        )
        .then((rows) => rows[0]),
      input.db
        .select({ n: sql<number>`count(*)::int` })
        .from(billingUsageReservations)
        .where(
          and(
            eq(billingUsageReservations.teamId, input.teamId),
            sql`${billingUsageReservations.operationId} LIKE 'ask:%'`,
            gte(billingUsageReservations.createdAt, periodStart),
          ),
        )
        .then((rows) => rows[0]),
    ]);

  const storageGbUsed = (storageRow?.bytes ?? 0) / GIB;
  const memberSeatsUsed = countOrZero(memberRow) + countOrZero(inviteRow);

  return [
    {
      kind: 'agent_turns',
      label: 'Ask turns',
      used: countOrZero(turnRow),
      limit: cap.agentTurnsPerMonth,
    },
    {
      kind: 'concurrent_recall_bots',
      label: 'Concurrent meeting notetakers',
      used: countOrZero(recallRow),
      limit: cap.concurrentRecallBots,
    },
    {
      kind: 'custom_mcp_servers',
      label: 'Custom MCP servers',
      used: countOrZero(mcpRow),
      limit: cap.customMcpServers,
    },
    {
      kind: 'documents',
      label: 'Documents',
      used: countOrZero(documentRow),
      limit: cap.documents,
    },
    {
      kind: 'storage_gb',
      label: 'Storage',
      used: storageGbUsed,
      limit: cap.storageGb,
    },
    {
      kind: 'indexed_chunks',
      label: 'Indexed chunks',
      used: countOrZero(chunkRow),
      limit: cap.indexedChunks,
    },
    {
      kind: 'active_members',
      label: 'Active members',
      used: memberSeatsUsed,
      limit: maxMembers,
    },
  ];
}

/**
 * Live Recall bots in `joining` / `active`. Catalog capacity, not a Polar meter.
 * Call before claiming a new bot so the current join is not already in the count.
 */
export async function assertTeamConcurrentRecallCapacity(input: {
  db: Db;
  teamId: string;
  additionalBots?: number;
}): Promise<void> {
  const additionalBots = input.additionalBots ?? 1;
  if (additionalBots <= 0) return;
  const billing = billingScopeForDb(input.db, input.teamId);
  const account = await billing.getAccount();
  if (account.billingState === 'restricted') {
    throw new BillingAdmissionError(
      'usage_limit_reached',
      'This extra workspace has no Free allowance. Add a payment method in Billing to start a notetaker.',
    );
  }
  const cap = CAPACITY_BY_PLAN[account.planId].concurrentRecallBots;
  if (cap === null) return;
  const [row] = await input.db
    .select({ n: sql<number>`count(*)::int` })
    .from(meetings)
    .where(and(eq(meetings.teamId, input.teamId), inArray(meetings.status, ['joining', 'active'])));
  if ((row?.n ?? 0) + additionalBots > cap) {
    throw new BillingAdmissionError(
      admissionCodeForPlan(account.planId),
      'Concurrent meeting notetaker limit reached for this plan',
    );
  }
}

/**
 * First owned workspace claims the person-level Free grant. Extra workspaces
 * stay readable but do not mint another Free allowance (strategy §6).
 */
export async function applyOwnedTeamFreeGrant(input: {
  db: Pick<Db, 'select' | 'insert' | 'update'>;
  teamId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; reason: 'free_grant_elsewhere' | 'email_unverified' }> {
  const [owner] = await input.db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!owner?.emailVerified) {
    await input.db
      .update(teamBillingAccounts)
      .set({
        billingState: 'restricted',
        spendCapCents: 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teamBillingAccounts.teamId, input.teamId),
          eq(teamBillingAccounts.planId, 'free'),
          sql`${teamBillingAccounts.polarSubscriptionId} IS NULL`,
        ),
      );
    await insertRestrictedFreeBillingAccount({ db: input.db, teamId: input.teamId });
    return { ok: false, reason: 'email_unverified' };
  }
  const billing = createBillingScope({
    // Transaction clients are not assignable to Db (`$client` is pool-only).
    db: input.db as unknown as Db,
    teamId: input.teamId,
    userId: input.userId,
    ensureMember: () => Promise.resolve('owner'),
  });
  const grant = await billing.claimFreeGrant();
  if (grant.ok) {
    await input.db
      .update(teamBillingAccounts)
      .set({
        billingState: 'free',
        spendCapCents: PLAN_CATALOG.free.defaultSpendCapCents,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teamBillingAccounts.teamId, input.teamId),
          eq(teamBillingAccounts.planId, 'free'),
          eq(teamBillingAccounts.billingState, 'restricted'),
        ),
      );
    return { ok: true };
  }
  await input.db
    .update(teamBillingAccounts)
    .set({
      billingState: 'restricted',
      spendCapCents: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(teamBillingAccounts.teamId, input.teamId),
        eq(teamBillingAccounts.planId, 'free'),
        sql`${teamBillingAccounts.polarSubscriptionId} IS NULL`,
      ),
    );
  await insertRestrictedFreeBillingAccount({ db: input.db, teamId: input.teamId });
  return { ok: false, reason: 'free_grant_elsewhere' };
}

/** After credentials email verification, claim Free on owned restricted workspaces. */
export async function claimOwnedTeamFreeGrantsForVerifiedUser(input: {
  db: Db;
  userId: string;
}): Promise<void> {
  const owned = await input.db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, input.userId), eq(teamMembers.role, 'owner')));
  for (const row of owned) {
    await applyOwnedTeamFreeGrant({
      db: input.db,
      teamId: row.teamId,
      userId: input.userId,
    });
  }
}
