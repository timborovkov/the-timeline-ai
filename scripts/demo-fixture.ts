export const LOCAL_DEV_SEED_OVERRIDE = 'I_UNDERSTAND_THIS_SEEDS_KNOWN_DEV_CREDENTIALS';

export const DEMO_FIXTURE_VERSION = 'demo-seed-v1';

export const DEMO_IDS = {
  owner: '10000000-0000-4000-8000-000000000001',
  member: '10000000-0000-4000-8000-000000000002',
  team: '20000000-0000-4000-8000-000000000001',
  linearIntegration: '40000000-0000-4000-8000-000000000002',
  linearSelection: '60000000-0000-4000-8000-000000000002',
  eventNote: '91000000-0000-4000-8000-000000000001',
  eventEmail: '91000000-0000-4000-8000-000000000002',
  eventMeeting: '91000000-0000-4000-8000-000000000003',
  eventProvider: '91000000-0000-4000-8000-000000000004',
  objectPilot: 'a3000000-0000-4000-8000-000000000001',
  objectDelivery: 'a3000000-0000-4000-8000-000000000002',
  objectDecision: 'a3000000-0000-4000-8000-000000000003',
  clusterPilot: 'e3000000-0000-4000-8000-000000000001',
  clusterDelivery: 'e3000000-0000-4000-8000-000000000002',
  clusterDecision: 'e3000000-0000-4000-8000-000000000003',
  factCommitment: 'c3000000-0000-4000-8000-000000000001',
  factHandoff: 'c3000000-0000-4000-8000-000000000002',
  factDecision: 'c3000000-0000-4000-8000-000000000003',
  factBlocker: 'c3000000-0000-4000-8000-000000000004',
  factStatus: 'c3000000-0000-4000-8000-000000000005',
  evidenceNote: 'f3000000-0000-4000-8000-000000000001',
  evidenceEmail: 'f3000000-0000-4000-8000-000000000002',
  evidenceMeeting: 'f3000000-0000-4000-8000-000000000003',
  evidenceProvider: 'f3000000-0000-4000-8000-000000000004',
  associationNote: 'f4000000-0000-4000-8000-000000000001',
  associationCommitment: 'f4000000-0000-4000-8000-000000000002',
  associationHandoff: 'f4000000-0000-4000-8000-000000000003',
  associationDecision: 'f4000000-0000-4000-8000-000000000004',
  associationBlocker: 'f4000000-0000-4000-8000-000000000005',
  associationStatus: 'f4000000-0000-4000-8000-000000000006',
  document: '44000000-0000-4000-8000-000000000001',
  documentVersion: '44000000-0000-4000-8000-000000000002',
  documentChunk: '44000000-0000-4000-8000-000000000003',
  meeting: '55000000-0000-4000-8000-000000000001',
  meetingChunk: '55000000-0000-4000-8000-000000000002',
} as const;

export const DEMO_TIMES = {
  note: '2026-07-06T09:00:00.000Z',
  email: '2026-07-07T10:30:00.000Z',
  meeting: '2026-07-08T15:00:00.000Z',
  provider: '2026-07-09T16:15:00.000Z',
} as const;

export const DEMO_SOURCE_REFS = {
  note: 'inline://timeline/demo-seed/slack/northstar-kickoff-note',
  email: 'inline://timeline/demo-seed/email/northstar-export-commitment',
  meeting: 'inline://timeline/demo-seed/meeting/northstar-handoff-review',
  provider: 'inline://timeline/demo-seed/linear/NORTH-42',
} as const;

export const DEMO_FACTS = {
  commitment: 'Northstar Works committed to send the final sample export by July 8.',
  handoff: 'Avery handed Northstar export validation to Mika.',
  decision: 'The team decided to use the CSV fallback for the Northstar pilot.',
  blocker: 'Northstar export validation is blocked pending field-mapping confirmation.',
  status: 'The Northstar pilot export task is currently blocked and owned by Mika.',
} as const;

