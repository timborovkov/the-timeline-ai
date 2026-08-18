/* eslint-disable no-console -- demo verification CLI output */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  agentSuggestions,
  artifactClusters,
  artifactEvidenceAssociations,
  boardItems,
  boards,
  chatSessions,
  closeDb,
  dailyDigests,
  documentChunks,
  documents,
  documentVersions,
  entities,
  factEntities,
  facts,
  getDb,
  ingestWebhooks,
  integrations,
  integrationSelections,
  mcpServers,
  meetings,
  meetingTranscriptChunks,
  rawEvents,
  reconciliationEvidence,
  slackWorkspaceTeams,
  teamMembers,
  teamOnboardingCompletions,
  teams,
  telegramChatBindings,
  users,
} from '@timeline/db';
import { llm, qdrant } from '@timeline/shared';
import { verifyPassword } from '@timeline/shared/passwords';
import { getDocumentsBucket, getObjectBuffer, getS3Client } from '@timeline/shared/s3';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  assertExpandedDemoCorpus,
  CORPUS_DOCUMENTS,
  CORPUS_MEETINGS,
  CORPUS_PEOPLE,
  CORPUS_SLACK,
  CORPUS_WEBHOOK,
} from './demo-corpus/index.js';
import {
  assertDemoFixture,
  assertDemoVectorEnvironment,
  DEMO_DOCUMENT_BYTE_SIZE,
  DEMO_DOCUMENT_OBJECT_KEY,
  DEMO_ENTITIES,
  DEMO_EVENTS,
  DEMO_IDS,
  DEMO_LOGINS,
  DEMO_LOGIN_PASSWORD,
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
    loginRows,
    integrationRows,
    eventRows,
    entityRows,
    clusterRows,
    factRows,
    factLinkRows,
    evidenceRows,
    associationRows,
    documentRows,
    documentObject,
    meetingRows,
    vectorSnapshot,
  ] = await Promise.all([
    db
      .select({ id: teams.id, slug: teams.slug, name: teams.name })
      .from(teams)
      .where(eq(teams.id, DEMO_IDS.team)),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
        teamId: teamMembers.teamId,
        role: teamMembers.role,
        removedAt: teamMembers.removedAt,
      })
      .from(users)
      .leftJoin(
        teamMembers,
        and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, DEMO_IDS.team)),
      )
      .where(
        inArray(
          users.id,
          DEMO_LOGINS.map((login) => login.id),
        ),
      ),
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
        versionObjectKey: documentVersions.objectKey,
        versionByteSize: documentVersions.byteSize,
        versionContentType: documentVersions.contentType,
        versionChecksumSha256: documentVersions.checksumSha256,
        versionProcessingStatus: documentVersions.processingStatus,
        versionEmbeddingModelVersion: documentVersions.embeddingModelVersion,
        chunkId: documentChunks.id,
        chunkDocumentId: documentChunks.documentId,
        chunkVersionId: documentChunks.documentVersionId,
        chunkText: documentChunks.text,
      })
      .from(documents)
      .leftJoin(documentVersions, eq(documentVersions.id, DEMO_IDS.documentVersion))
      .leftJoin(documentChunks, eq(documentChunks.id, DEMO_IDS.documentChunk))
      .where(eq(documents.id, DEMO_IDS.document)),
    readDemoDocumentObject(),
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
    readDemoVectorSnapshot(),
  ]);

  return {
    workspace: workspaceRows[0] ?? null,
    logins: await Promise.all(
      loginRows.map(async (row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        teamId: row.teamId,
        role: row.role,
        membershipActive: row.teamId === DEMO_IDS.team && row.removedAt === null,
        passwordUsable: row.passwordHash
          ? await verifyPassword(DEMO_LOGIN_PASSWORD, row.passwordHash)
          : false,
      })),
    ),
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
    document: documentRows[0] ? { ...documentRows[0], ...documentObject } : null,
    meeting: meetingRows[0]
      ? {
          ...meetingRows[0],
          startedAt: meetingRows[0].startedAt?.toISOString() ?? null,
          endedAt: meetingRows[0].endedAt?.toISOString() ?? null,
        }
      : null,
    vectors: vectorSnapshot,
  };
}

async function readDemoDocumentObject(): Promise<{
  backingObjectExists: boolean;
  backingObjectByteSize: number | null;
  backingObjectContentType: string | null;
  backingObjectChecksumSha256: string | null;
}> {
  const object = await getObjectBuffer(
    getS3Client(),
    getDocumentsBucket(),
    DEMO_DOCUMENT_OBJECT_KEY,
    DEMO_DOCUMENT_BYTE_SIZE,
  );
  return {
    backingObjectExists: true,
    backingObjectByteSize: object.body.byteLength,
    backingObjectContentType: object.contentType ?? null,
    backingObjectChecksumSha256: createHash('sha256').update(object.body).digest('hex'),
  };
}

