import {
  calendarEvents,
  documentChunks,
  documents,
  documentVersions,
  entities,
  integrationSelections,
  integrations,
  providerConnections,
  rawEvents,
  sourceIndexReceipts,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { and, asc, eq, gte, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import { documentVisibleToUser } from '#src/documents/visibility.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import type { EmbedJobData } from '#src/queue/queues.js';
import { rawEventVisibleToUser } from '#src/visibility.js';

export function createSourceHealthScope(
  db: Db,
  teamId: string,
  userId: string,
  ensureMember: (role: 'admin') => Promise<unknown>,
) {
  const rawCondition = and(
    eq(rawEvents.teamId, teamId),
    rawEventVisibleToUser(userId),
    sql`coalesce(${rawEvents.sourceMetadata}->>'deleted', 'false') <> 'true'`,
  );
  const documentCondition = and(
    eq(documents.teamId, teamId),
    documentVisibleToUser(userId),
    isNull(documents.deletedAt),
    sql`(${documents.fileKind} <> 'captured' OR EXISTS (
      SELECT 1 FROM ${rawEvents}
      WHERE ${rawEvents.id} = ${documentVersions.sourceEventId} AND ${rawCondition}
    ))`,
  );
  const objectCondition = and(
    eq(entities.teamId, teamId),
    isNull(entities.archivedAt),
    isNull(entities.mergedIntoId),
  );
  const calendarCondition = and(
    eq(calendarEvents.teamId, teamId),
    eq(calendarEvents.visibility, 'team'),
    isNull(calendarEvents.deletedAt),
  );
  const receipt = (kind: string, id: SQLWrapper, updatedAt: SQLWrapper) =>
    and(
      eq(sourceIndexReceipts.teamId, teamId),
      eq(sourceIndexReceipts.kind, kind),
      eq(sourceIndexReceipts.sourceId, id),
      eq(sourceIndexReceipts.model, TIMELINE_MODELS.embedding.id),
      gte(sourceIndexReceipts.sourceUpdatedAt, updatedAt),
    );
  const objectReceipt = receipt('object', entities.id, entities.updatedAt);
  const calendarReceipt = receipt('calendar_event', calendarEvents.id, calendarEvents.updatedAt);
  const chunkReceipt = receipt('doc_chunk', documentChunks.id, documentChunks.createdAt);
  const complete = sql`${sourceIndexReceipts.sourceId} IS NOT NULL`;
  const rawIndexed = sql`coalesce(${rawEvents.sourceMetadata}->>'embedded_at', '') >= coalesce(${rawEvents.sourceMetadata}->>'visibility_changed_at', '') AND ${rawEvents.sourceMetadata} ? 'embedded_at' AND ${rawEvents.sourceMetadata}->>'embedding_model' = ${TIMELINE_MODELS.embedding.id}`;
  const rawEligible = sql`${rawEvents.visibility} = 'team' AND nullif(trim(${rawEvents.contentText}), '') IS NOT NULL`;
  const providerKey = sql<string>`coalesce(nullif(${rawEvents.sourceMetadata}->>'integration_id', ''), ${rawEvents.source}::text)`;
  const totals = (indexed: SQL) => ({
    total: sql<number>`count(*)::int`,
    indexed: sql<number>`count(*) filter (where ${indexed})::int`,
  });

  return {
    async read() {
      await ensureMember('admin');
      const [sources, connections, objects, calendar, docs] = await Promise.all([
        db
          .select({
            key: providerKey,
            lastDelivered: sql<string | null>`max(${rawEvents.createdAt})::text`,
            total: sql<number>`count(*) filter (where ${rawEligible})::int`,
            indexed: sql<number>`count(*) filter (where ${rawEligible} AND ${rawIndexed})::int`,
          })
          .from(rawEvents)
          .where(rawCondition)
          .groupBy(providerKey),
        db
          .select({
            id: integrations.id,
            name: integrations.displayName,
            provider: integrations.provider,
            lastSync: integrations.lastSyncedAt,
            enabled: integrations.enabled,
            error: integrations.lastError,
            paused: integrations.healthPauseKind,
            owner: users.name,
            ownerEmail: users.email,
            ownerId: teamMembers.userId,
            selection: integrationSelections.externalLabel,
          })
          .from(integrations)
          .leftJoin(
            providerConnections,
            eq(providerConnections.id, integrations.providerConnectionId),
          )
          .leftJoin(
            teamMembers,
            and(
              eq(teamMembers.teamId, teamId),
              isNull(teamMembers.removedAt),
              sql`${teamMembers.userId} = coalesce(${providerConnections.ownerUserId}, ${integrations.connectedByUserId})`,
            ),
          )
          .leftJoin(users, eq(users.id, teamMembers.userId))
          .leftJoin(integrationSelections, eq(integrationSelections.integrationId, integrations.id))
          .where(
            and(
              eq(integrations.teamId, teamId),
              sql`(
            ${integrations.visibilityDefault} = 'team'
            OR coalesce(${providerConnections.ownerUserId}, ${integrations.connectedByUserId}) = ${userId}::uuid
            OR (${integrations.visibilityDefault} = 'specific_users' AND ${userId}::uuid = ANY(${integrations.visibilityDefaultUserIds}))
          )`,
            ),
          )
          .orderBy(asc(integrations.displayName)),
        db
          .select(totals(complete))
          .from(entities)
          .leftJoin(sourceIndexReceipts, objectReceipt)
          .where(objectCondition),
        db
          .select(totals(complete))
          .from(calendarEvents)
          .leftJoin(sourceIndexReceipts, calendarReceipt)
          .where(calendarCondition),
        db
          .select(totals(complete))
          .from(documents)
          .innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
          .innerJoin(
            documentChunks,
            and(
              eq(documentChunks.teamId, teamId),
              eq(documentChunks.documentVersionId, documentVersions.id),
            ),
          )
          .leftJoin(sourceIndexReceipts, chunkReceipt)
          .where(documentCondition),
      ]);
      return {
        sources,
        connections,
        objects: objects[0],
        calendar: calendar[0],
        documents: docs[0],
      };
    },

    async indexJobs(
      kind: 'source' | 'object' | 'calendar' | 'document',
      key: string,
    ): Promise<EmbedJobData[]> {
      await ensureMember('admin');
      if (kind === 'source') {
        const rows = await db
          .select({ id: rawEvents.id })
          .from(rawEvents)
          .where(
            and(
              rawCondition,
              eq(providerKey, key),
              rawEligible,
              sql`NOT coalesce((${rawIndexed}), false)`,
            ),
          )
          .orderBy(asc(rawEvents.createdAt))
          .limit(50);
        return rows.map(({ id }) => ({ scope: 'raw_event', teamId, rawEventId: id }));
      }
      if (kind === 'object') {
        const rows = await db
          .select({ id: entities.id })
          .from(entities)
          .leftJoin(sourceIndexReceipts, objectReceipt)
          .where(and(objectCondition, isNull(sourceIndexReceipts.sourceId)))
          .orderBy(asc(entities.updatedAt))
          .limit(50);
        return rows.map(({ id }) => ({ scope: 'object', teamId, objectId: id }));
      }
      if (kind === 'calendar') {
        const rows = await db
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .leftJoin(sourceIndexReceipts, calendarReceipt)
          .where(and(calendarCondition, isNull(sourceIndexReceipts.sourceId)))
          .orderBy(asc(calendarEvents.updatedAt))
          .limit(50);
        return rows.map(({ id }) => ({ scope: 'calendar_event', teamId, calendarEventId: id }));
      }
      const rows = await db
        .select({ id: documentChunks.id })
        .from(documents)
        .innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
        .innerJoin(
          documentChunks,
          and(
            eq(documentChunks.teamId, teamId),
            eq(documentChunks.documentVersionId, documentVersions.id),
          ),
        )
        .leftJoin(sourceIndexReceipts, chunkReceipt)
        .where(and(documentCondition, isNull(sourceIndexReceipts.sourceId)))
        .orderBy(asc(documentChunks.createdAt))
        .limit(50);
      return rows.map(({ id }) => ({ scope: 'doc_chunk', teamId, documentChunkId: id }));
    },
  };
}