export const DEMO_EVENTS = [
  {
    id: DEMO_IDS.eventNote,
    source: 'slack',
    contentText:
      'Explicit note from Avery: Northstar pilot review is July 15. Keep the export path narrow and evidence-backed.',
    occurredAt: DEMO_TIMES.note,
    sourcePayloadRef: DEMO_SOURCE_REFS.note,
  },
  {
    id: DEMO_IDS.eventEmail,
    source: 'email',
    contentText:
      'Email from Elena Park at Northstar Works: We will send the final sample export by July 8 for the pilot review. Attached: Northstar pilot handoff brief.',
    occurredAt: DEMO_TIMES.email,
    sourcePayloadRef: DEMO_SOURCE_REFS.email,
  },
  {
    id: DEMO_IDS.eventMeeting,
    source: 'meeting',
    contentText:
      'Northstar pilot review transcript: Avery handed export validation to Mika. The team decided to use the CSV fallback. Field-mapping confirmation remains unresolved.',
    occurredAt: DEMO_TIMES.meeting,
    sourcePayloadRef: DEMO_SOURCE_REFS.meeting,
  },
  {
    id: DEMO_IDS.eventProvider,
    source: 'integration',
    contentText:
      'Linear issue NORTH-42 moved to Blocked: Validate Northstar pilot export. Owner: Mika. Blocker: waiting for field-mapping confirmation.',
    occurredAt: DEMO_TIMES.provider,
    sourcePayloadRef: DEMO_SOURCE_REFS.provider,
  },
] as const;

export const DEMO_ENTITIES = [
  {
    id: DEMO_IDS.objectPilot,
    type: 'project',
    canonicalName: 'Northstar pilot',
    status: 'active',
    stage: 'pilot_review',
    ownerUserId: DEMO_IDS.owner,
    assigneeUserId: null,
  },
  {
    id: DEMO_IDS.objectDelivery,
    type: 'task',
    canonicalName: 'Validate Northstar pilot export',
    status: 'blocked',
    stage: 'blocked',
    ownerUserId: DEMO_IDS.member,
    assigneeUserId: DEMO_IDS.member,
  },
  {
    id: DEMO_IDS.objectDecision,
    type: 'decision',
    canonicalName: 'Use CSV fallback for Northstar pilot',
    status: 'accepted',
    stage: 'decided',
    ownerUserId: DEMO_IDS.owner,
    assigneeUserId: null,
  },
] as const;

const DEMO_SUPPORT = [
  {
    label: 'customer commitment',
    factId: DEMO_IDS.factCommitment,
    statement: DEMO_FACTS.commitment,
    eventId: DEMO_IDS.eventEmail,
    entityId: DEMO_IDS.objectPilot,
    evidenceId: DEMO_IDS.evidenceEmail,
    associationId: DEMO_IDS.associationCommitment,
    clusterId: DEMO_IDS.clusterPilot,
    associationRole: 'update',
  },
  {
    label: 'handoff',
    factId: DEMO_IDS.factHandoff,
    statement: DEMO_FACTS.handoff,
    eventId: DEMO_IDS.eventMeeting,
    entityId: DEMO_IDS.objectDelivery,
    evidenceId: DEMO_IDS.evidenceMeeting,
    associationId: DEMO_IDS.associationHandoff,
    clusterId: DEMO_IDS.clusterDelivery,
    associationRole: 'update',
  },
  {
    label: 'decision',
    factId: DEMO_IDS.factDecision,
    statement: DEMO_FACTS.decision,
    eventId: DEMO_IDS.eventMeeting,
    entityId: DEMO_IDS.objectDecision,
    evidenceId: DEMO_IDS.evidenceMeeting,
    associationId: DEMO_IDS.associationDecision,
    clusterId: DEMO_IDS.clusterDecision,
    associationRole: 'decision',
  },
  {
    label: 'unresolved blocker',
    factId: DEMO_IDS.factBlocker,
    statement: DEMO_FACTS.blocker,
    eventId: DEMO_IDS.eventProvider,
    entityId: DEMO_IDS.objectDelivery,
    evidenceId: DEMO_IDS.evidenceProvider,
    associationId: DEMO_IDS.associationBlocker,
    clusterId: DEMO_IDS.clusterDelivery,
    associationRole: 'blocker',
  },
  {
    label: 'current status',
    factId: DEMO_IDS.factStatus,
    statement: DEMO_FACTS.status,
    eventId: DEMO_IDS.eventProvider,
    entityId: DEMO_IDS.objectDelivery,
    evidenceId: DEMO_IDS.evidenceProvider,
    associationId: DEMO_IDS.associationStatus,
    clusterId: DEMO_IDS.clusterDelivery,
    associationRole: 'lifecycle_update',
  },
] as const;