async function readDemoVectorSnapshot(): Promise<DemoFixtureSnapshot['vectors']> {
  const query = [
    ...DEMO_EVENTS.map((event) => event.contentText),
    'Northstar pilot export validation handoff CSV fallback field-mapping blocker',
  ].join('\n');
  const embeddedQuery = await llm.embed({ text: query });
  const client = qdrant.getQdrantClient();
  const expectedByKind = {
    rawEvents: DEMO_EVENTS.map((event) =>
      qdrant.buildChunkedPointId('event', event.id, embeddedQuery.model, 0),
    ),
    facts: [
      DEMO_IDS.factCommitment,
      DEMO_IDS.factHandoff,
      DEMO_IDS.factDecision,
      DEMO_IDS.factBlocker,
      DEMO_IDS.factStatus,
    ].map((id) => qdrant.buildChunkedPointId('fact', id, embeddedQuery.model, 0)),
    documentChunks: [
      qdrant.buildChunkedPointId('doc_chunk', DEMO_IDS.documentChunk, embeddedQuery.model, 0),
    ],
    meetingChunks: [
      qdrant.buildChunkedPointId('meeting_chunk', DEMO_IDS.meetingChunk, embeddedQuery.model, 0),
    ],
  };
  const [rawHits, factHits, documentHits, meetingHits] = await Promise.all([
    client.search(DEMO_IDS.team, DEMO_IDS.owner, embeddedQuery.vector, {
      eventIds: DEMO_EVENTS.map((event) => event.id),
      embeddingModel: embeddedQuery.model,
      sourceKind: ['raw_event', 'integration_event'],
      limit: expectedByKind.rawEvents.length,
    }),
    client.search(DEMO_IDS.team, DEMO_IDS.owner, embeddedQuery.vector, {
      eventIds: [DEMO_IDS.eventEmail, DEMO_IDS.eventMeeting, DEMO_IDS.eventProvider],
      embeddingModel: embeddedQuery.model,
      sourceKind: 'fact',
      limit: expectedByKind.facts.length,
    }),
    client.search(DEMO_IDS.team, DEMO_IDS.owner, embeddedQuery.vector, {
      documentId: DEMO_IDS.document,
      embeddingModel: embeddedQuery.model,
      sourceKind: 'doc_chunk',
      limit: expectedByKind.documentChunks.length,
    }),
    client.search(DEMO_IDS.team, DEMO_IDS.owner, embeddedQuery.vector, {
      eventIds: [DEMO_IDS.eventMeeting],
      embeddingModel: embeddedQuery.model,
      sourceKind: 'meeting_chunk',
      limit: expectedByKind.meetingChunks.length,
    }),
  ]);
  const discoverableByKind = {
    rawEvents: matchingPointIds(rawHits, expectedByKind.rawEvents),
    facts: matchingPointIds(factHits, expectedByKind.facts),
    documentChunks: matchingPointIds(documentHits, expectedByKind.documentChunks),
    meetingChunks: matchingPointIds(meetingHits, expectedByKind.meetingChunks),
  };
  return {
    embeddingModel: embeddedQuery.model,
    expectedPointIds: Object.values(expectedByKind).flat(),
    discoverablePointIds: Object.values(discoverableByKind).flat(),
    sourceCounts: {
      rawEvents: discoverableByKind.rawEvents.length,
      facts: discoverableByKind.facts.length,
      documentChunks: discoverableByKind.documentChunks.length,
      meetingChunks: discoverableByKind.meetingChunks.length,
    },
  };
}

function matchingPointIds(hits: qdrant.SearchHit[], expectedPointIds: readonly string[]): string[] {
  const expected = new Set(expectedPointIds);
  return [...new Set(hits.map((hit) => hit.id).filter((id) => expected.has(id)))];
}

async function readExpandedDemoCorpusSnapshot(): Promise<
  import('./demo-corpus/index.js').ExpandedDemoCorpusSnapshot
