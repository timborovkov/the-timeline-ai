import { randomUUID } from 'node:crypto';

import {
  auditLog,
  chatSessions,
  diagnosticReports,
  teams,
  teamMembers,
  type Db,
} from '@timeline/db';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { encryptJson } from '#src/crypto/secrets.js';
import {
  diagnosticInput,
  diagnosticPage,
  DIAGNOSTIC_PAGE_SIZE,
} from '#src/diagnostics/contract.js';

export function createDiagnosticScope({
  db,
  teamId,
  userId,
  ensureMember,
}: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}) {
  const own = and(eq(diagnosticReports.teamId, teamId), eq(diagnosticReports.userId, userId));
  async function currentMember(tx: Pick<Db, 'select'>, admin = false) {
    const [member] = await tx
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .for('update');
    if (!member || (admin && member.role !== 'owner' && member.role !== 'admin'))
      throw new Error('Current membership required');
  }
  async function settings() {
    await ensureMember();
    const [team] = await db
      .select({ enabled: teams.diagnosticSharingEnabled })
      .from(teams)
      .where(eq(teams.id, teamId));
    return { enabled: team?.enabled ?? false };
  }
  async function configure(enabled: boolean) {
    z.boolean().parse(enabled);
    await ensureMember('admin');
    await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for('update');
      await currentMember(tx, true);
      await tx.update(teams).set({ diagnosticSharingEnabled: enabled }).where(eq(teams.id, teamId));
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'diagnostics.sharing.updated',
        targetType: 'team',
        targetId: teamId,
        metadata: { enabled },
      });
    });
  }
  async function submit(input: unknown) {
    const parsed = diagnosticInput.safeParse(input);
    if (!parsed.success) throw new Error('Invalid diagnostic report');
    await ensureMember();
    return db.transaction(async (tx) => {
      // Serialize disablement, quota checks, and submission for this workspace.
      const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for('update');
      await currentMember(tx);
      if (!team?.diagnosticSharingEnabled || team.disabledAt || team.deletionStartedAt)
        throw new Error('Sharing unavailable');
      const [session] = await tx
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.id, parsed.data.sessionId),
            eq(chatSessions.teamId, teamId),
            eq(chatSessions.createdBy, userId),
            isNull(chatSessions.archivedAt),
          ),
        );
      if (!session) throw new Error('Conversation unavailable');
      const [quota] = await tx
        .select({ total: count() })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.teamId, teamId),
            eq(auditLog.actorUserId, userId),
            eq(auditLog.action, 'diagnostics.submitted'),
            gt(auditLog.createdAt, sql`now() - interval '1 day'`),
          ),
        );
      if ((quota?.total ?? 0) >= 10) throw new Error('Daily report limit reached');
      const id = randomUUID();
      const encrypted = encryptJson({
        id,
        teamId,
        userId,
        description: parsed.data.description,
        conversation: parsed.data.conversation,
      });
      const [report] = await tx
        .insert(diagnosticReports)
        .values({
          id,
          teamId,
          userId,
          ciphertext: encrypted.ciphertext.toString('base64'),
          iv: encrypted.iv.toString('base64'),
          tag: encrypted.tag.toString('base64'),
          consentVersion: parsed.data.consentVersion,
          expiresAt: sql`now() + interval '30 days'`,
        })
        .returning({ id: diagnosticReports.id, expiresAt: diagnosticReports.expiresAt });
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'diagnostics.submitted',
        targetType: 'diagnostic_report',
        targetId: id,
        targetVisibility: 'private',
        targetOwnerUserId: userId,
        metadata: { consentVersion: parsed.data.consentVersion },
      });
      if (!report) throw new Error('Report unavailable');
      return report;
    });
  }
  async function list(page = 1) {
    await ensureMember();
    return db
      .select({
        id: diagnosticReports.id,
        createdAt: diagnosticReports.createdAt,
        expiresAt: diagnosticReports.expiresAt,
      })
      .from(diagnosticReports)
      .where(and(own, gt(diagnosticReports.expiresAt, sql`now()`)))
      .orderBy(desc(diagnosticReports.createdAt), desc(diagnosticReports.id))
      .limit(DIAGNOSTIC_PAGE_SIZE + 1)
      .offset((diagnosticPage(page) - 1) * DIAGNOSTIC_PAGE_SIZE);
  }
  async function remove(id: string) {
    z.uuid().parse(id);
    await ensureMember();
    await db.transaction(async (tx) => {
      const rows = await tx
        .delete(diagnosticReports)
        .where(and(own, eq(diagnosticReports.id, id)))
        .returning({ id: diagnosticReports.id });
      if (rows.length)
        await tx.insert(auditLog).values({
          teamId,
          actorUserId: userId,
          action: 'diagnostics.deleted',
          targetType: 'diagnostic_report',
          targetId: id,
          targetVisibility: 'private',
          targetOwnerUserId: userId,
        });
    });
  }
  return { settings, configure, submit, list, remove };
}
