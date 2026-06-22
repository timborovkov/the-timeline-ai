import { documents, documentVersions, type Db } from '@timeline/db';
import { documentPresentation } from '@timeline/shared/documents/presentation';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

export interface TimelineCapturedFile {
  id: string;
  name: string;
  presentation: {
    displayTitle: string;
    storedName: string;
    suggestedTitle: string | null;
    isGeneratedName: boolean;
    fallbackTitle: string;
  };
  currentVersion: {
    id: string;
    version: number;
    contentType: string | null;
    processingStatus: string;
  } | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listTimelineCapturedFilesByEventId(input: {
  db: Db;
  teamId: string;
  userId: string;
  eventIds: string[];
}): Promise<Record<string, TimelineCapturedFile[]>> {
  const eventIds = [...new Set(input.eventIds.filter((id) => UUID_RE.test(id)))];
  if (eventIds.length === 0) return {};

  const rows = await input.db
    .select({
      sourceRawEventId: documents.sourceRawEventId,
      documentId: documents.id,
      documentName: documents.name,
      documentMetadata: documents.metadata,
      fileKind: documents.fileKind,
      versionId: documentVersions.id,
      version: documentVersions.version,
      contentType: documentVersions.contentType,
      processingStatus: documentVersions.processingStatus,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .where(
      and(
        eq(documents.teamId, input.teamId),
        eq(documents.fileKind, 'captured'),
        inArray(documents.sourceRawEventId, eventIds),
        isNull(documents.deletedAt),
        or(
          eq(documents.visibility, 'team'),
          and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, input.userId)),
          and(
            eq(documents.visibility, 'specific_users'),
            sql`${input.userId}::uuid = ANY(${documents.visibilityUserIds})`,
          ),
        ),
      ),
    );

  const byEvent: Record<string, TimelineCapturedFile[]> = {};
  for (const row of rows) {
    if (!row.sourceRawEventId) continue;
    const item: TimelineCapturedFile = {
      id: row.documentId,
      name: row.documentName,
      presentation: documentPresentation({
        name: row.documentName,
        contentType: row.contentType,
        metadata:
          typeof row.documentMetadata === 'object' && row.documentMetadata !== null
            ? (row.documentMetadata as Record<string, unknown>)
            : {},
        fileKind: row.fileKind,
      }),
      currentVersion: row.versionId
        ? {
            id: row.versionId,
            version: row.version ?? 1,
            contentType: row.contentType,
            processingStatus: row.processingStatus ?? 'pending',
          }
        : null,
    };
    byEvent[row.sourceRawEventId] = [...(byEvent[row.sourceRawEventId] ?? []), item];
  }
  return byEvent;
}