export interface DemoEventSnapshot {
  id: string;
  teamId: string;
  source: string;
  contentText: string | null;
  occurredAt: string;
  visibility: string;
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
  sourceMetadata: Record<string, unknown>;
}

export interface DemoFactSnapshot {
  id: string;
  teamId: string;
  rawEventId: string;
  statement: string;
  modelVersion: string;
}

export interface DemoEvidenceSnapshot {
  id: string;
  teamId: string;
  rawEventId: string;
  source: string;
  sourcePayloadRef: string | null;
  occurredAt: string;
  visibility: string;
}

export interface DemoAssociationSnapshot {
  id: string;
  teamId: string;
  clusterId: string;
  evidenceId: string;
  rawEventId: string | null;
  role: string;
  visibility: string;
  visibilityFloor: string;
  sourceRefs: unknown;
}

export interface DemoFixtureSnapshot {
  workspace: { id: string; slug: string; name: string } | null;
  integration: {
    id: string;
    teamId: string;
    provider: string;
    enabled: boolean;
    selectionId: string | null;
    selectionIntegrationId: string | null;
    selectionExternalId: string | null;
  } | null;
  events: DemoEventSnapshot[];
  entities: Array<{
    id: string;
    teamId: string;
    type: string;
    canonicalName: string;
    status: string;
    stage: string | null;
    ownerUserId: string | null;
    assigneeUserId: string | null;
  }>;
  clusters: Array<{
    id: string;
    teamId: string;
    canonicalEntityId: string | null;
  }>;
  facts: DemoFactSnapshot[];
  factLinks: Array<{ factId: string; entityId: string; role: string }>;
  evidence: DemoEvidenceSnapshot[];
  associations: DemoAssociationSnapshot[];
  document: {
    id: string;
    teamId: string;
    name: string;
    visibility: string;
    sourceRawEventId: string | null;
    currentVersionId: string | null;
    versionId: string | null;
    versionDocumentId: string | null;
    versionSourceEventId: string | null;
    chunkId: string | null;
    chunkDocumentId: string | null;
    chunkVersionId: string | null;
    chunkText: string | null;
  } | null;
  meeting: {
    id: string;
    teamId: string;
    status: string;
    defaultVisibility: string;
    startedAt: string | null;
    endedAt: string | null;
    chunkId: string | null;
    chunkMeetingId: string | null;
    chunkRawEventId: string | null;
    chunkText: string | null;
  } | null;
}

