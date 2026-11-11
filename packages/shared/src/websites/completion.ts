import {
  type Db,
  documentChunks,
  documentVersions,
  documents,
  rawEvents,
  websitePages,
  websiteRuns,
} from '@timeline/db';
import { and, eq, sql } from 'drizzle-orm';

/** Worker-only completion boundary. Every lookup is constrained by the job's team. */
export async function completeWebsiteChunk(
  db: Db,
  teamId: string,
  chunkId: string,
  _model: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 17))`);
    const [row] = await tx
      .select({ chunk: documentChunks, version: documentVersions, event: rawEvents })
      .from(documentChunks)
      .innerJoin(documentVersions, eq(documentVersions.id, documentChunks.documentVersionId))
      .innerJoin(rawEvents, eq(rawEvents.id, documentVersions.sourceEventId))
      .where(
        and(
          eq(documentChunks.teamId, teamId),
          eq(documentVersions.teamId, teamId),
          eq(rawEvents.teamId, teamId),
          eq(documentChunks.id, chunkId),
        ),
      );
    let metadata = row?.event.sourceMetadata as Record<string, unknown> | null;
    if (
      row &&
      metadata &&
      typeof metadata.websiteId !== 'string' &&
      typeof metadata.websiteScanId === 'string'
    ) {
      const [legacy] = await tx
        .select()
        .from(websiteRuns)
        .where(
          and(
            eq(websiteRuns.teamId, teamId),
            eq(websiteRuns.id, metadata.websiteScanId),
            eq(websiteRuns.billingPolicy, 'legacy'),
          ),
        );
      if (legacy)
        metadata = {
          ...metadata,
          websiteId: legacy.websiteId,
          websiteContentHash: row.version.checksumSha256 ?? '',
        };
    }
    if (
      !row ||
      typeof metadata?.websiteId !== 'string' ||
      typeof metadata.pageUrl !== 'string' ||
      typeof metadata.websiteContentHash !== 'string'
    )
      return;
    await tx
      .update(documentChunks)
      .set({ websiteEmbeddedAt: new Date() })
      .where(and(eq(documentChunks.teamId, teamId), eq(documentChunks.id, chunkId)));
    const [pending] = await tx
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.teamId, teamId),
          eq(documentChunks.documentVersionId, row.version.id),
          sql`${documentChunks.websiteEmbeddedAt} IS NULL`,
        ),
      )
      .limit(1);
    if (pending) return;
    const [activeDocument] = await tx
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(
        websitePages,
        and(eq(websitePages.teamId, teamId), eq(websitePages.documentId, documents.id)),
      )
      .where(
        and(
          eq(documents.teamId, teamId),
          eq(documents.id, row.version.documentId),
          eq(documents.fileKind, 'captured'),
          eq(documents.visibility, 'team'),
          sql`${documents.deletedAt} IS NULL`,
        ),
      )
      .for('update', { of: documents });
    if (!activeDocument) return;
    await tx
      .update(documentVersions)
      .set({ processingStatus: 'embedded' })
      .where(and(eq(documentVersions.teamId, teamId), eq(documentVersions.id, row.version.id)));
    const [current] = await tx
      .select({ version: documentVersions.version, documentId: documentVersions.documentId })
      .from(websitePages)
      .innerJoin(documentVersions, eq(documentVersions.id, websitePages.currentVersionId))
      .where(
        and(
          eq(websitePages.teamId, teamId),
          eq(websitePages.websiteId, metadata.websiteId),
          eq(websitePages.url, metadata.pageUrl),
        ),
      );
    if (current?.documentId === row.version.documentId && current.version >= row.version.version)
      return;
    await tx
      .update(websitePages)
      .set({
        currentEventId: row.event.id,
        currentVersionId: row.version.id,
        contentHash: metadata.websiteContentHash,
      })
      .where(
        and(
          eq(websitePages.teamId, teamId),
          eq(websitePages.websiteId, metadata.websiteId),
          eq(websitePages.url, metadata.pageUrl),
        ),
      );
    await tx
      .update(documents)
      .set({ currentVersionId: row.version.id })
      .where(and(eq(documents.teamId, teamId), eq(documents.id, row.version.documentId)));
    if (typeof metadata.websiteScanId === 'string') {
      const [unfinished] = await tx
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .innerJoin(rawEvents, eq(rawEvents.id, documentVersions.sourceEventId))
        .where(
          and(
            eq(documentVersions.teamId, teamId),
            eq(rawEvents.teamId, teamId),
            sql`${rawEvents.sourceMetadata}->>'websiteScanId' = ${metadata.websiteScanId}`,
            sql`${documentVersions.processingStatus} <> 'embedded'`,
          ),
        )
        .limit(1);
      if (!unfinished)
        await tx
          .update(websiteRuns)
          .set({
            status: sql`CASE WHEN ${websiteRuns.failureReason} IN ('provider_failed', 'provider_cancelled', 'provider_page_errors') THEN 'partial' ELSE 'completed' END`,
            finishedAt: new Date(),
          })
          .where(
            and(
              eq(websiteRuns.teamId, teamId),
              eq(websiteRuns.id, metadata.websiteScanId),
              sql`(${websiteRuns.status} = 'processing' OR (${websiteRuns.status} = 'partial' AND ${websiteRuns.billingPolicy} = 'legacy' AND ${websiteRuns.finishedAt} IS NULL)) AND ${websiteRuns.changedCount} > 0 AND ${websiteRuns.handoffAt} IS NOT NULL`,
            ),
          );
    }
  });
}
