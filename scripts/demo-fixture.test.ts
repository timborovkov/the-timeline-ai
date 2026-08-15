import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertDemoFixture,
  assertDemoSeedEnvironment,
  DEMO_DOCUMENT_BYTE_SIZE,
  DEMO_DOCUMENT_CHECKSUM_SHA256,
  DEMO_DOCUMENT_CONTENT_TYPE,
  DEMO_DOCUMENT_OBJECT_KEY,
  DEMO_DOCUMENT_TEXT,
  DEMO_ENTITIES,
  DEMO_EVENTS,
  DEMO_FACTS,
  DEMO_FIXTURE_VERSION,
  DEMO_IDS,
  type DemoFixtureSnapshot,
} from './demo-fixture.js';

const localEnv = {
  DATABASE_URL: 'postgres://timeline:timeline_dev@localhost:5432/timeline',
  AUTH_SECRET: 'local-auth-secret',
  SECRETS_ENCRYPTION_KEY: 'local-encryption-key',
};

assert.doesNotThrow(() => assertDemoSeedEnvironment(localEnv));

assert.throws(
  () => assertDemoSeedEnvironment({ ...localEnv, NODE_ENV: 'production' }),
  /Refusing to run demo seed or verification with NODE_ENV=production/,
);

assert.throws(
  () =>
    assertDemoSeedEnvironment({
      ...localEnv,
      DATABASE_URL: 'postgres://timeline:secret@db.example.com:5432/timeline',
    }),
  /Refusing to use non-local database host "db\.example\.com"/,
);

assert.doesNotThrow(() =>
  assertDemoSeedEnvironment({
    ...localEnv,
    DATABASE_URL: 'postgres://timeline:secret@db.example.com:5432/timeline',
    ALLOW_DEV_SEED: 'I_UNDERSTAND_THIS_SEEDS_KNOWN_DEV_CREDENTIALS',
  }),
);

assert.equal(DEMO_IDS.team, '20000000-0000-4000-8000-000000000001');
assert.equal(
  DEMO_FACTS.blocker,
  'Northstar export validation is blocked pending field-mapping confirmation.',
);

assert.doesNotThrow(() => assertDemoFixture(validSnapshot()));

corruptionFails('workspace identity', (snapshot) => {
  if (snapshot.workspace) snapshot.workspace.id = '20000000-0000-4000-8000-000000000099';
});

corruptionFails('login identity', (snapshot) => {
  const owner = snapshot.logins.find((login) => login.id === DEMO_IDS.owner);
  if (owner) owner.email = 'wrong-owner@timeline.dev';
});

corruptionFails('login membership', (snapshot) => {
  const member = snapshot.logins.find((login) => login.id === DEMO_IDS.member);
  if (member) member.membershipActive = false;
});

corruptionFails('login password usability', (snapshot) => {
  const owner = snapshot.logins.find((login) => login.id === DEMO_IDS.owner);
  if (owner) owner.passwordUsable = false;
});

corruptionFails('source chronology', (snapshot) => {
  const provider = snapshot.events.find((row) => row.id === DEMO_IDS.eventProvider);
  if (provider) provider.occurredAt = '2026-07-08T14:59:00.000Z';
});

corruptionFails('visibility', (snapshot) => {
  const email = snapshot.events.find((row) => row.id === DEMO_IDS.eventEmail);
  if (email) {
    email.visibility = 'private';
    email.visibilityOwnerUserId = DEMO_IDS.owner;
  }
});

corruptionFails('raw-event source link', (snapshot) => {
  const meeting = snapshot.events.find((row) => row.id === DEMO_IDS.eventMeeting);
  if (meeting) delete meeting.sourceMetadata.source_payload_ref;
});

corruptionFails('association source link', (snapshot) => {
  const blocker = snapshot.associations.find((row) => row.id === DEMO_IDS.associationBlocker);
  if (blocker) blocker.sourceRefs = [];
});

corruptionFails('explicit-note association visibility', (snapshot) => {
  const note = snapshot.associations.find((row) => row.id === DEMO_IDS.associationNote);
  if (note) note.visibility = 'private';
});

corruptionFails('explicit-note association visibility floor', (snapshot) => {
  const note = snapshot.associations.find((row) => row.id === DEMO_IDS.associationNote);
  if (note) note.visibilityFloor = 'private';
});

corruptionFails('document backing object', (snapshot) => {
  if (snapshot.document) snapshot.document.backingObjectExists = false;
});

corruptionFails('document byte size', (snapshot) => {
  if (snapshot.document) snapshot.document.versionByteSize = DEMO_DOCUMENT_BYTE_SIZE - 1;
});

corruptionFails('document checksum', (snapshot) => {
  if (snapshot.document) snapshot.document.versionChecksumSha256 = 'incorrect-checksum';
});

corruptionFails('current blocker support', (snapshot) => {
  snapshot.associations = snapshot.associations.filter(
    (row) => row.id !== DEMO_IDS.associationBlocker,
  );
});