export function assertDemoFixture(snapshot: DemoFixtureSnapshot): void {
  const errors: string[] = [];
  const fail = (message: string): void => {
    errors.push(message);
  };
  const expectValue = (label: string, actual: unknown, expected: unknown): void => {
    if (!sameValue(actual, expected))
      fail(`${label}: expected ${show(expected)}, got ${show(actual)}`);
  };

  expectValue('workspace id', snapshot.workspace?.id, DEMO_IDS.team);
  expectValue('workspace slug', snapshot.workspace?.slug, 'acme-labs');
  expectValue('workspace name', snapshot.workspace?.name, 'Acme Labs');

  expectValue('Linear integration id', snapshot.integration?.id, DEMO_IDS.linearIntegration);
  expectValue('Linear integration team', snapshot.integration?.teamId, DEMO_IDS.team);
  expectValue('Linear integration provider', snapshot.integration?.provider, 'linear');
  expectValue('Linear integration enabled state', snapshot.integration?.enabled, false);
  expectValue('Linear selection id', snapshot.integration?.selectionId, DEMO_IDS.linearSelection);
  expectValue(
    'Linear selection integration id',
    snapshot.integration?.selectionIntegrationId,
    DEMO_IDS.linearIntegration,
  );
  expectValue('Linear selection external id', snapshot.integration?.selectionExternalId, 'LIN-TL');

  expectIds(
    errors,
    'demo raw events',
    snapshot.events.map((row) => row.id),
    DEMO_EVENTS.map((row) => row.id),
  );
  for (const expected of DEMO_EVENTS) {
    const row = snapshot.events.find((candidate) => candidate.id === expected.id);
    if (!row) continue;
    expectValue(`${expected.id} team`, row.teamId, DEMO_IDS.team);
    expectValue(`${expected.id} source`, row.source, expected.source);
    expectValue(`${expected.id} content`, row.contentText, expected.contentText);
    expectValue(`${expected.id} occurred_at`, row.occurredAt, expected.occurredAt);
    expectTeamVisibility(errors, `raw event ${expected.id}`, row);
    expectValue(
      `${expected.id} fixture version`,
      row.sourceMetadata.fixture_version,
      DEMO_FIXTURE_VERSION,
    );
    expectValue(
      `${expected.id} source payload ref`,
      row.sourceMetadata.source_payload_ref,
      expected.sourcePayloadRef,
    );
  }
  const noteMetadata = snapshot.events.find((row) => row.id === DEMO_IDS.eventNote)?.sourceMetadata;
  expectValue('explicit note capture kind', noteMetadata?.capture_kind, 'explicit_chat_note');
  expectValue('explicit note command', noteMetadata?.command, '/timeline note');
  const emailMetadata = snapshot.events.find(
    (row) => row.id === DEMO_IDS.eventEmail,
  )?.sourceMetadata;
  expectValue(
    'email message id',
    emailMetadata?.message_id,
    'demo-seed-northstar-export-commitment-001',
  );
  const meetingMetadata = snapshot.events.find(
    (row) => row.id === DEMO_IDS.eventMeeting,
  )?.sourceMetadata;
  expectValue('meeting raw-event link', meetingMetadata?.meeting_id, DEMO_IDS.meeting);
  const providerMetadata = snapshot.events.find(
    (row) => row.id === DEMO_IDS.eventProvider,
  )?.sourceMetadata;
  expectValue('provider name', providerMetadata?.provider, 'linear');
  expectValue(
    'provider integration link',
    providerMetadata?.integration_id,
    DEMO_IDS.linearIntegration,
  );
  expectValue('provider selection link', providerMetadata?.selection_external_id, 'LIN-TL');
  expectValue('provider object id', providerMetadata?.external_object_id, 'NORTH-42');
  for (let index = 1; index < DEMO_EVENTS.length; index += 1) {
    const previous = snapshot.events.find((row) => row.id === DEMO_EVENTS[index - 1]?.id);
    const current = snapshot.events.find((row) => row.id === DEMO_EVENTS[index]?.id);
    if (previous && current && previous.occurredAt >= current.occurredAt) {
      fail(`source chronology is not strictly increasing at ${current.id}`);
    }
  }

  expectIds(
    errors,
    'demo entities',
    snapshot.entities.map((row) => row.id),
    DEMO_ENTITIES.map((row) => row.id),
  );
  const noteEvidence = snapshot.evidence.find((row) => row.id === DEMO_IDS.evidenceNote);
  expectValue('explicit note evidence raw event', noteEvidence?.rawEventId, DEMO_IDS.eventNote);
  expectValue('explicit note evidence source', noteEvidence?.source, 'slack');
  expectValue(
    'explicit note evidence source payload ref',
    noteEvidence?.sourcePayloadRef,
    DEMO_SOURCE_REFS.note,
  );
  expectValue('explicit note evidence visibility', noteEvidence?.visibility, 'team');
  const noteAssociation = snapshot.associations.find((row) => row.id === DEMO_IDS.associationNote);
  expectValue(
    'explicit note association cluster',
    noteAssociation?.clusterId,
    DEMO_IDS.clusterPilot,
  );
  expectValue(
    'explicit note association evidence',
    noteAssociation?.evidenceId,
    DEMO_IDS.evidenceNote,
  );
  expectValue(
    'explicit note association raw event',
    noteAssociation?.rawEventId,
    DEMO_IDS.eventNote,
  );
  expectValue('explicit note association role', noteAssociation?.role, 'discussion');
  if (!hasSourceRef(noteAssociation?.sourceRefs, DEMO_IDS.eventNote, DEMO_IDS.evidenceNote)) {
    fail('explicit note association source_refs do not cite its raw event and evidence');
  }
  for (const expected of DEMO_ENTITIES) {
    const row = snapshot.entities.find((candidate) => candidate.id === expected.id);
    if (!row) continue;
    expectValue(`${expected.id} team`, row.teamId, DEMO_IDS.team);
    expectValue(`${expected.id} type`, row.type, expected.type);
    expectValue(`${expected.id} name`, row.canonicalName, expected.canonicalName);
    expectValue(`${expected.id} status`, row.status, expected.status);
    expectValue(`${expected.id} stage`, row.stage, expected.stage);
    expectValue(`${expected.id} owner`, row.ownerUserId, expected.ownerUserId);
    expectValue(`${expected.id} assignee`, row.assigneeUserId, expected.assigneeUserId);
  }
  const expectedClusters = [
    { id: DEMO_IDS.clusterPilot, entityId: DEMO_IDS.objectPilot },
    { id: DEMO_IDS.clusterDelivery, entityId: DEMO_IDS.objectDelivery },
    { id: DEMO_IDS.clusterDecision, entityId: DEMO_IDS.objectDecision },
  ];
  expectIds(
    errors,
    'demo artifact clusters',
    snapshot.clusters.map((row) => row.id),
    expectedClusters.map((row) => row.id),
  );
  for (const expected of expectedClusters) {
    const cluster = snapshot.clusters.find((row) => row.id === expected.id);
    expectValue(`${expected.id} team`, cluster?.teamId, DEMO_IDS.team);
    expectValue(`${expected.id} canonical entity`, cluster?.canonicalEntityId, expected.entityId);
  }

  expectIds(
    errors,
    'demo facts',
    snapshot.facts.map((row) => row.id),
    DEMO_SUPPORT.map((support) => support.factId),
  );
  expectIds(
    errors,
    'demo evidence',
    snapshot.evidence.map((row) => row.id),
    [
      DEMO_IDS.evidenceNote,
      DEMO_IDS.evidenceEmail,
      DEMO_IDS.evidenceMeeting,
      DEMO_IDS.evidenceProvider,
    ],
  );
  expectIds(
    errors,
    'demo evidence associations',
    snapshot.associations.map((row) => row.id),
    [DEMO_IDS.associationNote, ...DEMO_SUPPORT.map((support) => support.associationId)],
  );

  for (const support of DEMO_SUPPORT) {
    const fact = snapshot.facts.find((row) => row.id === support.factId);
    expectValue(`${support.label} fact team`, fact?.teamId, DEMO_IDS.team);
    expectValue(`${support.label} fact event`, fact?.rawEventId, support.eventId);
    expectValue(`${support.label} fact statement`, fact?.statement, support.statement);
    expectValue(`${support.label} fact model`, fact?.modelVersion, DEMO_FIXTURE_VERSION);

    const factLink = snapshot.factLinks.find(
      (row) => row.factId === support.factId && row.entityId === support.entityId,
    );
    expectValue(`${support.label} fact entity role`, factLink?.role, 'subject');

    const evidence = snapshot.evidence.find((row) => row.id === support.evidenceId);
    const event = DEMO_EVENTS.find((row) => row.id === support.eventId);
    expectValue(`${support.label} evidence team`, evidence?.teamId, DEMO_IDS.team);
    expectValue(`${support.label} evidence raw event`, evidence?.rawEventId, support.eventId);
    expectValue(`${support.label} evidence source`, evidence?.source, event?.source);
    expectValue(
      `${support.label} evidence source payload ref`,
      evidence?.sourcePayloadRef,
      event?.sourcePayloadRef,
    );
    expectValue(`${support.label} evidence occurred_at`, evidence?.occurredAt, event?.occurredAt);
    expectValue(`${support.label} evidence visibility`, evidence?.visibility, 'team');

    const association = snapshot.associations.find((row) => row.id === support.associationId);
    expectValue(`${support.label} association team`, association?.teamId, DEMO_IDS.team);
    expectValue(`${support.label} association cluster`, association?.clusterId, support.clusterId);
    expectValue(
      `${support.label} association evidence`,
      association?.evidenceId,
      support.evidenceId,
    );
    expectValue(`${support.label} association raw event`, association?.rawEventId, support.eventId);
    expectValue(`${support.label} association role`, association?.role, support.associationRole);
    expectValue(`${support.label} association visibility`, association?.visibility, 'team');
    expectValue(
      `${support.label} association visibility floor`,
      association?.visibilityFloor,
      'team',
    );
    if (!hasSourceRef(association?.sourceRefs, support.eventId, support.evidenceId)) {
      fail(`${support.label} association source_refs do not cite its raw event and evidence`);
    }
  }

  expectValue('document id', snapshot.document?.id, DEMO_IDS.document);
  expectValue('document team', snapshot.document?.teamId, DEMO_IDS.team);
  expectValue('document name', snapshot.document?.name, 'Northstar pilot handoff brief.txt');
  expectValue('document visibility', snapshot.document?.visibility, 'team');
  expectValue(
    'document raw-event source',
    snapshot.document?.sourceRawEventId,
    DEMO_IDS.eventEmail,
  );
  expectValue(
    'document current version',
    snapshot.document?.currentVersionId,
    DEMO_IDS.documentVersion,
  );
  expectValue('document version id', snapshot.document?.versionId, DEMO_IDS.documentVersion);
  expectValue(
    'document version document link',
    snapshot.document?.versionDocumentId,
    DEMO_IDS.document,
  );
  expectValue(
    'document version source event',
    snapshot.document?.versionSourceEventId,
    DEMO_IDS.eventEmail,
  );
  expectValue('document chunk id', snapshot.document?.chunkId, DEMO_IDS.documentChunk);
  expectValue(
    'document chunk document link',
    snapshot.document?.chunkDocumentId,
    DEMO_IDS.document,
  );
  expectValue(
    'document chunk version link',
    snapshot.document?.chunkVersionId,
    DEMO_IDS.documentVersion,
  );
  expectValue(
    'document chunk text',
    snapshot.document?.chunkText,
    'Northstar pilot handoff: Avery transfers export validation to Mika. Customer launch review is July 15. CSV fallback is approved; field-mapping confirmation is still required.',
  );

  expectValue('meeting id', snapshot.meeting?.id, DEMO_IDS.meeting);
  expectValue('meeting team', snapshot.meeting?.teamId, DEMO_IDS.team);
  expectValue('meeting status', snapshot.meeting?.status, 'completed');
  expectValue('meeting visibility', snapshot.meeting?.defaultVisibility, 'team');
  expectValue('meeting started_at', snapshot.meeting?.startedAt, DEMO_TIMES.meeting);
  expectValue('meeting ended_at', snapshot.meeting?.endedAt, '2026-07-08T15:30:00.000Z');
  expectValue('meeting chunk id', snapshot.meeting?.chunkId, DEMO_IDS.meetingChunk);
  expectValue('meeting chunk meeting link', snapshot.meeting?.chunkMeetingId, DEMO_IDS.meeting);
  expectValue('meeting chunk raw event', snapshot.meeting?.chunkRawEventId, DEMO_IDS.eventMeeting);
  expectValue(
    'meeting chunk text',
    snapshot.meeting?.chunkText,
    'Avery: I am handing export validation to Mika. Mika: I own it. We will use the CSV fallback, but field-mapping confirmation is still blocking completion.',
  );

  if (errors.length > 0) {
    throw new Error(`Demo fixture verification failed:\n- ${errors.join('\n- ')}`);
  }
}

