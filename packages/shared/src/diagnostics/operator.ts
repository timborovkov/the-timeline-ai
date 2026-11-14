import { diagnosticReports, type Db } from '@timeline/db';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { decryptJson } from '#src/crypto/secrets.js';
import { diagnosticPage, DIAGNOSTIC_PAGE_SIZE } from '#src/diagnostics/contract.js';
import {
  requirePlatformActor,
  recordPlatformAudit,
  type PlatformActor,
} from '#src/platform-admin/index.js';

const reportContent = z
  .object({
    id: z.uuid(),
    teamId: z.uuid(),
    userId: z.uuid(),
    description: z.string(),
    conversation: z.string(),
  })
  .strict();
export async function listDiagnosticReports(db: Db, actor: PlatformActor, page = 1) {
  await requirePlatformActor(db, actor);
  return db
    .select({
      id: diagnosticReports.id,
      createdAt: diagnosticReports.createdAt,
      expiresAt: diagnosticReports.expiresAt,
    })
    .from(diagnosticReports)
    .where(gt(diagnosticReports.expiresAt, sql`now()`))
    .orderBy(desc(diagnosticReports.createdAt), desc(diagnosticReports.id))
    .limit(DIAGNOSTIC_PAGE_SIZE + 1)
    .offset((diagnosticPage(page) - 1) * DIAGNOSTIC_PAGE_SIZE);
}
export async function readDiagnosticReport(db: Db, actor: PlatformActor, id: string) {
  z.uuid().parse(id);
  return db.transaction(async (tx) => {
    const store = tx as unknown as Db;
    await requirePlatformActor(store, actor);
    const [row] = await tx
      .select()
      .from(diagnosticReports)
      .where(and(eq(diagnosticReports.id, id), gt(diagnosticReports.expiresAt, sql`now()`)))
      .for('update');
    if (!row) throw new Error('Report unavailable');
    const content = reportContent.parse(
      decryptJson({
        ciphertext: Buffer.from(row.ciphertext, 'base64'),
        iv: Buffer.from(row.iv, 'base64'),
        tag: Buffer.from(row.tag, 'base64'),
      }),
    );
    if (content.id !== row.id || content.teamId !== row.teamId || content.userId !== row.userId)
      throw new Error('Report unavailable');
    // Commit the access audit before any submitted content leaves this function.
    await recordPlatformAudit(store, {
      actorUserId: actor.userId,
      action: 'diagnostics.read',
      targetId: row.id,
      teamId: row.teamId,
      reason: 'Investigate user-submitted conversation report',
      metadata: { consentVersion: row.consentVersion },
    });
    return {
      description: content.description,
      conversation: content.conversation,
      expiresAt: row.expiresAt.toISOString(),
    };
  });
}
/** Content-free bounded maintenance; expiry denies reads even when cleanup is delayed. */
export async function pruneDiagnosticReports(db: Db): Promise<number> {
  const rows = await db
    .delete(diagnosticReports)
    .where(
      inArray(
        diagnosticReports.id,
        db
          .select({ id: diagnosticReports.id })
          .from(diagnosticReports)
          .where(lte(diagnosticReports.expiresAt, sql`now()`))
          .orderBy(diagnosticReports.expiresAt)
          .limit(500),
      ),
    )
    .returning({ id: diagnosticReports.id });
  return rows.length;
}