corruptionFails('canonical cluster support', (snapshot) => {
  const delivery = snapshot.clusters.find((row) => row.id === DEMO_IDS.clusterDelivery);
  if (delivery) delivery.canonicalEntityId = DEMO_IDS.objectDecision;
});

corruptionFails('handoff support', (snapshot) => {
  snapshot.factLinks = snapshot.factLinks.filter((row) => row.factId !== DEMO_IDS.factHandoff);
});

corruptionFails('customer commitment support', (snapshot) => {
  const commitment = snapshot.facts.find((row) => row.id === DEMO_IDS.factCommitment);
  if (commitment) commitment.rawEventId = DEMO_IDS.eventNote;
});

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};
assert.equal(
  packageJson.scripts?.['demo:verify'],
  'NODE_OPTIONS=--conditions=development tsx scripts/verify-demo.ts',
);
assert.equal(packageJson.scripts?.['demo:seed'], 'pnpm dev:seed && pnpm demo:verify');

console.log('demo fixture tests passed');

function corruptionFails(label: string, corrupt: (snapshot: DemoFixtureSnapshot) => void): void {
  const snapshot = validSnapshot();
  corrupt(snapshot);
  assert.throws(() => assertDemoFixture(snapshot), /Demo fixture verification failed/, label);
}

