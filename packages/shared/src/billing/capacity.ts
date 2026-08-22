import {
  documentChunks,
  documentVersions,
  documents,
  mcpServers,
  meetings,
  teamBillingAccounts,
  teamInvites,
  teamMembers,
  type Db,
} from '@timeline/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { BillingReserveFailureCode } from '#src/billing/admission.js';

import { CAPACITY_BY_PLAN, PLAN_CATALOG } from '#src/billing/catalog.js';
import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { BillingAdmissionError } from '#src/billing/errors.js';
import { createBillingScope } from '#src/billing/scope.js';

const GIB = 1024 ** 3;

function admissionCodeForPlan(planId: string): BillingReserveFailureCode {
  return planId === 'free' ? 'free_allowance_reached' : 'usage_limit_reached';
}

function billingScopeForDb(db: Db, teamId: string) {
  return createBillingScope({
    db,
    teamId,
    userId: BILLING_SYSTEM_USER_ID,
    ensureMember: () => Promise.resolve('owner'),
  });
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

export async function assertTeamMemberSeatCapacity(input: {
  db: Db;
  teamId: string;
  additionalSeats?: number;
}): Promise<void> {
  const additionalSeats = input.additionalSeats ?? 1;
  if (additionalSeats <= 0) return;
  const billing = billingScopeForDb(input.db, input.teamId);
  const account = await billing.getAccount();
  const max = PLAN_CATALOG[account.planId].maxActiveMembers;
  if (max === null) return;
  const [memberRow] = await input.db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, input.teamId), isNull(teamMembers.removedAt)));
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
  if ((memberRow?.n ?? 0) + (inviteRow?.n ?? 0) + additionalSeats > max) {
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
  db: Db;
  teamId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; reason: 'free_grant_elsewhere' }> {
  const billing = createBillingScope({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId,
    ensureMember: () => Promise.resolve('owner'),
  });
  const grant = await billing.claimFreeGrant();
  if (grant.ok) return { ok: true };
  await input.db
    .update(teamBillingAccounts)
    .set({
      billingState: 'restricted',
      spendCapCents: 0,
      updatedAt: new Date(),
    })
    .where(eq(teamBillingAccounts.teamId, input.teamId));
  return { ok: false, reason: 'free_grant_elsewhere' };
}
