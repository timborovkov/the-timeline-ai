import { documents, documentVersions, type Db } from '@timeline/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

/**
 * Live stored bytes for non-deleted documents. Usage meters and infrastructure
 * limits both read this total so billed GB-month snapshots and the capacity
 * gate cannot diverge on "how much is stored right now".
 */
export async function sumTeamStoredBytes(db: Db, teamId: string): Promise<number> {
  const [row] = await db
    .select({
      bytes: sql<string | number>`COALESCE(SUM(${documentVersions.byteSize})::bigint, 0)`,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.teamId, teamId),
        isNull(documents.deletedAt),
        sql`${documentVersions.byteSize} IS NOT NULL`,
      ),
    );
  return Number(row?.bytes ?? 0);
}