function validSnapshot(): DemoFixtureSnapshot {
  const evidenceByEvent = new Map([
    [DEMO_IDS.eventNote, DEMO_IDS.evidenceNote],
    [DEMO_IDS.eventEmail, DEMO_IDS.evidenceEmail],
    [DEMO_IDS.eventMeeting, DEMO_IDS.evidenceMeeting],
    [DEMO_IDS.eventProvider, DEMO_IDS.evidenceProvider],
  ]);
  const support = [
    {
      factId: DEMO_IDS.factCommitment,
      statement: DEMO_FACTS.commitment,
      eventId: DEMO_IDS.eventEmail,
      entityId: DEMO_IDS.objectPilot,
      evidenceId: DEMO_IDS.evidenceEmail,
      associationId: DEMO_IDS.associationCommitment,
      clusterId: DEMO_IDS.clusterPilot,
      role: 'update',
    },
    {
      factId: DEMO_IDS.factHandoff,
      statement: DEMO_FACTS.handoff,
      eventId: DEMO_IDS.eventMeeting,
      entityId: DEMO_IDS.objectDelivery,
      evidenceId: DEMO_IDS.evidenceMeeting,
      associationId: DEMO_IDS.associationHandoff,
      clusterId: DEMO_IDS.clusterDelivery,
      role: 'update',
    },
    {
      factId: DEMO_IDS.factDecision,
      statement: DEMO_FACTS.decision,
      eventId: DEMO_IDS.eventMeeting,
      entityId: DEMO_IDS.objectDecision,
      evidenceId: DEMO_IDS.evidenceMeeting,
      associationId: DEMO_IDS.associationDecision,
      clusterId: DEMO_IDS.clusterDecision,
      role: 'decision',
    },
    {
      factId: DEMO_IDS.factBlocker,
      statement: DEMO_FACTS.blocker,
      eventId: DEMO_IDS.eventProvider,
      entityId: DEMO_IDS.objectDelivery,
      evidenceId: DEMO_IDS.evidenceProvider,
      associationId: DEMO_IDS.associationBlocker,
      clusterId: DEMO_IDS.clusterDelivery,
      role: 'blocker',
    },
    {
      factId: DEMO_IDS.factStatus,
      statement: DEMO_FACTS.status,
      eventId: DEMO_IDS.eventProvider,
      entityId: DEMO_IDS.objectDelivery,
      evidenceId: DEMO_IDS.evidenceProvider,
      associationId: DEMO_IDS.associationStatus,
      clusterId: DEMO_IDS.clusterDelivery,
      role: 'lifecycle_update',
    },
  ];

  return {
    workspace: { id: DEMO_IDS.team, slug: 'acme-labs', name: 'Acme Labs' },
    logins: [
      {
        id: DEMO_IDS.owner,
        name: 'Avery Timeline',
        email: 'owner@timeline.dev',
        teamId: DEMO_IDS.team,
        role: 'owner',
        membershipActive: true,
        passwordUsable: true,
      },
      {
        id: DEMO_IDS.member,
        name: 'Mika Product',
        email: 'member@timeline.dev',
        teamId: DEMO_IDS.team,
        role: 'member',
        membershipActive: true,
        passwordUsable: true,
      },
    ],
    integration: {
      id: DEMO_IDS.linearIntegration,
      teamId: DEMO_IDS.team,
      provider: 'linear',
      enabled: false,
      selectionId: DEMO_IDS.linearSelection,
      selectionIntegrationId: DEMO_IDS.linearIntegration,
      selectionExternalId: 'LIN-TL',
    },
    events: DEMO_EVENTS.map((event) => ({
      id: event.id,
      teamId: DEMO_IDS.team,
      source: event.source,
      contentText: event.contentText,
      occurredAt: event.occurredAt,
      visibility: 'team',
      visibilityOwnerUserId: null,
      visibilityUserIds: null,
      sourceMetadata: {
        fixture_version: DEMO_FIXTURE_VERSION,
        source_payload_ref: event.sourcePayloadRef,
        ...(event.id === DEMO_IDS.eventNote
          ? { capture_kind: 'explicit_chat_note', command: '/timeline note' }
          : {}),
        ...(event.id === DEMO_IDS.eventEmail
          ? { message_id: 'demo-seed-northstar-export-commitment-001' }
          : {}),
        ...(event.id === DEMO_IDS.eventMeeting ? { meeting_id: DEMO_IDS.meeting } : {}),
        ...(event.id === DEMO_IDS.eventProvider
          ? {
              provider: 'linear',
              integration_id: DEMO_IDS.linearIntegration,
              selection_external_id: 'LIN-TL',
              external_object_id: 'NORTH-42',
            }
          : {}),
      },
    })),
    entities: DEMO_ENTITIES.map((entity) => ({ ...entity, teamId: DEMO_IDS.team })),
    clusters: [
      {
        id: DEMO_IDS.clusterPilot,
        teamId: DEMO_IDS.team,
        canonicalEntityId: DEMO_IDS.objectPilot,
      },
      {
        id: DEMO_IDS.clusterDelivery,
        teamId: DEMO_IDS.team,
        canonicalEntityId: DEMO_IDS.objectDelivery,
      },
      {
        id: DEMO_IDS.clusterDecision,
        teamId: DEMO_IDS.team,
        canonicalEntityId: DEMO_IDS.objectDecision,
      },
    ],
    facts: support.map(({ factId, statement, eventId }) => ({
      id: factId,
      teamId: DEMO_IDS.team,
      rawEventId: eventId,
      statement,
      modelVersion: DEMO_FIXTURE_VERSION,
    })),
    factLinks: support.map(({ factId, entityId }) => ({ factId, entityId, role: 'subject' })),
    evidence: DEMO_EVENTS.map((event) => ({
      id: evidenceByEvent.get(event.id) ?? '',
      teamId: DEMO_IDS.team,
      rawEventId: event.id,
      source: event.source,
      sourcePayloadRef: event.sourcePayloadRef,
      occurredAt: event.occurredAt,
      visibility: 'team',
    })),
    associations: [
      {
        id: DEMO_IDS.associationNote,
        teamId: DEMO_IDS.team,
        clusterId: DEMO_IDS.clusterPilot,
        evidenceId: DEMO_IDS.evidenceNote,
        rawEventId: DEMO_IDS.eventNote,
        role: 'discussion',
        visibility: 'team',
        visibilityFloor: 'team',
        sourceRefs: [{ rawEventId: DEMO_IDS.eventNote, evidenceId: DEMO_IDS.evidenceNote }],
      },
      ...support.map(({ associationId, clusterId, evidenceId, eventId, role }) => ({
        id: associationId,
        teamId: DEMO_IDS.team,
        clusterId,
        evidenceId,
        rawEventId: eventId,
        role,
        visibility: 'team',
        visibilityFloor: 'team',
        sourceRefs: [{ rawEventId: eventId, evidenceId }],
      })),
    ],
    document: {
      id: DEMO_IDS.document,
      teamId: DEMO_IDS.team,
      name: 'Northstar pilot handoff brief.txt',
      visibility: 'team',
      sourceRawEventId: DEMO_IDS.eventEmail,
      currentVersionId: DEMO_IDS.documentVersion,
      versionId: DEMO_IDS.documentVersion,
      versionDocumentId: DEMO_IDS.document,
      versionSourceEventId: DEMO_IDS.eventEmail,
      versionObjectKey: DEMO_DOCUMENT_OBJECT_KEY,
      versionByteSize: DEMO_DOCUMENT_BYTE_SIZE,
      versionContentType: DEMO_DOCUMENT_CONTENT_TYPE,
      versionChecksumSha256: DEMO_DOCUMENT_CHECKSUM_SHA256,
      versionProcessingStatus: 'embedded',
      backingObjectExists: true,
      backingObjectByteSize: DEMO_DOCUMENT_BYTE_SIZE,
      backingObjectContentType: DEMO_DOCUMENT_CONTENT_TYPE,
      chunkId: DEMO_IDS.documentChunk,
      chunkDocumentId: DEMO_IDS.document,
      chunkVersionId: DEMO_IDS.documentVersion,
      chunkText: DEMO_DOCUMENT_TEXT,
    },
    meeting: {
      id: DEMO_IDS.meeting,
      teamId: DEMO_IDS.team,
      status: 'completed',
      defaultVisibility: 'team',
      startedAt: '2026-07-08T15:00:00.000Z',
      endedAt: '2026-07-08T15:30:00.000Z',
      chunkId: DEMO_IDS.meetingChunk,
      chunkMeetingId: DEMO_IDS.meeting,
      chunkRawEventId: DEMO_IDS.eventMeeting,
      chunkText:
        'Avery: I am handing export validation to Mika. Mika: I own it. We will use the CSV fallback, but field-mapping confirmation is still blocking completion.',
    },
  };
}
