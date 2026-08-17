import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertDemoFixture,
  assertDemoSeedEnvironment,
  assertDemoVectorEnvironment,
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
import {
  buildCadenceBeats,
  CADENCE_RANGE,
  CADENCE_WEEKDAY_EVENT_FLOOR,
  CADENCE_WEEKDAY_MOMENT_CEILING,
  cadenceBeatGroupKey,
  isSlackUnixTs,
} from './demo-corpus/cadence.js';
import {
  assertExpandedDemoCorpus,
  CORPUS_CALENDAR_EVENTS,
  CORPUS_DOCUMENTS,
  CORPUS_EVENT_NEEDLES,
  CORPUS_EVENTS,
  CORPUS_FACTS,
  CORPUS_MEETINGS,
  CORPUS_OBJECTS,
  CORPUS_PEOPLE,
  CORPUS_PROPOSALS,
  CORPUS_SLACK,
  CORPUS_VOLUME_FLOORS,
  DEALFLOW_ITEMS,
  corpusEventId,
  corpusObjectId,
} from './demo-corpus/index.js';

const localEnv = {
  DATABASE_URL: 'postgres://timeline:timeline_dev@localhost:5432/timeline',
  AUTH_SECRET: 'local-auth-secret',
  SECRETS_ENCRYPTION_KEY: 'local-encryption-key',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET_DOCUMENTS: 'timeline-documents',
};

assert.doesNotThrow(() => assertDemoSeedEnvironment(localEnv));

assert.throws(
  () => assertDemoSeedEnvironment({ ...localEnv, NODE_ENV: 'production' }),
  /Refusing to run demo seed or verification with NODE_ENV=production/,
);

assert.throws(
  () => assertDemoVectorEnvironment(localEnv),
  /OPENROUTER_API_KEY is required to create and verify genuine demo embeddings/,
);

assert.throws(
  () => assertDemoVectorEnvironment({ ...localEnv, OPENROUTER_API_KEY: 'dev-key' }),
  /QDRANT_URL is required to create and verify demo vectors/,
);

