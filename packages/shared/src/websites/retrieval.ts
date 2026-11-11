import { type Db, rawEvents, documentVersions, websitePages, websiteRuns } from '@timeline/db';
import { and, eq, sql } from 'drizzle-orm';

/** Exclusions enter the vector filter before ranking/limits; explicit history bypasses them. */
export async function obsoleteWebsiteEventIds(db: Db, teamId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: rawEvents.id })
    .from(rawEvents)
    .leftJoin(
      documentVersions,
      and(eq(documentVersions.teamId, teamId), eq(documentVersions.sourceEventId, rawEvents.id)),
    )
    .leftJoin(
      websiteRuns,
      and(
        eq(websiteRuns.teamId, teamId),
        sql`${websiteRuns.id}::text = ${rawEvents.sourceMetadata}->>'websiteScanId'`,
      ),
    )
    .leftJoin(
      websitePages,
      and(
        eq(websitePages.teamId, teamId),
        sql`(${websitePages.documentId} = ${documentVersions.documentId} OR (${websitePages.websiteId} = ${websiteRuns.websiteId} AND ${websitePages.url} = ${rawEvents.sourceMetadata}->>'pageUrl'))`,
      ),
    )
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        sql`(${rawEvents.sourceMetadata}->>'websiteId' IS NOT NULL OR ${websitePages.id} IS NOT NULL OR ${websiteRuns.id} IS NOT NULL)`,
        sql`${websitePages.currentEventId} IS DISTINCT FROM ${rawEvents.id}`,
      ),
    );
  return rows.map((row) => row.id);
}
