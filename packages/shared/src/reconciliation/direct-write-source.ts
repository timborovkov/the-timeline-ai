import { type Db, rawEvents, reconciliationEvidence } from '@timeline/db';
import { and, desc, eq } from 'drizzle-orm';

import { sourcePayloadRefFromMetadata } from '#src/reconciliation/source-snapshot.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

type DirectWriteVisibility = 'private' | 'team' | 'specific_users';

interface DirectWriteSourceContext {
  sourceRefs: {
    source: string;
    rawEventId: string;
    sourcePayloadRef?: string;
  }[];
  sourcePayloadRefs: string[];
  visibility: DirectWriteVisibility;
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
}

export function directWriteSourceEnvelope(sourceContext: DirectWriteSourceContext) {
  return {
    sourceRefs: sourceContext.sourceRefs,
    sourcePayloadRefs: sourceContext.sourcePayloadRefs,
    visibility: sourceContext.visibility,
    visibilityOwnerUserId: sourceContext.visibilityOwnerUserId,
    visibilityUserIds: sourceContext.visibilityUserIds,
    visibilityFloor: sourceContext.visibility,
    visibilityFloorOwnerUserId: sourceContext.visibilityOwnerUserId,
    visibilityFloorUserIds: sourceContext.visibilityUserIds,
  };
}

export async function buildDirectWriteSourceContext(input: {
  db: DbOrTx;
  teamId: string;
  sourceRawEventId: string;
}): Promise<DirectWriteSourceContext> {
  const [raw] = await input.db
    .select({
      source: rawEvents.source,
      sourceMetadata: rawEvents.sourceMetadata,
      visibility: rawEvents.visibility,
      visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
      visibilityUserIds: rawEvents.visibilityUserIds,
    })
    .from(rawEvents)
    .where(and(eq(rawEvents.teamId, input.teamId), eq(rawEvents.id, input.sourceRawEventId)))
    .limit(1);
  if (!raw) throw new Error('Source raw event not found for team');

  const [evidence] = await input.db
    .select({
      id: reconciliationEvidence.id,
      sourcePayloadRef: reconciliationEvidence.sourcePayloadRef,
      visibility: reconciliationEvidence.visibility,
      visibilityOwnerUserId: reconciliationEvidence.visibilityOwnerUserId,
      visibilityUserIds: reconciliationEvidence.visibilityUserIds,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, input.teamId),
        eq(reconciliationEvidence.rawEventId, input.sourceRawEventId),
      ),
    )
    .orderBy(desc(reconciliationEvidence.createdAt), desc(reconciliationEvidence.id))
    .limit(1);
  const sourcePayloadRef =
    sourcePayloadRefFromMetadata(raw.sourceMetadata) ?? evidence?.sourcePayloadRef ?? null;
  if (!sourcePayloadRef) {
    throw new Error('Source raw event is missing a replay payload ref');
  }
  const sourcePayloadRefs = [
    ...new Set(
      [evidence?.sourcePayloadRef, sourcePayloadRef].filter((ref): ref is string => !!ref),
    ),
  ];
  const visibility = evidence?.visibility ?? raw.visibility;
  const visibilityOwnerUserId = evidence?.visibilityOwnerUserId ?? raw.visibilityOwnerUserId;
  const visibilityUserIds = evidence?.visibilityUserIds ?? raw.visibilityUserIds;
  return {
    sourceRefs: [
      {
        source: raw.source,
        rawEventId: input.sourceRawEventId,
        ...(sourcePayloadRef ? { sourcePayloadRef } : {}),
      },
    ],
    sourcePayloadRefs,
    visibility,
    visibilityOwnerUserId,
    visibilityUserIds,
  };
}