assert.throws(
  () =>
    assertDemoVectorEnvironment({
      ...localEnv,
      OPENROUTER_API_KEY: 'dev-key',
      QDRANT_URL: 'https://qdrant.example.com',
    }),
  /Refusing to use non-local Qdrant host "qdrant\.example\.com"/,
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

assert.throws(
  () =>
    assertDemoSeedEnvironment({
      ...localEnv,
      S3_ENDPOINT: 'https://objects.example.com',
    }),
  /Refusing to use non-local S3 endpoint host "objects\.example\.com"/,
);

assert.throws(
  () =>
    assertDemoSeedEnvironment({
      ...localEnv,
      S3_BUCKET_DOCUMENTS: 'timeline-production-documents',
    }),
  /Refusing to use non-isolated documents bucket "timeline-production-documents"/,
);

assert.doesNotThrow(() =>
  assertDemoSeedEnvironment({
    ...localEnv,
    S3_ENDPOINT: 'https://objects.dev.example.com',
    S3_BUCKET_DOCUMENTS: 'timeline-review-349-documents',
    ALLOW_DEV_SEED_STORAGE: 'I_UNDERSTAND_THIS_WRITES_DEMO_DATA_TO_ISOLATED_STORAGE',
  }),
);

assert.throws(
  () =>
    assertDemoSeedEnvironment({
      ...localEnv,
      NODE_ENV: 'production',
      S3_ENDPOINT: 'https://objects.dev.example.com',
      S3_BUCKET_DOCUMENTS: 'timeline-review-349-documents',
      ALLOW_DEV_SEED_STORAGE: 'I_UNDERSTAND_THIS_WRITES_DEMO_DATA_TO_ISOLATED_STORAGE',
    }),
  /Refusing to run demo seed or verification with NODE_ENV=production/,
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

corruptionFails('same-size document object content', (snapshot) => {
  if (snapshot.document) {
    snapshot.document.backingObjectChecksumSha256 = '0'.repeat(64);
  }
});

corruptionFails('missing discoverable vector', (snapshot) => {
  snapshot.vectors.discoverablePointIds = snapshot.vectors.discoverablePointIds.slice(1);
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
assert.equal(
  packageJson.scripts?.['demo:seed'],
  'pnpm dev:seed && pnpm demo:index && pnpm demo:verify',
);
assert.equal(packageJson.scripts?.['demo:reset'], 'pnpm dev:wipe && pnpm demo:seed');
assert.equal(
  packageJson.scripts?.['dev:seed:heavy'],
  'NODE_OPTIONS=--conditions=development tsx scripts/seed-dev.ts --heavy',
);
assert.equal(packageJson.scripts?.['demo:index']?.includes('fixture-version=demo-seed-v1'), true);

const glossary = readFileSync('docs/demo-corpus.md', 'utf8');
for (const person of CORPUS_PEOPLE) {
  assert.match(glossary, new RegExp(person.email.replaceAll('.', '\\.')));
}
assert.match(glossary, /Customer dealflow/);
assert.match(glossary, /Series A funding/);
assert.match(glossary, /pnpm demo:seed/);
assert.match(glossary, /pnpm demo:reset/);
assert.match(glossary, /pnpm dev:seed:heavy/);
assert.match(glossary, /Polar Studio is inbound/);
assert.match(glossary, /pending add-to-board/);
assert.match(glossary, /Active lane holds the Northstar Works company/);
assert.match(glossary, /90.100 raw events/);
assert.match(glossary, /#hiring/);

assert.ok(CORPUS_EVENTS.length + DEMO_EVENTS.length >= CORPUS_VOLUME_FLOORS.events);
assert.ok(CORPUS_OBJECTS.length + DEMO_ENTITIES.length >= CORPUS_VOLUME_FLOORS.objects);
assert.ok(CORPUS_DOCUMENTS.length + 1 >= CORPUS_VOLUME_FLOORS.documents);
assert.doesNotThrow(() => corpusEventId('dealflow this week'));
assert.throws(
  () => corpusEventId('no-such-demo-event-needle'),
  /Expected exactly one corpus event containing/,
);
for (const needle of CORPUS_EVENT_NEEDLES) {
  assert.doesNotThrow(() => corpusEventId(needle), needle);
}
assert.ok(DEALFLOW_ITEMS.every((item) => item.entityName !== 'Polar Studio'));
assert.equal(new Set(CORPUS_EVENTS.map((row) => row.id)).size, CORPUS_EVENTS.length);

function metadataStrings(source: string, key: string): string[] {
  return CORPUS_EVENTS.filter((row) => row.source === source)
    .map((row) => row.sourceMetadata[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function assertUnique(values: string[], label: string): void {
  assert.equal(new Set(values).size, values.length, label);
}

assertUnique(
  CORPUS_EVENTS.map((row) => String(row.sourceMetadata.source_payload_ref ?? '')),
  'source_payload_ref',
);
assertUnique(
  CORPUS_EVENTS.map((row) => String(row.sourceMetadata.payload_digest ?? '')),
  'payload_digest',
);
assertUnique(metadataStrings('slack', 'slack_event_id'), 'slack_event_id');
assert.equal(
  metadataStrings('slack', 'slack_event_id').length,
  CORPUS_EVENTS.filter((row) => row.source === 'slack').length,
);
assertUnique(metadataStrings('email', 'message_id'), 'email message_id');
assert.equal(
  metadataStrings('email', 'message_id').length,
  CORPUS_EVENTS.filter((row) => row.source === 'email').length,
);
assertUnique(metadataStrings('telegram', 'tg_update_id'), 'tg_update_id');
assert.equal(
  metadataStrings('telegram', 'tg_update_id').length,
  CORPUS_EVENTS.filter((row) => row.source === 'telegram').length,
);
assertUnique(
  metadataStrings('ingest_webhook', 'ingest_webhook_dedup_key'),
  'ingest_webhook_dedup_key',
);
assert.equal(
  metadataStrings('ingest_webhook', 'ingest_webhook_dedup_key').length,
  CORPUS_EVENTS.filter((row) => row.source === 'ingest_webhook').length,
);
assertUnique(
  CORPUS_EVENTS.filter((row) => row.source === 'integration')
    .map((row) => row.sourceMetadata.dedup_key)
    .filter((value): value is string => typeof value === 'string' && value.length > 0),
  'integration dedup_key',
);
assert.equal(
  CORPUS_EVENTS.filter((row) => row.source === 'integration').every(
    (row) => typeof row.sourceMetadata.dedup_key === 'string',
  ),
  true,
);
assertUnique(
  CORPUS_EVENTS.flatMap((row) => {
    const match = /GitHub workflow "([^"]+)" #(\d+)/.exec(row.contentText);
    return match ? [`${match[1]}#${match[2]}`, `#${match[2]}`] : [];
  }),
  'GitHub workflow run numbers',
);
for (const event of CORPUS_EVENTS.filter((row) => row.source === 'slack')) {
  assert.equal(isSlackUnixTs(event.sourceMetadata.slack_thread_ts), true, event.id);
  assert.equal(isSlackUnixTs(event.sourceMetadata.slack_message_ts), true, event.id);
  assert.equal(event.sourceMetadata.slack_workspace_id, CORPUS_SLACK.workspace, event.id);
  assert.equal(event.sourceMetadata.slack_team_id, 'T0ACMEDEMO', event.id);
}
for (const event of CORPUS_EVENTS) {
  assert.equal(typeof event.sourceMetadata.event_class, 'string', event.id);
}
for (const event of CORPUS_EVENTS.filter((row) => row.source === 'email')) {
  assert.equal(typeof event.sourceMetadata.html_body, 'string', event.id);
}
for (const event of CORPUS_EVENTS.filter((row) => row.source === 'document')) {
  assert.equal(typeof event.sourceMetadata.document_id, 'string', event.id);
}
const atlasRelease = CORPUS_EVENTS.find((row) =>
  row.contentText.includes('GitHub release atlas-0.8.0 tagged'),
);
assert.equal(
  (atlasRelease?.sourceMetadata.github as { type?: string } | undefined)?.type,
  'release',
);
for (const row of CORPUS_CALENDAR_EVENTS) {
  const event = CORPUS_EVENTS.find((item) => item.id === row.rawEventId);
  assert.equal(event?.source, 'calendar', row.title);
  assert.equal(event?.sourceMetadata.calendar_event_id, row.id, row.title);
  assert.equal(event?.sourceMetadata.action, 'scheduled', row.title);
}
for (const event of CORPUS_EVENTS.filter(
  (row) =>
    row.source === 'integration' &&
    (row.sourceMetadata.github as { type?: string } | undefined)?.type === 'pull_request',
)) {
  const github = event.sourceMetadata.github as { number?: number; pr_number?: number };
  assert.equal(typeof github.number, 'number', event.id);
}
assert.equal(
  new Set(CORPUS_DOCUMENTS.flatMap((doc) => [doc.id, doc.versionId, ...doc.chunkIds])).size,
  CORPUS_DOCUMENTS.reduce((count, doc) => count + 2 + doc.chunkIds.length, 0),
);
assert.equal(
  new Set(CORPUS_MEETINGS.flatMap((meeting) => meeting.chunkIds)).size,
  CORPUS_MEETINGS.reduce((count, meeting) => count + meeting.chunkIds.length, 0),
);
for (const meeting of CORPUS_MEETINGS) {
  assert.equal(
    meeting.chunkIds.length,
    meeting.transcript.length,
    `${meeting.title} ${meeting.startedAt} chunk ids`,
  );
}
assert.equal(
  new Set(CORPUS_OBJECTS.map((row) => row.canonicalName.toLowerCase())).size,
  CORPUS_OBJECTS.length,
);
assert.equal(corpusObjectId('Brightline Health'), corpusObjectId('Brightline Health', 'deal'));
assert.ok(
  CORPUS_PROPOSALS.every((row) => typeof row.eventId === 'string' && row.eventId.length > 0),
);

const cadenceBeats = buildCadenceBeats();
const weekdayEvents = new Map<string, typeof cadenceBeats>();
for (const beat of cadenceBeats) {
  const day = beat.occurredAt.slice(0, 10);
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) continue;
  const rows = weekdayEvents.get(day) ?? [];
  rows.push(beat);
  weekdayEvents.set(day, rows);
}
assert.ok(weekdayEvents.size >= 20, 'cadence should cover a month of weekdays');
for (const [day, rows] of weekdayEvents) {
  assert.ok(
    rows.length >= CADENCE_WEEKDAY_EVENT_FLOOR,
    `${day} cadence events ${String(rows.length)}`,
  );
  const groups = new Set(rows.map((row) => cadenceBeatGroupKey(row)));
  assert.ok(
    groups.size <= CADENCE_WEEKDAY_MOMENT_CEILING,
    `${day} cadence moments ${String(groups.size)}`,
  );
  assert.ok(groups.size * 3 < rows.length, `${day} should collapse events into fewer moments`);
}
assert.equal(CADENCE_RANGE.start, '2026-07-14');
assert.equal(CADENCE_RANGE.end, '2026-08-14');
for (const beat of cadenceBeats) {
  for (const needle of CORPUS_EVENT_NEEDLES) {
    assert.equal(
      beat.contentText.includes(needle),
      false,
      `cadence beat ${String(beat.n)} repeats needle ${needle}`,
    );
  }
}
assert.doesNotThrow(() =>
  assertExpandedDemoCorpus({
    people: CORPUS_PEOPLE.length,
    loginEmails: CORPUS_PEOPLE.map((person) => person.email),
    passwordUsableEmails: CORPUS_PEOPLE.map((person) => person.email),
    events: 2500,
    objects: 55,
    documents: CORPUS_DOCUMENTS.length + 1,
    meetings: 11,
    pendingProposals: 14,
    boardItems: 17,
    chatSessions: 8,
    digests: 20,
    facts: 24,
    slackWorkspaces: 1,
    slackWorkspaceId: CORPUS_SLACK.workspace,
    slackWorkspaceEnabled: true,
    telegramBindings: 1,
    ingestWebhooks: 1,
    extraProviders: ['github', 'linear', 'monday', 'sentry', 'google_drive'],
    disabledIntegrationProviders: ['github', 'linear', 'monday', 'sentry', 'google_drive'],
    mcpEnabled: false,
    mcpServerCount: 1,
    corpusRawEventCount: CORPUS_EVENTS.length,
    northstarRawEventCount: DEMO_EVENTS.length,
    corpusFactCount: CORPUS_FACTS.length,
    northstarFactCount: Object.keys(DEMO_FACTS).length,
    documentChecksums: CORPUS_DOCUMENTS.map((doc) => doc.checksumSha256),
    embeddedCorpusDocumentVersions: CORPUS_DOCUMENTS.length,
    corpusDocumentChunkPointsPresent: CORPUS_DOCUMENTS.reduce(
      (count, document) => count + document.chunkIds.length,
      0,
    ),
    corpusMeetingChunkPointsPresent: CORPUS_MEETINGS.reduce(
      (count, meeting) => count + meeting.chunkIds.length,
      0,
    ),
    polarDealflowItems: 0,
    onboardingStepsCompleted: 11,
  }),
);
assert.throws(
  () =>
    assertExpandedDemoCorpus({
      people: 2,
      loginEmails: ['owner@timeline.dev'],
      passwordUsableEmails: ['owner@timeline.dev'],
      events: 4,
      objects: 3,
      documents: 1,
      meetings: 1,
      pendingProposals: 0,
      boardItems: 2,
      chatSessions: 0,
      digests: 0,
      facts: 5,
      slackWorkspaces: 0,
      slackWorkspaceId: null,
      slackWorkspaceEnabled: false,
      telegramBindings: 0,
      ingestWebhooks: 0,
      extraProviders: ['github'],
      disabledIntegrationProviders: [],
      mcpEnabled: true,
      mcpServerCount: 0,
      corpusRawEventCount: 0,
      northstarRawEventCount: 0,
      corpusFactCount: 0,
      northstarFactCount: 0,
      documentChecksums: [],
      embeddedCorpusDocumentVersions: 0,
      corpusDocumentChunkPointsPresent: 0,
      corpusMeetingChunkPointsPresent: 0,
      polarDealflowItems: 1,
      onboardingStepsCompleted: 0,
    }),
  /Expanded demo corpus verification failed/,
);

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
        embedded_at: '2026-07-10T00:00:00.000Z',
        embedding_model: 'openai/text-embedding-3-small',
        embedding_chunks: 1,
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
      versionSourceEventId: null,
      versionObjectKey: DEMO_DOCUMENT_OBJECT_KEY,
      versionByteSize: DEMO_DOCUMENT_BYTE_SIZE,
      versionContentType: DEMO_DOCUMENT_CONTENT_TYPE,
      versionChecksumSha256: DEMO_DOCUMENT_CHECKSUM_SHA256,
      versionProcessingStatus: 'embedded',
      versionEmbeddingModelVersion: 'openai/text-embedding-3-small',
      backingObjectExists: true,
      backingObjectByteSize: DEMO_DOCUMENT_BYTE_SIZE,
      backingObjectContentType: DEMO_DOCUMENT_CONTENT_TYPE,
      backingObjectChecksumSha256: DEMO_DOCUMENT_CHECKSUM_SHA256,
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
    vectors: {
      embeddingModel: 'openai/text-embedding-3-small',
      expectedPointIds: Array.from({ length: 11 }, (_, index) => `point-${String(index)}`),
      discoverablePointIds: Array.from({ length: 11 }, (_, index) => `point-${String(index)}`),
      sourceCounts: {
        rawEvents: 4,
        facts: 5,
        documentChunks: 1,
        meetingChunks: 1,
      },
    },
  };
}
