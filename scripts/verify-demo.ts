/* eslint-disable no-console -- demo verification CLI output */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  artifactClusters,
  artifactEvidenceAssociations,
  closeDb,
  documentChunks,
  documents,
  documentVersions,
  entities,
  factEntities,
  facts,
  getDb,
  integrations,
  integrationSelections,
  meetings,
  meetingTranscriptChunks,
  rawEvents,
  reconciliationEvidence,
  teams,
} from '@timeline/db';
import { eq, inArray } from 'drizzle-orm';

import {
  assertDemoFixture,
  assertDemoSeedEnvironment,
  DEMO_ENTITIES,
  DEMO_EVENTS,
  DEMO_IDS,
  type DemoFixtureSnapshot,
} from './demo-fixture.js';

loadDotEnv(resolve(process.cwd(), '.env'));

async function readDemoFixtureSnapshot(): Promise<DemoFixtureSnapshot> {
  const db = getDb();
  const factIds = [
    DEMO_IDS.factCommitment,
    DEMO_IDS.factHandoff,
    DEMO_IDS.factDecision,
    DEMO_IDS.factBlocker,
    DEMO_IDS.factStatus,
  ];
  const evidenceIds = [
    DEMO_IDS.evidenceNote,
    DEMO_IDS.evidenceEmail,
    DEMO_IDS.evidenceMeeting,
    DEMO_IDS.evidenceProvider,
  ];
  const associationIds = [
    DEMO_IDS.associationNote,
    DEMO_IDS.associationCommitment,
    DEMO_IDS.associationHandoff,
    DEMO_IDS.associationDecision,
    DEMO_IDS.associationBlocker,
    DEMO_IDS.associationStatus,
  ];

  const [
    workspaceRows,
    integrationRows,
    eventRows,
    entityRows,
    clusterRows,
    factRows,
    factLinkRows,
    evidenceRows,
    associationRows,
    documentRows,
    meetingRows,
  ] = await Promise.all([
    db
      .select({ id: teams.id, slug: teams.slug, name: teams.name })
      .from(teams)
      .where(eq(teams.id, DEMO_IDS.team)),
    db
      .select({
        id: integrations.id,
        teamId: integrations.teamId,
        provider: integrations.provider,
        enabled: integrations.enabled,
        selectionId: integrationSelections.id,
        selectionIntegrationId: integrationSelections.integrationId,
        selectionExternalId: integrationSelections.externalId,
      })
      .from(integrations)
      .leftJoin(integrationSelections, eq(integrationSelections.id, DEMO_IDS.linearSelection))
      .where(eq(integrations.id, DEMO_IDS.linearIntegration)),
    db
      .select({
        id: rawEvents.id,
        teamId: rawEvents.teamId,
        source: rawEvents.source,
        contentText: rawEvents.contentText,
        occurredAt: rawEvents.occurredAt,
        visibility: rawEvents.visibility,
        visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
        visibilityUserIds: rawEvents.visibilityUserIds,
        sourceMetadata: rawEvents.sourceMetadata,
      })
      .from(rawEvents)
      .where(
        inArray(
          rawEvents.id,
          DEMO_EVENTS.map((row) => row.id),
        ),
      ),
    db
      .select({
        id: entities.id,
        teamId: entities.teamId,
        type: entities.type,
        canonicalName: entities.canonicalName,
        status: entities.status,
        stage: entities.stage,
        ownerUserId: entities.ownerUserId,
        assigneeUserId: entities.assigneeUserId,
      })
      .from(entities)
      .where(
        inArray(
          entities.id,
          DEMO_ENTITIES.map((row) => row.id),
        ),
      ),
    db
      .select({
        id: artifactClusters.id,
        teamId: artifactClusters.teamId,
        canonicalEntityId: artifactClusters.canonicalEntityId,
      })
      .from(artifactClusters)
      .where(
        inArray(artifactClusters.id, [
          DEMO_IDS.clusterPilot,
          DEMO_IDS.clusterDelivery,
          DEMO_IDS.clusterDecision,
        ]),
      ),
    db
      .select({
        id: facts.id,
        teamId: facts.teamId,
        rawEventId: facts.rawEventId,
        statement: facts.statement,
        modelVersion: facts.modelVersion,
      })
      .from(facts)
      .where(inArray(facts.id, factIds)),
    db
      .select({
        factId: factEntities.factId,
        entityId: factEntities.entityId,
        role: factEntities.role,
      })
      .from(factEntities)
      .where(inArray(factEntities.factId, factIds)),
    db
      .select({
        id: reconciliationEvidence.id,
        teamId: reconciliationEvidence.teamId,
        rawEventId: reconciliationEvidence.rawEventId,
        source: reconciliationEvidence.source,
        sourcePayloadRef: reconciliationEvidence.sourcePayloadRef,
        occurredAt: reconciliationEvidence.occurredAt,
        visibility: reconciliationEvidence.visibility,
      })
      .from(reconciliationEvidence)
      .where(inArray(reconciliationEvidence.id, evidenceIds)),
    db
      .select({
        id: artifactEvidenceAssociations.id,
        teamId: artifactEvidenceAssociations.teamId,
        clusterId: artifactEvidenceAssociations.clusterId,
        evidenceId: artifactEvidenceAssociations.evidenceId,
        rawEventId: artifactEvidenceAssociations.rawEventId,
        role: artifactEvidenceAssociations.role,
        visibility: artifactEvidenceAssociations.visibility,
        visibilityFloor: artifactEvidenceAssociations.visibilityFloor,
        sourceRefs: artifactEvidenceAssociations.sourceRefs,
      })
      .from(artifactEvidenceAssociations)
      .where(inArray(artifactEvidenceAssociations.id, associationIds)),
    db
      .select({
        id: documents.id,
        teamId: documents.teamId,
        name: documents.name,
        visibility: documents.visibility,
        sourceRawEventId: documents.sourceRawEventId,
        currentVersionId: documents.currentVersionId,
        versionId: documentVersions.id,
        versionDocumentId: documentVersions.documentId,
        versionSourceEventId: documentVersions.sourceEventId,
        chunkId: documentChunks.id,
        chunkDocumentId: documentChunks.documentId,
        chunkVersionId: documentChunks.documentVersionId,
        chunkText: documentChunks.text,
      })
      .from(documents)
      .leftJoin(documentVersions, eq(documentVersions.id, DEMO_IDS.documentVersion))
      .leftJoin(documentChunks, eq(documentChunks.id, DEMO_IDS.documentChunk))
      .where(eq(documents.id, DEMO_IDS.document)),
    db
      .select({
        id: meetings.id,
        teamId: meetings.teamId,
        status: meetings.status,
        defaultVisibility: meetings.defaultVisibility,
        startedAt: meetings.startedAt,
        endedAt: meetings.endedAt,
        chunkId: meetingTranscriptChunks.id,
        chunkMeetingId: meetingTranscriptChunks.meetingId,
        chunkRawEventId: meetingTranscriptChunks.rawEventId,
        chunkText: meetingTranscriptChunks.text,
      })
      .from(meetings)
      .leftJoin(meetingTranscriptChunks, eq(meetingTranscriptChunks.id, DEMO_IDS.meetingChunk))
      .where(eq(meetings.id, DEMO_IDS.meeting)),
  ]);

  return {
    workspace: workspaceRows[0] ?? null,
    integration: integrationRows[0] ?? null,
    events: eventRows.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      sourceMetadata: row.sourceMetadata as Record<string, unknown>,
    })),
    entities: entityRows,
    clusters: clusterRows,
    facts: factRows,
    factLinks: factLinkRows,
    evidence: evidenceRows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
    associations: associationRows,
    document: documentRows[0] ?? null,
    meeting: meetingRows[0]
      ? {
          ...meetingRows[0],
          startedAt: meetingRows[0].startedAt?.toISOString() ?? null,
          endedAt: meetingRows[0].endedAt?.toISOString() ?? null,
        }
      : null,
  };
}

async function main(): Promise<void> {
  assertDemoSeedEnvironment();
  try {
    assertDemoFixture(await readDemoFixtureSnapshot());
    console.log('[demo:verify] deterministic demo fixture is intact');
  } finally {
    await closeDb();
  }
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const body = readFileSync(path, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    const value = (rawValue ?? '').trim();
    process.env[key] =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
  }
}

main().catch((error: unknown) => {
  console.error('[demo:verify] failed', error);
  process.exit(1);
});