function expectIds(
  errors: string[],
  label: string,
  actual: string[],
  expected: readonly string[],
): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (!sameValue(actualSorted, expectedSorted)) {
    errors.push(`${label}: expected ids ${show(expectedSorted)}, got ${show(actualSorted)}`);
  }
}

function expectTeamVisibility(
  errors: string[],
  label: string,
  row: Pick<DemoEventSnapshot, 'visibility' | 'visibilityOwnerUserId' | 'visibilityUserIds'>,
): void {
  if (
    row.visibility !== 'team' ||
    row.visibilityOwnerUserId !== null ||
    row.visibilityUserIds !== null
  ) {
    errors.push(`${label} must be team-visible without private/specific-user ownership`);
  }
}

function hasSourceRef(value: unknown, rawEventId: string, evidenceId: string): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const ref = item as Record<string, unknown>;
      return ref.rawEventId === rawEventId && ref.evidenceId === evidenceId;
    })
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

type DemoEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    'ALLOW_DEV_SEED' | 'AUTH_SECRET' | 'DATABASE_URL' | 'NODE_ENV' | 'SECRETS_ENCRYPTION_KEY'
  >
>;

export function assertDemoSeedEnvironment(env: DemoEnvironment = process.env): void {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!env.AUTH_SECRET) throw new Error('AUTH_SECRET is required');
  if (!env.SECRETS_ENCRYPTION_KEY) {
    throw new Error('SECRETS_ENCRYPTION_KEY is required to seed fake integration credentials');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to run demo seed or verification with NODE_ENV=production');
  }

  const host = new URL(databaseUrl).hostname.toLowerCase();
  const isLocalDatabase = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocalDatabase && env.ALLOW_DEV_SEED !== LOCAL_DEV_SEED_OVERRIDE) {
    throw new Error(
      `Refusing to use non-local database host "${host}". Set ALLOW_DEV_SEED=${LOCAL_DEV_SEED_OVERRIDE} only if this is an isolated development database.`,
    );
  }
}