> {
  const db = getDb();
  const [
    peopleRows,
    eventCount,
    objectCount,
    documentCount,
    meetingCount,
    proposalCount,
    boardItemCount,
    chatCount,
    digestCount,
    factCount,
    slackCount,
    slackWorkspaceRows,
    telegramCount,
    webhookCount,
    webhookRows,
    integrationRows,
    mcpRows,
    onboardingCount,
    polarDealflowCount,
    corpusEventCount,
    northstarEventCount,
    corpusFactCount,
    northstarFactCount,
  ] = await Promise.all([
    db
      .select({ email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .innerJoin(
        teamMembers,
        and(
          eq(teamMembers.userId, users.id),
          eq(teamMembers.teamId, DEMO_IDS.team),
          isNull(teamMembers.removedAt),
        ),
      )
      .where(
        inArray(
          users.id,
          CORPUS_PEOPLE.map((person) => person.id),
        ),
      ),
    db.select({ value: count() }).from(rawEvents).where(eq(rawEvents.teamId, DEMO_IDS.team)),
    db.select({ value: count() }).from(entities).where(eq(entities.teamId, DEMO_IDS.team)),
    db.select({ value: count() }).from(documents).where(eq(documents.teamId, DEMO_IDS.team)),
    db.select({ value: count() }).from(meetings).where(eq(meetings.teamId, DEMO_IDS.team)),
    db
      .select({ value: count() })
      .from(agentSuggestions)
      .where(
        and(eq(agentSuggestions.teamId, DEMO_IDS.team), eq(agentSuggestions.status, 'pending')),
      ),
    db.select({ value: count() }).from(boardItems).where(eq(boardItems.teamId, DEMO_IDS.team)),
    db.select({ value: count() }).from(chatSessions).where(eq(chatSessions.teamId, DEMO_IDS.team)),
    db.select({ value: count() }).from(dailyDigests).where(eq(dailyDigests.teamId, DEMO_IDS.team)),
    db.select({ value: count() }).from(facts).where(eq(facts.teamId, DEMO_IDS.team)),
    db
      .select({ value: count() })
      .from(slackWorkspaceTeams)
      .where(eq(slackWorkspaceTeams.teamId, DEMO_IDS.team)),
    db
      .select({
        workspaceId: slackWorkspaceTeams.workspaceId,
        enabled: slackWorkspaceTeams.enabled,
      })
      .from(slackWorkspaceTeams)
      .where(
        and(
          eq(slackWorkspaceTeams.teamId, DEMO_IDS.team),
          eq(slackWorkspaceTeams.workspaceId, CORPUS_SLACK.workspace),
        ),
      ),
    db
      .select({ value: count() })
      .from(telegramChatBindings)
      .where(eq(telegramChatBindings.teamId, DEMO_IDS.team)),
    db
      .select({ value: count() })
      .from(ingestWebhooks)
      .where(eq(ingestWebhooks.teamId, DEMO_IDS.team)),
    db
      .select({ eventClass: ingestWebhooks.eventClass })
      .from(ingestWebhooks)
      .where(
        and(eq(ingestWebhooks.teamId, DEMO_IDS.team), eq(ingestWebhooks.id, CORPUS_WEBHOOK.id)),
      ),
    db
      .select({ provider: integrations.provider, enabled: integrations.enabled })
      .from(integrations)
      .where(eq(integrations.teamId, DEMO_IDS.team)),
    db
      .select({ enabled: mcpServers.enabled })
      .from(mcpServers)
      .where(eq(mcpServers.teamId, DEMO_IDS.team)),
    db
      .select({ value: count() })
      .from(teamOnboardingCompletions)
      .where(eq(teamOnboardingCompletions.teamId, DEMO_IDS.team)),
    db
      .select({ value: count() })
      .from(boardItems)
      .innerJoin(boards, eq(boards.id, boardItems.boardId))
      .innerJoin(entities, eq(entities.id, boardItems.entityId))
      .where(
        and(
          eq(boardItems.teamId, DEMO_IDS.team),
          eq(boards.name, 'Customer dealflow'),
          eq(entities.canonicalName, 'Polar Studio'),
          isNull(boardItems.archivedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(rawEvents)
      .where(
        and(eq(rawEvents.teamId, DEMO_IDS.team), sql`${rawEvents.id}::text LIKE '92000000-%'`),
      ),
    db
      .select({ value: count() })
      .from(rawEvents)
      .where(
        and(eq(rawEvents.teamId, DEMO_IDS.team), sql`${rawEvents.id}::text LIKE '91000000-%'`),
      ),
    db
      .select({ value: count() })
      .from(facts)
      .where(and(eq(facts.teamId, DEMO_IDS.team), sql`${facts.id}::text LIKE 'c4000000-%'`)),
    db
      .select({ value: count() })
      .from(facts)
      .where(and(eq(facts.teamId, DEMO_IDS.team), sql`${facts.id}::text LIKE 'c3000000-%'`)),
  ]);

  const documentChecksums: string[] = [];
  for (const document of CORPUS_DOCUMENTS) {
    const object = await getObjectBuffer(
      getS3Client(),
      getDocumentsBucket(),
      document.objectKey,
      document.byteSize,
    );
    documentChecksums.push(createHash('sha256').update(object.body).digest('hex'));
    if (documentChecksums.at(-1) !== document.checksumSha256) {
      throw new Error(`Corpus document ${document.name} bytes do not match the seeded checksum`);
    }
  }

  const corpusVersionRows = await db
    .select({
      id: documentVersions.id,
      processingStatus: documentVersions.processingStatus,
      embeddingModelVersion: documentVersions.embeddingModelVersion,
    })
    .from(documentVersions)
    .where(
      inArray(
        documentVersions.id,
        CORPUS_DOCUMENTS.map((document) => document.versionId),
      ),
    );
  const embeddedCorpusDocumentVersions = corpusVersionRows.filter(
    (row) => row.processingStatus === 'embedded' && Boolean(row.embeddingModelVersion),
  ).length;
  const embeddingModels = new Set(
    corpusVersionRows
      .map((row) => row.embeddingModelVersion)
      .filter((model): model is string => Boolean(model)),
  );
  const corpusChunkIds = CORPUS_DOCUMENTS.flatMap((document) => document.chunkIds);
  const corpusMeetingChunkIds = CORPUS_MEETINGS.flatMap((meeting) => meeting.chunkIds);
  let corpusDocumentChunkPointsPresent = 0;
  let corpusMeetingChunkPointsPresent = 0;
  if (embeddingModels.size === 1) {
    const model = [...embeddingModels][0];
    if (model) {
      const documentPointIds = corpusChunkIds.map((chunkId) =>
        qdrant.buildChunkedPointId('doc_chunk', chunkId, model, 0),
      );
      const meetingPointIds = corpusMeetingChunkIds.map((chunkId) =>
        qdrant.buildChunkedPointId('meeting_chunk', chunkId, model, 0),
      );
      const present = await qdrant
        .getQdrantClient()
        .pointsExist([...documentPointIds, ...meetingPointIds]);
      corpusDocumentChunkPointsPresent = documentPointIds.filter((pointId) =>
        present.has(pointId),
      ).length;
      corpusMeetingChunkPointsPresent = meetingPointIds.filter((pointId) =>
        present.has(pointId),
      ).length;
    }
  }

  const passwordUsableEmails: string[] = [];
  for (const row of peopleRows) {
    if (row.passwordHash && (await verifyPassword(DEMO_LOGIN_PASSWORD, row.passwordHash))) {
      passwordUsableEmails.push(row.email);
    }
  }

  return {
    people: peopleRows.length,
    loginEmails: peopleRows.map((row) => row.email),
    passwordUsableEmails,
    events: Number(eventCount[0]?.value ?? 0),
    objects: Number(objectCount[0]?.value ?? 0),
    documents: Number(documentCount[0]?.value ?? 0),
    meetings: Number(meetingCount[0]?.value ?? 0),
    pendingProposals: Number(proposalCount[0]?.value ?? 0),
    boardItems: Number(boardItemCount[0]?.value ?? 0),
    chatSessions: Number(chatCount[0]?.value ?? 0),
    digests: Number(digestCount[0]?.value ?? 0),
    facts: Number(factCount[0]?.value ?? 0),
    slackWorkspaces: Number(slackCount[0]?.value ?? 0),
    slackWorkspaceId: slackWorkspaceRows[0]?.workspaceId ?? null,
    slackWorkspaceEnabled: slackWorkspaceRows[0]?.enabled === true,
    telegramBindings: Number(telegramCount[0]?.value ?? 0),
    ingestWebhooks: Number(webhookCount[0]?.value ?? 0),
    ingestWebhookEventClass: webhookRows[0]?.eventClass ?? null,
    extraProviders: integrationRows.map((row) => row.provider),
    disabledIntegrationProviders: integrationRows
      .filter((row) => row.enabled === false)
      .map((row) => row.provider),
    mcpEnabled: mcpRows.some((row) => row.enabled),
    mcpServerCount: mcpRows.length,
    corpusRawEventCount: Number(corpusEventCount[0]?.value ?? 0),
    northstarRawEventCount: Number(northstarEventCount[0]?.value ?? 0),
    corpusFactCount: Number(corpusFactCount[0]?.value ?? 0),
    northstarFactCount: Number(northstarFactCount[0]?.value ?? 0),
    documentChecksums,
    embeddedCorpusDocumentVersions,
    corpusDocumentChunkPointsPresent,
    corpusMeetingChunkPointsPresent,
    polarDealflowItems: Number(polarDealflowCount[0]?.value ?? 0),
    onboardingStepsCompleted: Number(onboardingCount[0]?.value ?? 0),
  };
}

async function main(): Promise<void> {
  assertDemoVectorEnvironment();
  try {
    assertDemoFixture(await readDemoFixtureSnapshot());
    assertExpandedDemoCorpus(await readExpandedDemoCorpusSnapshot());
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
