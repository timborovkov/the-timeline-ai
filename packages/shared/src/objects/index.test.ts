import {
  type Db,
  agentSuggestionItems,
  agentSuggestions,
  artifactClusterMembers,
  artifactClusters,
  artifactEvidenceAssociations,
  boardItemChanges,
  boardItems,
  calendarEventEntities,
  calendarEvents,
  documents,
  documentVersions,
  chatMessages,
  chatSessions,
  entities,
  entityRelationships,
  factEntities,
  facts,
  objectChanges,
  objectIdentityFacets,
  objectNotes,
  objectSummaries,
  notifications,
  rawEvents,
  reconciliationEvidence,
  reconciliationEvidenceAnchors,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStructuredInput, ChatStructuredResult } from '#src/llm/chat.js';
import type { PGlite } from '@electric-sql/pglite';
import type { z } from 'zod';

import { buildObjectDirectWriteSourceContext } from '#src/objects/index.js';
import {
  generateAndStoreObjectSummary,
  invalidateObjectSummariesForRawEvent,
} from '#src/objects/summaries.js';
import { encodeCursor } from '#src/pagination.js';
import * as queue from '#src/queue/queues.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

/**
 * Real-DB integration tests for workspace objects. This module owns a large
 * part of the product contract: object CRUD, audit rows, notes, suggestions,
 * notifications, chat sessions, and team/user isolation. These tests exercise
 * persisted behavior through `withTeam(...).objects`, not private helpers.
 */

const qdrantFakes = vi.hoisted(() => ({
  deletePoints: vi.fn().mockResolvedValue(undefined),
  deletePointsForSource: vi.fn().mockResolvedValue(undefined),
  getQdrantClient: vi.fn(),
}));

vi.mock('#src/queue/queues.js', () => ({
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueEntityEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectNoteEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectChangeEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueCalendarEventEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-job' }),
}));
vi.mock('#src/qdrant/client.js', () => ({
  getQdrantClient: qdrantFakes.getQdrantClient,
}));

type AnyDb = Db;

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_MEMBER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_OTHER_TEAM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let pg: PGlite;
let db: AnyDb;
let testDb: ResettablePGliteTestDb;

async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function seedWorkspace(target: PGlite): Promise<void> {
  await target.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_A}', 'team-a', 'Team A'),
      ('${TEAM_B}', 'team-b', 'Team B');

    INSERT INTO users (id, email)
    VALUES
      ('${USER_OWNER}', 'owner@test.local'),
      ('${USER_MEMBER}', 'member@test.local'),
      ('${USER_OTHER_TEAM}', 'other@test.local');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${USER_OWNER}', 'owner'),
      ('${TEAM_A}', '${USER_MEMBER}', 'member'),
      ('${TEAM_B}', '${USER_OTHER_TEAM}', 'owner');
  `);
}

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(seedWorkspace);
  pg = testDb.pg;
  db = drizzle(pg) as unknown as AnyDb;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  qdrantFakes.getQdrantClient.mockReturnValue({
    deletePoints: qdrantFakes.deletePoints,
    deletePointsForSource: qdrantFakes.deletePointsForSource,
  });
  await testDb.reset();
});

afterEach(async () => {
  await flushBackgroundWork();
});

afterAll(async () => {
  await testDb.close();
});

async function upsertObjectSummary(values: typeof objectSummaries.$inferInsert): Promise<void> {
  await db
    .insert(objectSummaries)
    .values(values)
    .onConflictDoUpdate({
      target: [objectSummaries.teamId, objectSummaries.entityId],
      set: values,
    });
}

async function withHistoricalLegacyObjectProvenance<T>(fn: () => Promise<T>): Promise<T> {
  await pg.exec(`
    ALTER TABLE entities DISABLE TRIGGER entities_legacy_provenance_write_guard;
    ALTER TABLE object_changes DROP CONSTRAINT object_changes_legacy_source_event_id_null_chk;
  `);
  try {
    return await fn();
  } finally {
    await pg.exec(`
      ALTER TABLE entities ENABLE TRIGGER entities_legacy_provenance_write_guard;
      ALTER TABLE object_changes ADD CONSTRAINT object_changes_legacy_source_event_id_null_chk CHECK (source_event_id IS NULL) NOT VALID;
    `);
  }
}

describe('object scope — team ownership and audit behavior', () => {
  it('builds direct-write source context from private evidence visibility', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Private Sentry incident context',
        occurredAt: new Date('2026-07-01T10:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_OWNER,
        sourceMetadata: {
          provider: 'sentry',
          source_payload_ref: 'sentry://incident/raw-1',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('expected raw event');

    const [evidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_A,
        rawEventId: raw.id,
        sourcePayloadRef: 'sentry://incident/evidence-1',
        source: 'integration',
        provider: 'sentry',
        externalObjectId: 'INC-1',
        externalEventId: 'INC-1:update',
        eventType: 'sentry.issue',
        occurredAt: new Date('2026-07-01T10:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_OWNER,
        actor: {},
        contentDigest: 'sentry-private-digest',
        normalizerVersion: 'test-normalizer',
        replayState: 'full',
        dedupeKey: 'sentry-private-dedupe',
      })
      .returning({ id: reconciliationEvidence.id });
    if (!evidence) throw new Error('expected evidence');

    const firstContext = await buildObjectDirectWriteSourceContext({
      db,
      teamId: TEAM_A,
      sourceRawEventId: raw.id,
    });
    expect(firstContext).toEqual({
      sourceRefs: [
        {
          source: 'integration',
          rawEventId: raw.id,
          sourcePayloadRef: 'sentry://incident/raw-1',
        },
      ],
      sourcePayloadRefs: ['sentry://incident/evidence-1', 'sentry://incident/raw-1'],
      visibility: 'private',
      visibilityOwnerUserId: USER_OWNER,
      visibilityUserIds: null,
    });
    expect(firstContext.sourceRefs[0]).not.toHaveProperty('evidenceId');

    await db.insert(reconciliationEvidence).values({
      teamId: TEAM_A,
      rawEventId: raw.id,
      sourcePayloadRef: 'sentry://incident/evidence-2',
      source: 'integration',
      provider: 'sentry',
      externalObjectId: 'INC-1',
      externalEventId: 'INC-1:update:v2',
      eventType: 'sentry.issue',
      occurredAt: new Date('2026-07-01T10:00:00.000Z'),
      visibility: 'private',
      visibilityOwnerUserId: USER_OWNER,
      actor: {},
      contentDigest: 'sentry-private-digest-v2',
      normalizerVersion: 'test-normalizer-v2',
      replayState: 'full',
      dedupeKey: 'sentry-private-dedupe-v2',
    });

    const secondContext = await buildObjectDirectWriteSourceContext({
      db,
      teamId: TEAM_A,
      sourceRawEventId: raw.id,
    });
    expect(secondContext.sourceRefs).toEqual(firstContext.sourceRefs);
    expect(secondContext.sourceRefs[0]).not.toHaveProperty('evidenceId');
  });

  it('falls back to raw-event visibility when direct-write evidence is absent', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Monday item assigned to selected users',
        occurredAt: new Date('2026-07-01T10:05:00.000Z'),
        visibility: 'specific_users',
        visibilityUserIds: [USER_OWNER, USER_MEMBER],
        sourceMetadata: {
          provider: 'monday',
          sourcePayloadRef: 'monday://board/42/item/7',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('expected raw event');

    await expect(
      buildObjectDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: raw.id,
      }),
    ).resolves.toEqual({
      sourceRefs: [
        {
          source: 'integration',
          rawEventId: raw.id,
          sourcePayloadRef: 'monday://board/42/item/7',
        },
      ],
      sourcePayloadRefs: ['monday://board/42/item/7'],
      visibility: 'specific_users',
      visibilityOwnerUserId: null,
      visibilityUserIds: [USER_OWNER, USER_MEMBER],
    });
  });

  it('rejects direct-write source refs that are missing from the scoped team', async () => {
    const [otherTeamRaw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_B,
        authorUserId: USER_OTHER_TEAM,
        source: 'integration',
        contentText: 'Other team source event',
        occurredAt: new Date('2026-07-01T10:10:00.000Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'sentry',
          source_payload_ref: 'sentry://other-team/incident',
        },
      })
      .returning({ id: rawEvents.id });
    if (!otherTeamRaw) throw new Error('expected raw event');

    await expect(
      buildObjectDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: otherTeamRaw.id,
      }),
    ).rejects.toThrow('Source raw event not found for team');

    await expect(
      buildObjectDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toThrow('Source raw event not found for team');
  });

  it('rejects direct-write source refs without a replay payload ref', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Legacy source event without replay metadata',
        occurredAt: new Date('2026-07-01T10:20:00.000Z'),
        visibility: 'team',
        sourceMetadata: { provider: 'legacy' },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('expected raw event');

    await expect(
      buildObjectDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: raw.id,
      }),
    ).rejects.toThrow('Source raw event is missing a replay payload ref');
  });

  it('rejects owner and assignee values that are not members of the scoped team', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;

    await expect(
      scope.createObject({
        type: 'task',
        canonicalName: 'Leaky assignment',
        ownerUserId: USER_OTHER_TEAM,
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).rejects.toThrow('Referenced user is not a member of this team');

    const object = await scope.createObject({
      type: 'task',
      canonicalName: 'Scoped assignment',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await expect(
      scope.updateObject(
        object.id,
        { assigneeUserId: USER_OTHER_TEAM },
        { kind: 'user', userId: USER_OWNER },
      ),
    ).rejects.toThrow('Referenced user is not a member of this team');
  });

  it('creates agent actor objects without canonical legacy provenance fields', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const object = await scope.createObject({
      type: 'task',
      canonicalName: 'Follow up on approved chat command',
      actor: { kind: 'agent', userId: USER_OWNER },
    });

    expect(object.status).toBe('open');
    expect(object.agentSuggested).toBe(false);

    const [entityRow] = await db
      .select({ sourceEventId: entities.sourceEventId })
      .from(entities)
      .where(eq(entities.id, object.id));
    expect(entityRow?.sourceEventId).toBeNull();

    const rows = await db.select().from(objectChanges).where(eq(objectChanges.entityId, object.id));

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'applied',
        sourceEventId: null,
      }),
    ]);

    const outputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, object.id));
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      outputKind: 'direct_write',
      targetKind: 'object',
      operation: 'create',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
    });
    const createSourceRefs = outputs[0]?.sourceRefs as
      | { source?: string; rawEventId?: string; sourcePayloadRef?: string | null }[]
      | undefined;
    const createSourceRef = createSourceRefs?.[0];
    expect(createSourceRef?.source).toBe('system');
    expect(typeof createSourceRef?.rawEventId).toBe('string');
    expect(createSourceRef?.sourcePayloadRef).toMatch(
      /^inline:\/\/timeline\/system\/object_create\//,
    );
    expect(outputs[0]?.sourcePayloadRefs).toEqual([
      expect.stringMatching(/^inline:\/\/timeline\/system\/object_create\//),
    ]);
    expect(outputs[0]?.payload).toMatchObject({
      source: 'system',
      system_event_kind: 'object_create',
      object_type: 'task',
      canonical_name: 'Follow up on approved chat command',
      actor_kind: 'agent',
      actor_user_id: USER_OWNER,
    });
    expect(outputs[0]?.authorityDecision).toMatchObject({
      decision: 'direct_write',
      authority_decision: 'direct',
      source: 'system',
      target_kind: 'object',
      target_field: '__create__',
    });

    const output = outputs[0];
    if (!output) throw new Error('Expected object create reconciliation output');
    const runs = await db
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.id, output.runId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: 'raw_event',
      scope: 'object_direct_write',
      status: 'completed',
    });
  });

  it('does not expose legacy agentSuggested flags on object read models', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'task',
      canonicalName: 'Legacy suggested canonical row',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await withHistoricalLegacyObjectProvenance(async () => {
      await db
        .update(entities)
        .set({ agentSuggested: true, status: 'suggested' })
        .where(eq(entities.id, object.id));
    });

    await expect(scope.getObject(object.id)).resolves.toMatchObject({
      id: object.id,
      status: 'suggested',
      agentSuggested: false,
    });
    await expect(scope.listObjects({ id: object.id })).resolves.toEqual([
      expect.objectContaining({
        id: object.id,
        status: 'suggested',
        agentSuggested: false,
      }),
    ]);
  });

  it('writes one timeline event and one object change for a real update, but none for a no-op', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'task',
      canonicalName: 'Prepare launch review',
      status: 'todo',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const noOp = await scope.updateObject(
      object.id,
      { metadata: {}, status: 'todo' },
      { kind: 'user', userId: USER_OWNER },
    );
    expect(noOp.changedFields).toEqual([]);
    const outputsAfterNoOp = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, object.id));
    expect(outputsAfterNoOp).toHaveLength(1);
    expect(outputsAfterNoOp[0]?.operation).toBe('create');

    const update = await scope.updateObject(
      object.id,
      { status: 'done' },
      { kind: 'user', userId: USER_OWNER },
    );
    expect(update.changedFields).toEqual(['status']);

    const events = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.teamId, TEAM_A))
      .orderBy(rawEvents.createdAt);
    const eventKinds = events.map(
      (event) => (event.sourceMetadata as { kind?: string } | null)?.kind,
    );
    expect(eventKinds.filter((kind) => kind === 'object_create')).toHaveLength(1);
    expect(eventKinds.filter((kind) => kind === 'object_update')).toHaveLength(1);
    const updateEvent = events.find(
      (event) => (event.sourceMetadata as { kind?: string } | null)?.kind === 'object_update',
    );
    expect(updateEvent?.id).toEqual(expect.any(String));

    const evidence = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        inArray(
          reconciliationEvidence.rawEventId,
          events.map((event) => event.id),
        ),
      )
      .orderBy(reconciliationEvidence.eventType);
    expect(evidence).toEqual([
      expect.objectContaining({
        source: 'system',
        provider: 'system',
        externalObjectId: object.id,
        eventType: 'system.object_create',
        replayState: 'full',
      }),
      expect.objectContaining({
        source: 'system',
        provider: 'system',
        externalObjectId: object.id,
        eventType: 'system.object_update',
        replayState: 'full',
      }),
    ]);
    expect(evidence[0]?.sourcePayloadRef).toMatch(/^inline:\/\/timeline\/system\/object_create\//);
    expect(evidence[1]?.sourcePayloadRef).toMatch(/^inline:\/\/timeline\/system\/object_update\//);
    expect(evidence[0]?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(evidence[1]?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    const updateMetadata = updateEvent?.sourceMetadata as Record<string, unknown> | undefined;
    expect(updateMetadata?.payload_digest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(updateMetadata).toMatchObject({
      source_snapshot_kind: 'system_direct_write_event',
      source_snapshot_version: 'system-direct-write-source-snapshot-2026-06',
      changed_fields: ['status'],
      source_snapshot: {
        event_kind: 'object_update',
        entity_id: object.id,
        changes: [
          expect.objectContaining({
            field: 'status',
            previousValue: 'todo',
            newValue: 'done',
          }),
        ],
      },
    });

    const anchors = await db
      .select()
      .from(reconciliationEvidenceAnchors)
      .where(
        inArray(
          reconciliationEvidenceAnchors.evidenceId,
          evidence.map((row) => row.id),
        ),
      );
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'object',
          anchorValue: object.id,
        }),
        expect.objectContaining({
          anchorType: 'source_object:system',
          anchorValue: object.id,
        }),
      ]),
    );

    const changes = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, object.id));
    expect(changes.map((change) => change.field).sort()).toEqual(['__create__', 'status']);

    const directWriteOutputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, object.id));
    expect(directWriteOutputs.map((output) => output.operation).sort()).toEqual([
      'create',
      'update',
    ]);
    const updateOutput = directWriteOutputs.find((output) => output.operation === 'update');
    expect(updateOutput).toMatchObject({
      outputKind: 'direct_write',
      targetKind: 'object',
      operation: 'update',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
    });
    expect(updateOutput?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'system',
        rawEventId: updateEvent?.id,
      }),
    ]);
    expect(updateOutput?.payload).toMatchObject({
      source: 'system',
      system_event_kind: 'object_update',
      object_type: 'task',
      canonical_name: 'Prepare launch review',
      actor_kind: 'user',
      actor_user_id: USER_OWNER,
      changed_fields: ['status'],
      changes: [
        expect.objectContaining({
          field: 'status',
          previousValue: 'todo',
          newValue: 'done',
        }),
      ],
    });
    expect(updateOutput?.authorityDecision).toMatchObject({
      decision: 'direct_write',
      authority_decision: 'direct',
      source: 'system',
      target_kind: 'object',
      target_field: '__update__',
      changed_fields: ['status'],
    });
  });

  it('notifies the responsible user and mirrors task due dates to the team calendar', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const dueAt = new Date('2026-07-02T15:00:00.000Z');

    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Send renewal brief',
      assigneeUserId: USER_MEMBER,
      dueAt,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(inboxRows).toEqual([
      expect.objectContaining({
        userId: USER_MEMBER,
        kind: 'task_due',
        summary: 'Send renewal brief is due 2026-07-02',
      }),
    ]);

    let eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows).toEqual([
      expect.objectContaining({
        title: 'Due: Send renewal brief - member@test.local',
        startAt: dueAt,
        showAs: 'free',
        visibility: 'team',
      }),
    ]);
    expect(eventRows[0]?.metadata).toEqual(
      expect.objectContaining({ kind: 'due_date', source: 'object', entity_id: task.id }),
    );
    expect(eventRows[0]?.scheduledRawEventId).toEqual(expect.any(String));
    expect(eventRows[0]?.startAtRawEventId).toEqual(expect.any(String));

    const rawIds = [eventRows[0]?.scheduledRawEventId, eventRows[0]?.startAtRawEventId].filter(
      (id): id is string => id !== null && id !== undefined,
    );
    await scope.updateObject(task.id, { dueAt: null }, { kind: 'user', userId: USER_OWNER });
    eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows[0]?.deletedAt).toBeInstanceOf(Date);
    const afterClearInboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(afterClearInboxRows.find((row) => row.kind === 'task_due')?.readAt).toBeInstanceOf(Date);
    const rawRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_A));
    expect(
      rawRows
        .filter((row) => rawIds.includes(row.id))
        .every((row) => (row.sourceMetadata as { deleted?: boolean }).deleted === true),
    ).toBe(true);
  });

  it('mirrors task due dates without responsible-person inbox notifications', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const dueAt = new Date('2026-07-10T09:00:00.000Z');

    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Unassigned renewal checklist',
      dueAt,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(inboxRows).toEqual([]);

    const eventRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows).toEqual([
      expect.objectContaining({
        title: 'Due: Unassigned renewal checklist',
        startAt: dueAt,
        showAs: 'free',
        visibility: 'team',
      }),
    ]);
  });

  it('filters object lists by text, people, priority, and due windows', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const dueAt = new Date('2026-08-05T09:00:00.000Z');
    const matching = await scope.createObject({
      type: 'task',
      canonicalName: 'Prepare audit pilot',
      status: 'todo',
      priority: 1,
      assigneeUserId: USER_MEMBER,
      dueAt,
      metadata: { customer_region: 'Nordics' },
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await scope.createObject({
      type: 'task',
      canonicalName: 'Prepare sales pilot',
      status: 'todo',
      priority: 2,
      assigneeUserId: USER_OWNER,
      dueAt: null,
      metadata: { customer_region: 'Benelux' },
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await db
      .update(entities)
      .set({
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-20T00:00:00.000Z'),
      })
      .where(eq(entities.id, matching.id));

    await expect(
      scope.listObjects({
        id: matching.id,
        type: 'task',
        query: 'nordics',
        priority: 1,
        assigneeUserId: USER_MEMBER,
        dueAfter: new Date('2026-08-01T00:00:00.000Z'),
        dueBefore: new Date('2026-08-06T00:00:00.000Z'),
        createdAfter: new Date('2026-07-01T00:00:00.000Z'),
        createdBefore: new Date('2026-07-31T00:00:00.000Z'),
        updatedAfter: new Date('2026-07-15T00:00:00.000Z'),
        updatedBefore: new Date('2026-07-25T00:00:00.000Z'),
      }),
    ).resolves.toEqual([expect.objectContaining({ id: matching.id })]);

    await expect(
      scope.listObjects({
        id: '00000000-0000-4000-8000-000000000000',
        type: 'task',
        query: 'nordics',
        priority: 1,
        assigneeUserId: USER_MEMBER,
      }),
    ).resolves.toEqual([]);

    await expect(
      scope.listObjects({
        id: 'not-a-uuid',
        type: 'task',
        query: 'nordics',
      }),
    ).resolves.toEqual([]);
    await expect(
      scope.countObjects({
        id: 'not-a-uuid',
        type: 'task',
        query: 'nordics',
      }),
    ).resolves.toBe(0);
    await expect(
      scope.listObjects({
        id: ['not-a-uuid', matching.id],
        type: 'task',
        query: 'nordics',
      }),
    ).resolves.toEqual([expect.objectContaining({ id: matching.id })]);

    await expect(
      scope.listObjects({
        type: 'task',
        priorityNull: true,
        dueNull: true,
      }),
    ).resolves.toEqual([]);
  });

  it('does not mirror legacy suggested task due dates before human acceptance', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Review agent-suggested deadline',
      assigneeUserId: USER_MEMBER,
      dueAt: new Date('2026-07-11T09:00:00.000Z'),
      status: 'suggested',
      actor: { kind: 'agent', userId: null },
    });
    const [legacySuggestion] = await db
      .insert(objectChanges)
      .values({
        teamId: TEAM_A,
        entityId: task.id,
        actorKind: 'agent',
        status: 'suggested',
        field: '__create__',
        previousValue: null,
        newValue: { type: 'task', canonicalName: task.canonicalName, status: 'suggested' },
      })
      .returning({ id: objectChanges.id });

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(inboxRows).toEqual([]);
    expect(inboxRows.some((row) => row.kind === 'task_due')).toBe(false);
    await expect(
      db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A)),
    ).resolves.toEqual([]);

    await expect(
      scope.acceptObjectChange(legacySuggestion?.id ?? '', { kind: 'user', userId: USER_OWNER }),
    ).resolves.toBe(true);

    const acceptedInboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(acceptedInboxRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: USER_MEMBER,
          kind: 'task_due',
          summary: 'Review agent-suggested deadline is due 2026-07-11',
        }),
      ]),
    );
    await expect(
      db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A)),
    ).resolves.toEqual([
      expect.objectContaining({
        title: 'Due: Review agent-suggested deadline - member@test.local',
      }),
    ]);
  });

  it('restores due inbox notifications when an archived task is unarchived', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Restart archived launch task',
      assigneeUserId: USER_MEMBER,
      dueAt: new Date('2026-07-13T09:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.archiveObject(task.id, { kind: 'user', userId: USER_OWNER });
    let inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(inboxRows.find((row) => row.kind === 'task_due')?.readAt).toBeInstanceOf(Date);

    await scope.unarchiveObject(task.id, { kind: 'user', userId: USER_OWNER });

    inboxRows = await db.select().from(notifications).where(eq(notifications.entityId, task.id));
    expect(inboxRows.filter((row) => row.kind === 'task_due' && row.readAt === null)).toEqual([
      expect.objectContaining({
        userId: USER_MEMBER,
        summary: 'Restart archived launch task is due 2026-07-13',
      }),
    ]);
    await expect(
      db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A)),
    ).resolves.toEqual([
      expect.objectContaining({
        deletedAt: null,
        title: 'Due: Restart archived launch task - member@test.local',
      }),
    ]);
  });

  it('notifies the owner when ownership changes on an unassigned due task', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Assign owner for launch note',
      dueAt: new Date('2026-07-12T09:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.updateObject(
      task.id,
      { ownerUserId: USER_MEMBER },
      { kind: 'user', userId: USER_OWNER },
    );

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(inboxRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: USER_MEMBER,
          kind: 'task_due',
          summary: 'Assign owner for launch note is due 2026-07-12',
        }),
      ]),
    );
    expect(inboxRows.filter((row) => row.kind === 'task_due')).toHaveLength(1);
    await expect(
      db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A)),
    ).resolves.toEqual([
      expect.objectContaining({
        title: 'Due: Assign owner for launch note - member@test.local',
      }),
    ]);

    await scope.updateObject(
      task.id,
      { ownerUserId: USER_OWNER },
      { kind: 'user', userId: USER_MEMBER },
    );

    const afterOwnerChangeRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(
      afterOwnerChangeRows.filter((row) => row.kind === 'task_due' && row.readAt === null),
    ).toEqual([
      expect.objectContaining({
        userId: USER_OWNER,
        summary: 'Assign owner for launch note is due 2026-07-12',
      }),
    ]);

    await scope.updateObject(task.id, { ownerUserId: null }, { kind: 'user', userId: USER_OWNER });

    const afterUnassignRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(
      afterUnassignRows.filter((row) => row.kind === 'task_due' && row.readAt === null),
    ).toEqual([]);
  });

  it('refreshes due inbox summaries when a due task is renamed', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Old launch name',
      assigneeUserId: USER_MEMBER,
      dueAt: new Date('2026-07-14T09:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const board = await scope.boards.createBoard({
      name: 'Rename board',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    await scope.boards.addBoardItem(board.id, {
      entityId: task.id,
      responsibleUserId: USER_MEMBER,
      dueAt: new Date('2026-07-15T09:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.objects.updateObject(
      task.id,
      { canonicalName: 'New launch name' },
      { kind: 'user', userId: USER_OWNER },
    );

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(
      inboxRows.find(
        (row) => row.kind === 'task_due' && row.summary === 'Old launch name is due 2026-07-14',
      )?.readAt,
    ).toBeInstanceOf(Date);
    expect(
      inboxRows.find(
        (row) => row.kind === 'board_item_due' && row.summary.includes('Old launch name'),
      )?.readAt,
    ).toBeInstanceOf(Date);
    expect(inboxRows.filter((row) => row.kind === 'task_due' && row.readAt === null)).toEqual([
      expect.objectContaining({
        summary: 'New launch name is due 2026-07-14',
      }),
    ]);
    expect(inboxRows.filter((row) => row.kind === 'board_item_due' && row.readAt === null)).toEqual(
      [
        expect.objectContaining({
          summary: 'New launch name on Rename board is due 2026-07-15',
        }),
      ],
    );
  });

  it('tombstones board item due-date calendar events when the object is archived', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Renewal pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Open', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Soft Archive LLC',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      responsibleUserId: USER_MEMBER,
      dueAt: new Date('2026-10-01T12:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    let eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    const calendarEventId = eventRows[0]?.id;
    expect(eventRows[0]?.deletedAt).toBeNull();

    await scope.objects.archiveObject(company.id, { kind: 'user', userId: USER_OWNER });

    eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows[0]?.deletedAt).toBeInstanceOf(Date);
    expect(qdrantFakes.deletePointsForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        scope: 'calendar_event',
        sourceId: calendarEventId,
      }),
    );
    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, company.id));
    expect(inboxRows.find((row) => row.kind === 'board_item_due')?.readAt).toBeInstanceOf(Date);

    await scope.objects.unarchiveObject(company.id, { kind: 'user', userId: USER_OWNER });

    const afterUnarchiveRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, company.id));
    expect(
      afterUnarchiveRows.filter((row) => row.kind === 'board_item_due' && row.readAt === null),
    ).toEqual([
      expect.objectContaining({
        userId: USER_MEMBER,
        summary: 'Soft Archive LLC on Renewal pipeline is due 2026-10-01',
      }),
    ]);
    eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows[0]).toEqual(
      expect.objectContaining({
        deletedAt: null,
        title: 'Due: Soft Archive LLC - member@test.local',
      }),
    );
  });
});

describe('object scope — identity facets', () => {
  it('emits direct-write outputs when identity facets are created and updated', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const person = await scope.createObject({
      type: 'person',
      canonicalName: 'Nora Acme',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const facet = await scope.createIdentityFacet({
      entityId: person.id,
      kind: 'email',
      value: 'Nora@Acme.com',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const updatedFacet = await scope.createIdentityFacet({
      entityId: person.id,
      kind: 'email',
      value: 'nora@acme.com',
      metadata: { verified: true },
      actor: { kind: 'agent', userId: USER_OWNER },
    });
    expect(updatedFacet.id).toBe(facet.id);

    const facetRows = await db
      .select()
      .from(objectIdentityFacets)
      .where(eq(objectIdentityFacets.id, facet.id));
    expect(facetRows[0]).toEqual(
      expect.objectContaining({
        entityId: person.id,
        kind: 'email',
        value: 'nora@acme.com',
        normalizedValue: 'nora@acme.com',
      }),
    );

    const changes = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, person.id));
    expect(changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(['__identity_facet_create__', '__identity_facet_update__']),
    );
    expect(
      changes
        .filter((change) =>
          ['__identity_facet_create__', '__identity_facet_update__'].includes(change.field),
        )
        .every((change) => change.sourceEventId === null),
    ).toBe(true);

    const outputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, facet.id));
    expect(outputs.map((output) => output.operation).sort()).toEqual(['create', 'update']);
    for (const output of outputs) {
      expect(output).toEqual(
        expect.objectContaining({
          outputKind: 'direct_write',
          targetKind: 'identity_facet',
          targetId: facet.id,
          status: 'applied',
          requiresApproval: false,
          visibility: 'team',
          visibilityFloor: 'team',
        }),
      );
      expect(Array.isArray(output.sourceRefs)).toBe(true);
      const [sourceRef] = output.sourceRefs as unknown[];
      const sourceRefRecord =
        sourceRef && typeof sourceRef === 'object' ? (sourceRef as Record<string, unknown>) : {};
      expect(sourceRefRecord.source).toBe('system');
      expect(typeof sourceRefRecord.rawEventId).toBe('string');
      expect(sourceRefRecord.evidenceId).toBeUndefined();
      expect(sourceRefRecord.sourcePayloadRef).toEqual(
        expect.stringMatching(/^inline:\/\/timeline\/system\/identity_facet_/),
      );
      expect(output.sourcePayloadRefs).toEqual([
        expect.stringMatching(/^inline:\/\/timeline\/system\/identity_facet_/),
      ]);
    }

    const createOutput = outputs.find((output) => output.operation === 'create');
    expect(createOutput?.payload).toEqual(
      expect.objectContaining({
        system_event_kind: 'identity_facet_create',
        entity_id: person.id,
        identity_facet_id: facet.id,
        identity_facet_kind: 'email',
        value: 'Nora@Acme.com',
        normalized_value: 'nora@acme.com',
        actor_kind: 'user',
        actor_user_id: USER_OWNER,
      }),
    );
    const updateOutput = outputs.find((output) => output.operation === 'update');
    expect(updateOutput?.payload).toEqual(
      expect.objectContaining({
        system_event_kind: 'identity_facet_update',
        entity_id: person.id,
        identity_facet_id: facet.id,
        identity_facet_kind: 'email',
        value: 'nora@acme.com',
        normalized_value: 'nora@acme.com',
        actor_kind: 'agent',
        actor_user_id: USER_OWNER,
        previous: expect.objectContaining({
          value: 'Nora@Acme.com',
          normalized_value: 'nora@acme.com',
        }) as unknown,
      }),
    );
  });
});

describe('object scope — notes and suggestions', () => {
  it('keeps note edits and deletes author-only, including direct action-style calls', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const memberScope = withTeam(db, TEAM_A, USER_MEMBER).objects;
    const object = await ownerScope.createObject({
      type: 'project',
      canonicalName: 'Customer rollout',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const note = await ownerScope.createNote({
      entityId: object.id,
      body: 'Original rollout note',
      authorUserId: USER_OWNER,
    });
    const noteOutputsAfterCreate = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, note.id));
    expect(noteOutputsAfterCreate).toHaveLength(1);
    expect(noteOutputsAfterCreate[0]).toEqual(
      expect.objectContaining({
        outputKind: 'direct_write',
        targetKind: 'object_note',
        operation: 'create',
        status: 'applied',
        requiresApproval: false,
        visibility: 'team',
        visibilityFloor: 'team',
      }),
    );
    expect(noteOutputsAfterCreate[0]?.payload).toEqual(
      expect.objectContaining({
        source: 'system',
        system_event_kind: 'object_note_create',
        entity_id: object.id,
        note_id: note.id,
        body: 'Original rollout note',
      }),
    );

    await expect(
      memberScope.updateNote({
        noteId: note.id,
        body: 'Hijacked note',
        actorUserId: USER_MEMBER,
      }),
    ).resolves.toBe(false);
    await expect(
      memberScope.deleteNote({ noteId: note.id, actorUserId: USER_MEMBER }),
    ).resolves.toBe(false);
    const noteOutputsAfterUnauthorizedAttempts = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, note.id));
    expect(noteOutputsAfterUnauthorizedAttempts).toHaveLength(1);

    await expect(
      ownerScope.updateNote({
        noteId: note.id,
        body: 'Updated rollout note',
        actorUserId: USER_OWNER,
      }),
    ).resolves.toBe(true);
    await expect(ownerScope.deleteNote({ noteId: note.id, actorUserId: USER_OWNER })).resolves.toBe(
      true,
    );

    const rows = await db.select().from(objectNotes).where(eq(objectNotes.id, note.id));
    expect(rows[0]?.body).toBe('Updated rollout note');
    expect(rows[0]?.deletedAt).toBeInstanceOf(Date);

    const changes = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, object.id));
    expect(changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(['__note_create__', '__note_update__', '__note_delete__']),
    );
    expect(
      changes
        .filter((change) =>
          ['__note_create__', '__note_update__', '__note_delete__'].includes(change.field),
        )
        .every((change) => change.sourceEventId === null),
    ).toBe(true);

    const noteOutputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, note.id));
    expect(noteOutputs.map((output) => output.operation).sort()).toEqual([
      'archive_or_cancel',
      'create',
      'update',
    ]);
    for (const output of noteOutputs) {
      expect(output).toEqual(
        expect.objectContaining({
          outputKind: 'direct_write',
          targetKind: 'object_note',
          targetId: note.id,
          status: 'applied',
          requiresApproval: false,
          visibility: 'team',
          visibilityFloor: 'team',
        }),
      );
      expect(Array.isArray(output.sourceRefs)).toBe(true);
      const [sourceRef] = output.sourceRefs as unknown[];
      const sourceRefRecord =
        sourceRef && typeof sourceRef === 'object' ? (sourceRef as Record<string, unknown>) : {};
      expect(sourceRefRecord.source).toBe('system');
      expect(typeof sourceRefRecord.rawEventId).toBe('string');
      expect(sourceRefRecord.evidenceId).toBeUndefined();
      expect(sourceRefRecord.sourcePayloadRef).toEqual(
        expect.stringMatching(/^inline:\/\/timeline\/system\/object_note_/),
      );
      expect(output.sourcePayloadRefs).toEqual([
        expect.stringMatching(/^inline:\/\/timeline\/system\/object_note_/),
      ]);
    }
    const updateOutput = noteOutputs.find((output) => output.operation === 'update');
    expect(updateOutput?.payload).toEqual(
      expect.objectContaining({
        system_event_kind: 'object_note_update',
        entity_id: object.id,
        note_id: note.id,
        body: 'Updated rollout note',
        previous_body: 'Original rollout note',
      }),
    );
    const deleteOutput = noteOutputs.find((output) => output.operation === 'archive_or_cancel');
    expect(deleteOutput?.payload).toEqual(
      expect.objectContaining({
        system_event_kind: 'object_note_delete',
        entity_id: object.id,
        note_id: note.id,
        previous_body: 'Updated rollout note',
      }),
    );
  });

  it('creates link artifact evidence from object audit note text', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'project',
      canonicalName: 'Link audit project',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const note = await scope.createNote({
      entityId: object.id,
      body: 'Launch checklist: https://example.com/checklists/launch?utm_source=note&step=2',
      authorUserId: USER_OWNER,
    });

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toContainEqual(
      expect.objectContaining({
        artifactType: 'link',
        canonicalName: 'example.com/checklists/launch',
      }),
    );
    const linkCluster = clusters.find(
      (cluster) =>
        cluster.artifactType === 'link' &&
        cluster.canonicalName === 'example.com/checklists/launch',
    );
    if (!linkCluster) throw new Error('expected link cluster');
    const initialAssociationRows = await db
      .select()
      .from(artifactEvidenceAssociations)
      .where(eq(artifactEvidenceAssociations.clusterId, linkCluster.id));
    expect(initialAssociationRows).toEqual([
      expect.objectContaining({
        role: 'related_context',
        strength: 'semantic',
        associationSource: 'model_candidate',
      }),
    ]);
    await db.insert(artifactClusterMembers).values({
      teamId: TEAM_A,
      clusterId: linkCluster.id,
      rawEventId: initialAssociationRows[0]?.rawEventId ?? null,
      role: 'related_context',
      strength: 'semantic',
      metadata: {
        canonical_name: 'legacy.example.com/stale-checklist',
        canonical_url: 'https://legacy.example.com/stale-checklist',
        display_url: 'legacy.example.com/stale-checklist',
        domain: 'legacy.example.com',
      },
    });
    await db
      .update(artifactEvidenceAssociations)
      .set({ rawEventId: null })
      .where(eq(artifactEvidenceAssociations.clusterId, linkCluster.id));

    const detail = await scope.getObject(object.id);
    expect(detail?.connectedWork.links).toEqual([
      expect.objectContaining({
        canonicalUrl: 'https://example.com/checklists/launch?step=2',
        displayUrl: 'example.com/checklists/launch',
      }),
    ]);

    await expect(
      scope.updateNote({
        noteId: note.id,
        body: 'Updated checklist: https://example.com/checklists/final?step=3',
        actorUserId: USER_OWNER,
      }),
    ).resolves.toBe(true);
    const detailAfterEdit = await scope.getObject(object.id);
    expect(detailAfterEdit?.connectedWork.links).toEqual([
      expect.objectContaining({
        canonicalUrl: 'https://example.com/checklists/final?step=3',
        displayUrl: 'example.com/checklists/final',
      }),
    ]);
    await expect(
      db
        .select()
        .from(artifactClusterMembers)
        .where(eq(artifactClusterMembers.clusterId, linkCluster.id)),
    ).resolves.toHaveLength(1);

    await expect(
      scope.updateNote({
        noteId: note.id,
        body: 'Updated checklist now lives in the internal launch tracker',
        actorUserId: USER_OWNER,
      }),
    ).resolves.toBe(true);
    const detailAfterDroppingLink = await scope.getObject(object.id);
    expect(detailAfterDroppingLink?.connectedWork.links).toEqual([]);

    await expect(scope.deleteNote({ noteId: note.id, actorUserId: USER_OWNER })).resolves.toBe(
      true,
    );
    const detailAfterDelete = await scope.getObject(object.id);
    expect(detailAfterDelete?.connectedWork.links).toEqual([]);
  });

  it('returns approved identity facets on object detail', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const person = await scope.createObject({
      type: 'person',
      canonicalName: 'Ada Lovelace',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.createIdentityFacet({
      entityId: person.id,
      kind: 'email',
      value: 'Ada@Example.com',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await scope.createIdentityFacet({
      entityId: person.id,
      kind: 'phone',
      value: '+1 213 373 4253',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await expect(scope.getObject(person.id)).resolves.toMatchObject({
      identityFacets: [
        expect.objectContaining({
          kind: 'email',
          value: 'Ada@Example.com',
          normalizedValue: 'ada@example.com',
        }),
        expect.objectContaining({
          kind: 'phone',
          value: '+1 213 373 4253',
          normalizedValue: '+12133734253',
        }),
      ],
    });
  });

  it('canonicalizes email and phone identity facets instead of trusting supplied normalized values', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const person = await scope.createObject({
      type: 'person',
      canonicalName: 'Grace Hopper',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.createIdentityFacet({
      entityId: person.id,
      kind: 'email',
      value: 'Grace@Example.com',
      normalizedValue: 'grace@example.com?bcc=attacker@example.com',
      actor: { kind: 'agent', userId: null },
    });
    await scope.createIdentityFacet({
      entityId: person.id,
      kind: 'phone',
      value: '+1 (213) 373-4253',
      normalizedValue: '+12133734253;ext=999',
      actor: { kind: 'agent', userId: null },
    });

    await expect(scope.listIdentityFacets(person.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'email',
        normalizedValue: 'grace@example.com',
      }),
      expect.objectContaining({
        kind: 'phone',
        normalizedValue: '+12133734253',
      }),
    ]);
  });

  it('accepts local phone identity facets with a leading trunk zero', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const person = await scope.createObject({
      type: 'person',
      canonicalName: 'Alan Turing',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.createIdentityFacet({
      entityId: person.id,
      kind: 'phone',
      value: '07700 900123',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await expect(scope.listIdentityFacets(person.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'phone',
        normalizedValue: '07700900123',
      }),
    ]);
  });

  it('accepts a suggested field change once and rejects unsupported suggestion fields', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'task',
      canonicalName: 'Follow up with finance',
      status: 'todo',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const suggestion = await scope.proposeObjectChange({
      entityId: object.id,
      field: 'status',
      newValue: 'done',
      note: 'The conversation says this was completed.',
    });
    await expect(
      scope.acceptObjectChange(suggestion.id, { kind: 'user', userId: USER_OWNER }),
    ).resolves.toBe(true);
    await expect(
      scope.acceptObjectChange(suggestion.id, { kind: 'user', userId: USER_OWNER }),
    ).resolves.toBe(false);

    await expect(scope.getObject(object.id)).resolves.toMatchObject({ status: 'done' });

    const handcrafted = await db
      .insert(objectChanges)
      .values({
        teamId: TEAM_A,
        entityId: object.id,
        actorKind: 'agent',
        status: 'suggested',
        field: 'canonicalName',
        previousValue: 'Follow up with finance',
        newValue: 'Silently renamed',
      })
      .returning({ id: objectChanges.id });

    await expect(
      scope.acceptObjectChange(handcrafted[0]?.id ?? '', { kind: 'user', userId: USER_OWNER }),
    ).resolves.toBe(false);
    await expect(scope.getObject(object.id)).resolves.toMatchObject({
      canonicalName: 'Follow up with finance',
    });
  });

  it('surfaces connected work from active work, artifacts, approvals, and evidence', async () => {
    const workspace = withTeam(db, TEAM_A, USER_OWNER);
    const scope = workspace.objects;
    const company = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const person = await scope.createObject({
      type: 'person',
      canonicalName: 'Jonne Granqvist',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const openTask = await scope.createObject({
      type: 'task',
      canonicalName: 'Send message to DFK with proposed meeting times',
      status: 'todo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const doneTask = await scope.createObject({
      type: 'task',
      canonicalName: 'Send pilot times to DFK',
      status: 'done',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const substringTask = await scope.createObject({
      type: 'task',
      canonicalName: 'Investigate ADFK parser warning',
      status: 'todo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await db.insert(calendarEvents).values([
      {
        teamId: TEAM_A,
        createdByUserId: USER_OWNER,
        title: 'Meeting with DFK Finland Oy',
        startAt: new Date('2026-06-17T12:00:00.000Z'),
        endAt: new Date('2026-06-17T13:00:00.000Z'),
        timezone: 'Europe/Helsinki',
        visibility: 'team',
      },
      {
        teamId: TEAM_A,
        createdByUserId: USER_OWNER,
        title: 'ADFK parser planning',
        startAt: new Date('2026-06-18T12:00:00.000Z'),
        endAt: new Date('2026-06-18T13:00:00.000Z'),
        timezone: 'Europe/Helsinki',
        visibility: 'team',
      },
    ]);
    const [raw, substringRaw] = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_A,
          authorUserId: USER_OWNER,
          source: 'web',
          contentText: 'Jonne from DFK discussed the pilot.',
          occurredAt: new Date('2026-06-16T10:00:00.000Z'),
          visibility: 'team',
        },
        {
          teamId: TEAM_A,
          authorUserId: USER_OWNER,
          source: 'web',
          contentText: 'ADFK parser emitted a warning.',
          occurredAt: new Date('2026-06-18T10:00:00.000Z'),
          visibility: 'team',
        },
      ])
      .returning({ id: rawEvents.id });
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: raw?.id ?? '',
        statement: 'Jonne from DFK discussed the pilot.',
        confidence: 0.9,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    await db.insert(factEntities).values([
      { factId: fact?.id ?? '', entityId: company.id, role: 'subject' },
      { factId: fact?.id ?? '', entityId: person.id, role: 'object' },
    ]);
    const board = await workspace.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Proposal', kind: 'active' }],
    });
    await workspace.boards.addBoardItem(board.id, {
      entityId: company.id,
      nextStep: 'Agree pilot scope',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await db.insert(documents).values([
      {
        teamId: TEAM_A,
        ownerUserId: USER_OWNER,
        name: 'DFK pilot deck.pdf',
        visibility: 'team',
      },
      {
        teamId: TEAM_A,
        ownerUserId: USER_OWNER,
        name: 'ADFK parser notes.pdf',
        visibility: 'team',
      },
    ]);
    const [capturedFile] = await db
      .insert(documents)
      .values({
        teamId: TEAM_A,
        fileKind: 'captured',
        ownerUserId: USER_OWNER,
        name: 'dfk-whiteboard.png',
        visibility: 'team',
        sourceRawEventId: raw?.id ?? '',
      })
      .returning({ id: documents.id });
    const [capturedVersion] = await db
      .insert(documentVersions)
      .values({
        teamId: TEAM_A,
        documentId: capturedFile?.id ?? '',
        version: 1,
        objectKey: 'team/captured/v1/dfk-whiteboard.png',
        contentType: 'image/png',
      })
      .returning({ id: documentVersions.id });
    await db
      .update(documents)
      .set({ currentVersionId: capturedVersion?.id ?? null })
      .where(eq(documents.id, capturedFile?.id ?? ''));
    const [linkCluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_A,
        artifactType: 'link',
        canonicalName: 'example.com/dfk-pilot',
        metadata: {
          canonical_url: 'https://example.com/dfk-pilot',
          display_url: 'example.com/dfk-pilot',
          domain: 'example.com',
        },
      })
      .returning({ id: artifactClusters.id });
    const [linkEvidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_A,
        rawEventId: raw?.id ?? '',
        source: 'web',
        eventType: 'link.detected',
        occurredAt: new Date('2026-06-16T10:00:00.000Z'),
        visibility: 'team',
        actor: {},
        contentDigest: 'digest:connected-work-link',
        normalizerVersion: 'test-v1',
        dedupeKey: 'evidence:connected-work-link',
      })
      .returning({ id: reconciliationEvidence.id });
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_A,
      clusterId: linkCluster?.id ?? '',
      evidenceId: linkEvidence?.id ?? '',
      rawEventId: raw?.id ?? '',
      role: 'related_context',
      strength: 'semantic',
      associationSource: 'model_candidate',
      sourceRefs: [],
      visibility: 'team',
      visibilityFloor: 'team',
      metadata: {
        canonical_name: 'example.com/dfk-pilot',
        canonical_url: 'https://example.com/dfk-pilot',
        display_url: 'example.com/dfk-pilot',
        domain: 'example.com',
      },
      dedupeKey: 'association:connected-work-link',
    });
    const [suggestion, substringSuggestion] = await db
      .insert(agentSuggestions)
      .values([
        {
          teamId: TEAM_A,
          source: 'background',
          title: 'Merge duplicate DFK object',
          dedupeKey: 'merge-dfk-object',
          visibility: 'team',
        },
        {
          teamId: TEAM_A,
          source: 'background',
          title: 'Review ADFK parser object',
          dedupeKey: 'review-adfk-parser',
          visibility: 'team',
        },
      ])
      .returning({ id: agentSuggestions.id });
    await db.insert(agentSuggestionItems).values([
      {
        suggestionId: suggestion?.id ?? '',
        teamId: TEAM_A,
        operation: 'merge',
        targetKind: 'object_merge',
        title: 'Merge DFK Finland Oy into DFK',
        dedupeKey: 'merge-dfk-object:item',
        proposedPayload: { objectIds: [company.id, '77777777-7777-4777-8777-777777777777'] },
      },
      {
        suggestionId: substringSuggestion?.id ?? '',
        teamId: TEAM_A,
        operation: 'update',
        targetKind: 'object',
        title: 'Review ADFK parser settings',
        dedupeKey: 'review-adfk-parser:item',
        proposedPayload: { canonicalName: 'ADFK parser settings' },
      },
    ]);
    const [artifactRaw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Sentry incident INC-42 moved to active customer impact.',
        occurredAt: new Date('2026-06-19T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id, occurredAt: rawEvents.occurredAt });
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_A,
        artifactClusterKind: 'incident',
        artifactType: 'incident',
        canonicalName: 'Checkout incident INC-42',
        status: 'active',
        canonicalEntityId: company.id,
      })
      .returning({ id: artifactClusters.id });
    const [artifactEvidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_A,
        rawEventId: artifactRaw?.id ?? '',
        source: 'integration',
        provider: 'sentry',
        externalObjectId: 'INC-42',
        eventType: 'issue.updated',
        occurredAt: artifactRaw?.occurredAt ?? new Date('2026-06-19T10:00:00.000Z'),
        visibility: 'team',
        actor: {},
        contentDigest: 'digest:connected-work-artifact',
        normalizerVersion: 'test-v1',
        dedupeKey: 'evidence:connected-work-artifact',
      })
      .returning({ id: reconciliationEvidence.id });
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_A,
      clusterId: cluster?.id ?? '',
      evidenceId: artifactEvidence?.id ?? '',
      role: 'lifecycle_update',
      strength: 'provider',
      associationSource: 'authoritative_provider',
      sourceRefs: [],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'association:connected-work-artifact',
    });
    const [run] = await db
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_A,
        trigger: 'eval',
        scope: 'connected-work-test',
        status: 'completed',
        inputFingerprint: 'connected-work-output',
        engineVersion: 'test-v1',
      })
      .returning({ id: reconciliationRuns.id });
    await db.insert(reconciliationOutputs).values({
      teamId: TEAM_A,
      runId: run?.id ?? '',
      clusterId: cluster?.id ?? null,
      outputKind: 'approval_bundle',
      targetKind: 'object',
      operation: 'update',
      targetId: null,
      payload: { title: 'Review customer-impact incident', status: 'blocked' },
      authorityDecision: { decision: 'approval_required', policy_version: 'test-v1' },
      requiresApproval: true,
      sourceRefs: [{ source: 'sentry', rawEventId: artifactRaw?.id }],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'output:connected-work-artifact',
      status: 'pending',
    });

    const detail = await scope.getObject(company.id);

    expect(detail?.connectedWork.openTasks).toEqual([expect.objectContaining({ id: openTask.id })]);
    expect(detail?.openTasks).toEqual([expect.objectContaining({ id: openTask.id })]);
    expect(detail?.connectedWork.openTasks).not.toContainEqual(
      expect.objectContaining({ id: substringTask.id }),
    );
    expect(detail?.connectedWork.recentTasks).toEqual([
      expect.objectContaining({ id: doneTask.id }),
    ]);
    expect(detail?.connectedWork.calendarEvents).toEqual([
      expect.objectContaining({ title: 'Meeting with DFK Finland Oy' }),
    ]);
    expect(detail?.connectedWork.calendarEvents).not.toContainEqual(
      expect.objectContaining({ title: 'ADFK parser planning' }),
    );
    expect(detail?.connectedWork.timelineEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: raw?.id,
          contentText: 'Jonne from DFK discussed the pilot.',
        }),
        expect.objectContaining({
          id: artifactRaw?.id,
          contentText: 'Sentry incident INC-42 moved to active customer impact.',
        }),
      ]),
    );
    expect(detail?.connectedWork.timelineEvents).not.toContainEqual(
      expect.objectContaining({ id: substringRaw?.id }),
    );
    expect(detail?.connectedWork.objects).toEqual([
      expect.objectContaining({ id: person.id, canonicalName: 'Jonne Granqvist', factCount: 1 }),
    ]);
    expect(detail?.connectedWork.boards).toEqual([
      expect.objectContaining({ boardName: 'Pilot pipeline', nextStep: 'Agree pilot scope' }),
    ]);
    expect(detail?.connectedWork.pendingApprovals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Merge DFK Finland Oy into DFK' }),
        expect.objectContaining({ title: 'Review customer-impact incident' }),
      ]),
    );
    expect(detail?.connectedWork.pendingApprovals).not.toContainEqual(
      expect.objectContaining({ title: 'Review ADFK parser settings' }),
    );
    expect(detail?.connectedWork.documents).toEqual([
      expect.objectContaining({ name: 'DFK pilot deck.pdf' }),
    ]);
    expect(detail?.connectedWork.documents).not.toContainEqual(
      expect.objectContaining({ name: 'ADFK parser notes.pdf' }),
    );
    expect(detail?.connectedWork.links).toEqual([
      expect.objectContaining({
        canonicalUrl: 'https://example.com/dfk-pilot',
        displayUrl: 'example.com/dfk-pilot',
      }),
    ]);
    expect(detail?.connectedWork.capturedFiles).toEqual([
      expect.objectContaining({ name: 'dfk-whiteboard.png', contentType: 'image/png' }),
    ]);
  });

  it('does not surface connected work links from legacy artifact_cluster_members', async () => {
    const workspace = withTeam(db, TEAM_A, USER_OWNER);
    const scope = workspace.objects;
    const company = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'web',
        contentText: 'DFK shared https://legacy.example.com/dfk-pilot.',
        occurredAt: new Date('2026-06-16T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: raw?.id ?? '',
        statement: 'DFK shared a legacy pilot link.',
        confidence: 0.9,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    await db.insert(factEntities).values({
      factId: fact?.id ?? '',
      entityId: company.id,
      role: 'subject',
    });
    const [linkCluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_A,
        artifactType: 'link',
        canonicalName: 'legacy.example.com/dfk-pilot',
        metadata: {
          canonical_url: 'https://legacy.example.com/dfk-pilot',
          display_url: 'legacy.example.com/dfk-pilot',
          domain: 'legacy.example.com',
        },
      })
      .returning({ id: artifactClusters.id });
    await db.insert(artifactClusterMembers).values({
      teamId: TEAM_A,
      clusterId: linkCluster?.id ?? '',
      rawEventId: raw?.id ?? '',
      role: 'related_context',
      strength: 'semantic',
      metadata: {
        canonical_name: 'legacy.example.com/dfk-pilot',
        canonical_url: 'https://legacy.example.com/dfk-pilot',
        display_url: 'legacy.example.com/dfk-pilot',
        domain: 'legacy.example.com',
      },
    });

    const detail = await scope.getObject(company.id);

    expect(detail?.connectedWork.timelineEvents).toEqual([
      expect.objectContaining({ id: raw?.id }),
    ]);
    expect(detail?.connectedWork.links).toEqual([]);
  });

  it('does not surface fact-backed connected work from raw events hidden from the viewer', async () => {
    const workspace = withTeam(db, TEAM_A, USER_OWNER);
    const company = await workspace.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const hiddenPerson = await workspace.objects.createObject({
      type: 'person',
      canonicalName: 'Private Contact',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_MEMBER,
        source: 'web',
        contentText: 'Private Contact from DFK discussed confidential terms.',
        occurredAt: new Date('2026-06-16T10:00:00.000Z'),
        visibility: 'private',
      })
      .returning({ id: rawEvents.id });
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: raw?.id ?? '',
        statement: 'Private Contact from DFK discussed confidential terms.',
        confidence: 0.9,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    await db.insert(factEntities).values([
      { factId: fact?.id ?? '', entityId: company.id, role: 'subject' },
      { factId: fact?.id ?? '', entityId: hiddenPerson.id, role: 'object' },
    ]);
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_A,
        artifactClusterKind: 'customer_project',
        artifactType: 'project',
        canonicalName: 'Private DFK terms',
        canonicalEntityId: company.id,
      })
      .returning({ id: artifactClusters.id });
    const [evidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_A,
        rawEventId: raw?.id ?? '',
        source: 'web',
        eventType: 'private.note',
        occurredAt: new Date('2026-06-16T10:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_MEMBER,
        actor: {},
        contentDigest: 'digest:hidden-connected-work',
        normalizerVersion: 'test-v1',
        dedupeKey: 'evidence:hidden-connected-work',
      })
      .returning({ id: reconciliationEvidence.id });
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_A,
      clusterId: cluster?.id ?? '',
      evidenceId: evidence?.id ?? '',
      role: 'evidence_only',
      strength: 'human',
      associationSource: 'human',
      sourceRefs: [],
      visibility: 'private',
      visibilityOwnerUserId: USER_MEMBER,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: USER_MEMBER,
      dedupeKey: 'association:hidden-connected-work',
    });

    const detail = await workspace.objects.getObject(company.id);

    expect(detail?.connectedWork.objects).toEqual([]);
    expect(detail?.connectedWork.timelineEvents).toEqual([]);
  });

  it('does not surface pending reconciliation outputs hidden from the viewer', async () => {
    const workspace = withTeam(db, TEAM_A, USER_OWNER);
    const company = await workspace.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Sentry incident INC-99 affects DFK onboarding.',
        occurredAt: new Date('2026-06-17T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_A,
        artifactClusterKind: 'incident',
        artifactType: 'incident',
        canonicalName: 'INC-99',
        canonicalEntityId: company.id,
      })
      .returning({ id: artifactClusters.id });
    const [evidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_A,
        rawEventId: raw?.id ?? '',
        source: 'integration',
        provider: 'sentry',
        externalObjectId: 'INC-99',
        eventType: 'issue.updated',
        occurredAt: new Date('2026-06-17T10:00:00.000Z'),
        visibility: 'team',
        actor: {},
        contentDigest: 'digest:hidden-output-evidence',
        normalizerVersion: 'test-v1',
        dedupeKey: 'evidence:hidden-output-evidence',
      })
      .returning({ id: reconciliationEvidence.id });
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_A,
      clusterId: cluster?.id ?? '',
      evidenceId: evidence?.id ?? '',
      rawEventId: raw?.id ?? '',
      role: 'lifecycle_update',
      strength: 'provider',
      associationSource: 'authoritative_provider',
      sourceRefs: [],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'association:hidden-output-evidence',
    });
    const [run] = await db
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_A,
        trigger: 'eval',
        scope: 'connected-work-hidden-output',
        status: 'completed',
        inputFingerprint: 'connected-work-hidden-output',
        engineVersion: 'test-v1',
      })
      .returning({ id: reconciliationRuns.id });
    await db.insert(reconciliationOutputs).values([
      {
        teamId: TEAM_A,
        runId: run?.id ?? '',
        clusterId: cluster?.id ?? null,
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'update',
        targetId: company.id,
        payload: { title: 'Visible DFK incident review' },
        authorityDecision: { decision: 'approval_required', policy_version: 'test-v1' },
        requiresApproval: true,
        sourceRefs: [{ source: 'sentry', rawEventId: raw?.id }],
        visibility: 'team',
        visibilityFloor: 'team',
        dedupeKey: 'output:visible-dfk-incident-review',
        status: 'pending',
      },
      {
        teamId: TEAM_A,
        runId: run?.id ?? '',
        clusterId: cluster?.id ?? null,
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'update',
        targetId: company.id,
        payload: { title: 'Hidden direct DFK approval' },
        authorityDecision: { decision: 'approval_required', policy_version: 'test-v1' },
        requiresApproval: true,
        sourceRefs: [{ source: 'sentry', rawEventId: raw?.id }],
        visibility: 'private',
        visibilityOwnerUserId: USER_MEMBER,
        visibilityFloor: 'private',
        visibilityFloorOwnerUserId: USER_MEMBER,
        dedupeKey: 'output:hidden-direct-dfk-approval',
        status: 'pending',
      },
      {
        teamId: TEAM_A,
        runId: run?.id ?? '',
        clusterId: cluster?.id ?? null,
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'update',
        targetId: null,
        payload: { title: 'Hidden source-ref DFK approval' },
        authorityDecision: { decision: 'approval_required', policy_version: 'test-v1' },
        requiresApproval: true,
        sourceRefs: [{ source: 'sentry', rawEventId: raw?.id }],
        visibility: 'private',
        visibilityOwnerUserId: USER_MEMBER,
        visibilityFloor: 'private',
        visibilityFloorOwnerUserId: USER_MEMBER,
        dedupeKey: 'output:hidden-source-ref-dfk-approval',
        status: 'pending',
      },
    ]);

    const detail = await workspace.objects.getObject(company.id);

    expect(detail?.connectedWork.pendingApprovals).toEqual([
      expect.objectContaining({ title: 'Visible DFK incident review' }),
    ]);
    expect(detail?.connectedWork.pendingApprovals).not.toContainEqual(
      expect.objectContaining({ title: 'Hidden direct DFK approval' }),
    );
    expect(detail?.connectedWork.pendingApprovals).not.toContainEqual(
      expect.objectContaining({ title: 'Hidden source-ref DFK approval' }),
    );
  });

  it('surfaces paraphrased timeline evidence for long task titles', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Replace FSLI scoping logic with risk-informed approach',
      aliases: ['fsli-scoping-logic-overhaul'],
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const weakEventInputs = Array.from({ length: 25 }, (_, index) => ({
      teamId: TEAM_A,
      authorUserId: USER_OWNER,
      source: 'telegram' as const,
      contentText: `The team discussed a general risk approach for audit planning update ${index}.`,
      occurredAt: new Date(`2026-06-29T12:${String(index).padStart(2, '0')}:00.000Z`),
      visibility: 'team' as const,
    }));
    const [sourceEvent, ...weakEvents] = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_A,
          authorUserId: USER_OWNER,
          source: 'telegram',
          contentText:
            'Mikael asked to replace the current FSLI scoping logic in AuditAI with a risk-informed approach based on ISA 320 and ISA 315.',
          occurredAt: new Date('2026-06-29T11:00:00.000Z'),
          visibility: 'team',
        },
        ...weakEventInputs,
      ])
      .returning({ id: rawEvents.id });

    const detail = await scope.getObject(task.id);
    const eventsPage = await scope.getObjectSectionPage(task.id, 'events');

    expect(detail?.connectedWork.timelineEvents).toEqual([
      expect.objectContaining({
        id: sourceEvent?.id,
        contentText:
          'Mikael asked to replace the current FSLI scoping logic in AuditAI with a risk-informed approach based on ISA 320 and ISA 315.',
      }),
    ]);
    expect(detail?.provenance.relatedEvidence).toEqual([
      expect.objectContaining({
        evidence: [expect.objectContaining({ rawEventId: sourceEvent?.id })],
      }),
    ]);
    expect(eventsPage?.items).toEqual([
      expect.objectContaining({ id: sourceEvent?.id, source: 'telegram' }),
    ]);
    expect(detail?.connectedWork.timelineEvents).not.toContainEqual(
      expect.objectContaining({ id: weakEvents[0]?.id }),
    );
  });
});

describe('object scope — chat session isolation', () => {
  it('only lets the creator read, append to, pin, and archive their chat sessions', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const memberScope = withTeam(db, TEAM_A, USER_MEMBER).objects;
    const object = await ownerScope.createObject({
      type: 'project',
      canonicalName: 'Internal AI thread',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const session = await ownerScope.createChatSession();
    await expect(ownerScope.chatSessionTitleStatus(session.id)).resolves.toEqual({
      exists: true,
      needsTitle: true,
    });

    await ownerScope.appendChatMessages(session.id, [
      { role: 'user', authorUserId: USER_OWNER, content: 'Summarize the rollout' },
    ]);
    const afterAppend = await db.select().from(chatSessions).where(eq(chatSessions.id, session.id));
    await ownerScope.setChatSessionTitle(session.id, 'Rollout summary', { touchUpdatedAt: false });
    await expect(ownerScope.chatSessionTitleStatus(session.id)).resolves.toEqual({
      exists: true,
      needsTitle: false,
    });

    await expect(memberScope.getChatSession(session.id)).resolves.toBeNull();
    await expect(memberScope.chatSessionTitleStatus(session.id)).resolves.toEqual({
      exists: false,
      needsTitle: false,
    });
    await expect(
      memberScope.appendChatMessages(session.id, [
        { role: 'user', authorUserId: USER_MEMBER, content: 'Intrude' },
      ]),
    ).rejects.toThrow('Session not found');

    await memberScope.setChatSessionTitle(session.id, 'Renamed by teammate');
    await memberScope.setUniqueChatSessionTitle(session.id, 'Uniquely renamed by teammate');
    await memberScope.archiveChatSession(session.id);
    await memberScope.linkChatSessionToObject(session.id, object.id);

    const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, session.id));
    expect(rows[0]).toMatchObject({
      title: 'Rollout summary',
      pinnedEntityId: null,
      createdBy: USER_OWNER,
    });
    expect(rows[0]?.updatedAt.getTime()).toBe(afterAppend[0]?.updatedAt.getTime());
    expect(rows[0]?.archivedAt).toBeNull();

    await ownerScope.linkChatSessionToObject(session.id, object.id);
    await ownerScope.archiveChatSession(session.id);

    await expect(ownerScope.chatSessionExists(session.id)).resolves.toBe(false);
    await expect(ownerScope.chatSessionTitleStatus(session.id)).resolves.toEqual({
      exists: false,
      needsTitle: false,
    });
    await expect(ownerScope.getChatSession(session.id)).resolves.toBeNull();

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, session.id));
    expect(messages).toHaveLength(1);

    const archived = await db.select().from(chatSessions).where(eq(chatSessions.id, session.id));
    expect(archived[0]?.pinnedEntityId).toBe(object.id);
    expect(archived[0]?.archivedAt).toBeInstanceOf(Date);
  });

  it('assigns unique chat titles within the creator sidebar', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const first = await ownerScope.createChatSession();
    const second = await ownerScope.createChatSession();
    const otherUserScope = withTeam(db, TEAM_A, USER_MEMBER).objects;
    const otherUserSession = await otherUserScope.createChatSession();

    await ownerScope.setUniqueChatSessionTitle(first.id, 'Rollout summary', {
      touchUpdatedAt: false,
    });
    const beforeSecondTitle = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, second.id));
    await ownerScope.setUniqueChatSessionTitle(second.id, 'Rollout summary', {
      touchUpdatedAt: false,
    });
    await otherUserScope.setUniqueChatSessionTitle(otherUserSession.id, 'Rollout summary');

    const rows = await db
      .select({ id: chatSessions.id, title: chatSessions.title, updatedAt: chatSessions.updatedAt })
      .from(chatSessions)
      .where(inArray(chatSessions.id, [first.id, second.id, otherUserSession.id]));
    const titles = new Map(rows.map((row) => [row.id, row.title]));
    expect(titles.get(first.id)).toBe('Rollout summary');
    expect(titles.get(second.id)).toBe('Rollout summary 2');
    expect(titles.get(otherUserSession.id)).toBe('Rollout summary');
    expect(rows.find((row) => row.id === second.id)?.updatedAt.getTime()).toBe(
      beforeSecondTitle[0]?.updatedAt.getTime(),
    );
  });

  it('does not replace an existing title through the unique auto-title helper', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const session = await ownerScope.createChatSession({ title: 'Original title' });
    const beforeAutoTitle = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, session.id));

    await ownerScope.setUniqueChatSessionTitle(session.id, 'Late generated title', {
      touchUpdatedAt: false,
    });

    const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, session.id));
    expect(rows[0]?.title).toBe('Original title');
    expect(rows[0]?.updatedAt.getTime()).toBe(beforeAutoTitle[0]?.updatedAt.getTime());
  });

  it('rejects pinning a chat session to an object from another team', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const otherScope = withTeam(db, TEAM_B, USER_OTHER_TEAM).objects;
    const session = await ownerScope.createChatSession({ title: 'Scoped session' });
    const otherTeamObject = await otherScope.createObject({
      type: 'project',
      canonicalName: 'Other team project',
      actor: { kind: 'user', userId: USER_OTHER_TEAM },
    });

    await expect(
      ownerScope.linkChatSessionToObject(session.id, otherTeamObject.id),
    ).rejects.toThrow('Pinned object not in this team');

    const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, session.id));
    expect(rows[0]?.pinnedEntityId).toBeNull();
  });
});

describe('object scope — archive visibility', () => {
  it('hides archived objects when requested', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await ownerScope.createObject({
      type: 'task',
      canonicalName: 'Archive me',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await ownerScope.archiveObject(object.id, { kind: 'user', userId: USER_OWNER });

    await expect(ownerScope.listObjects({ archived: false })).resolves.not.toContainEqual(
      expect.objectContaining({ id: object.id }),
    );
    await expect(ownerScope.listObjects({ archived: true })).resolves.toContainEqual(
      expect.objectContaining({ id: object.id }),
    );

    await db.insert(entities).values({
      id: '99999999-9999-9999-9999-999999999999',
      teamId: TEAM_A,
      type: 'task',
      canonicalName: 'Merged duplicate',
      mergedIntoId: object.id,
    });
    await expect(ownerScope.listObjects({ archived: true })).resolves.not.toContainEqual(
      expect.objectContaining({ canonicalName: 'Merged duplicate' }),
    );
  });

  it('does not rewrite archivedAt when archiving an already archived object', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await ownerScope.createObject({
      type: 'task',
      canonicalName: 'Archive once',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const first = await ownerScope.archiveObject(object.id, {
      kind: 'user',
      userId: USER_OWNER,
    });
    const second = await ownerScope.archiveObject(object.id, {
      kind: 'user',
      userId: USER_OWNER,
    });

    expect(first.changedFields).toEqual(['archivedAt']);
    expect(second.changedFields).toEqual([]);
    expect(second.archivedAt?.getTime()).toBe(first.archivedAt?.getTime());
    const changeRows = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, object.id));
    expect(
      changeRows
        .filter((change) => change.field === 'archivedAt' || change.field === '__create__')
        .every((change) => change.sourceEventId === null),
    ).toBe(true);

    const outputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, object.id));
    expect(outputs.map((output) => output.operation).sort()).toEqual([
      'archive_or_cancel',
      'create',
    ]);
    const archiveOutput = outputs.find((output) => output.operation === 'archive_or_cancel');
    expect(archiveOutput).toEqual(
      expect.objectContaining({
        outputKind: 'direct_write',
        targetKind: 'object',
        status: 'applied',
        requiresApproval: false,
        visibility: 'team',
        visibilityFloor: 'team',
      }),
    );
    expect(archiveOutput?.payload).toEqual(
      expect.objectContaining({
        system_event_kind: 'object_update',
        changed_fields: ['archivedAt'],
      }),
    );
    expect(archiveOutput?.authorityDecision).toEqual(
      expect.objectContaining({
        target_kind: 'object',
        target_field: '__archive__',
      }),
    );
  });

  it('searches exact object names outside the recent list window', async () => {
    await pg.query(
      `INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
       VALUES ($1, 'company', 'Ancient Customer Contract', 'open', '[]'::jsonb, '{}'::jsonb, '2020-01-01T00:00:00.000Z')`,
      [TEAM_A],
    );
    await pg.query(
      `INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
       SELECT $1, 'company', 'Recent filler ' || gs::text, 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00.000Z'::timestamptz + (gs || ' seconds')::interval
       FROM generate_series(1, 500) AS gs`,
      [TEAM_A],
    );
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const recent = await ownerScope.listObjects({ archived: false, limit: 500 });
    expect(recent.map((row) => row.canonicalName)).not.toContain('Ancient Customer Contract');

    const found = await ownerScope.searchObjects({
      query: 'Ancient Customer Contract',
      archived: false,
      limit: 10,
    });
    expect(found.map((row) => row.canonicalName)).toEqual(['Ancient Customer Contract']);
  });

  it('requires every object search token to match across indexed object fields', async () => {
    await pg.query(
      `INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
       VALUES
         ($1, 'company', 'Acme Corporation', 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00.000Z'),
         ($1, 'project', 'Acme Migration', 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:01.000Z'),
         ($1, 'company', 'Beta Corporation', 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:02.000Z')`,
      [TEAM_A],
    );
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const found = await ownerScope.searchObjects({
      query: 'acme company',
      archived: false,
      limit: 10,
    });

    expect(found.map((row) => row.canonicalName)).toEqual(['Acme Corporation']);
  });

  it('matches object search tokens against aliases case-insensitively', async () => {
    await pg.query(
      `INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
       VALUES
         ($1, 'company', 'Acme Corporation', 'open', '["Acme Corp"]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00.000Z'),
         ($1, 'company', 'Beta Corporation', 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:01.000Z')`,
      [TEAM_A],
    );
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const found = await ownerScope.searchObjects({
      query: 'acme corp',
      archived: false,
      limit: 10,
    });

    expect(found.map((row) => row.canonicalName)).toEqual(['Acme Corporation']);
  });

  it('lists object, search, and notification pages beyond the old 500-row cap', async () => {
    await pg.query(
      `INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
       SELECT $1, 'task', 'Bulk Window Task ' || gs::text, 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00.000Z'::timestamptz + (gs || ' seconds')::interval
       FROM generate_series(1, 501) AS gs`,
      [TEAM_A],
    );
    await pg.query(
      `INSERT INTO notifications (team_id, user_id, kind, summary, payload, created_at)
       SELECT $1, $2, 'mention', 'Bulk notification ' || gs::text, '{}'::jsonb, '2026-01-01T00:00:00.000Z'::timestamptz + (gs || ' seconds')::interval
       FROM generate_series(1, 501) AS gs`,
      [TEAM_A, USER_OWNER],
    );
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;

    await expect(
      ownerScope.listObjects({ archived: false, type: 'task', limit: 501 }),
    ).resolves.toHaveLength(501);
    await expect(
      ownerScope.searchObjects({ query: 'Bulk Window Task', archived: false, limit: 501 }),
    ).resolves.toHaveLength(501);
    await expect(ownerScope.listNotifications({ limit: 501 })).resolves.toHaveLength(501);
  });

  it('returns no object search results for queries without searchable tokens', async () => {
    await pg.query(
      `INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
       VALUES ($1, 'project', 'Visible Recent Object', 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00.000Z')`,
      [TEAM_A],
    );
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;

    await expect(
      ownerScope.searchObjects({ query: '---', archived: false, limit: 10 }),
    ).resolves.toEqual([]);
  });

  it('searches non-Latin object-name prefixes and exact aliases', async () => {
    await pg.query(
      `INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
       VALUES ($1, 'project', '東京 Project', 'open', '["首都"]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00.000Z')`,
      [TEAM_A],
    );
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const foundByName = await ownerScope.searchObjects({
      query: '東京',
      archived: false,
      limit: 10,
    });
    const foundByAlias = await ownerScope.searchObjects({
      query: '首都',
      archived: false,
      limit: 10,
    });

    expect(foundByName.map((row) => row.canonicalName)).toEqual(['東京 Project']);
    expect(foundByAlias.map((row) => row.canonicalName)).toEqual(['東京 Project']);
  });

  it('lists objects after an updated-at cursor', async () => {
    const newestId = '00000000-0000-4000-8000-000000000101';
    const middleId = '00000000-0000-4000-8000-000000000102';
    const oldestId = '00000000-0000-4000-8000-000000000103';
    await db.insert(entities).values([
      {
        id: newestId,
        teamId: TEAM_A,
        type: 'task',
        canonicalName: 'Cursor newest',
        updatedAt: new Date('2026-06-01T10:00:03.000Z'),
      },
      {
        id: middleId,
        teamId: TEAM_A,
        type: 'task',
        canonicalName: 'Cursor middle',
        updatedAt: new Date('2026-06-01T10:00:02.000Z'),
      },
      {
        id: oldestId,
        teamId: TEAM_A,
        type: 'task',
        canonicalName: 'Cursor oldest',
        updatedAt: new Date('2026-06-01T10:00:01.000Z'),
      },
    ]);
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const rows = await ownerScope.listObjects({
      archived: false,
      type: 'task',
      limit: 20,
      cursor: encodeCursor({ at: '2026-06-01T10:00:02.000Z', id: middleId }),
    });
    const rowIds = rows.map((row) => row.id);

    expect(rowIds).toContain(oldestId);
    expect(rowIds).not.toContain(newestId);
    expect(rowIds).not.toContain(middleId);
  });
});

describe('object scope — relationships', () => {
  it('stores related relationships in canonical endpoint order, dedupes reverse inserts, and emits direct-write outputs', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const first = await scope.createObject({
      type: 'person',
      canonicalName: 'John Doe',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const second = await scope.createObject({
      type: 'company',
      canonicalName: 'Acme Corporation',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [expectedFrom, expectedTo] = [first.id, second.id].sort();

    const created = await scope.addRelationship({
      fromEntityId: second.id,
      toEntityId: first.id,
      kind: 'related',
      actorUserId: USER_OWNER,
    });
    const duplicate = await scope.addRelationship({
      fromEntityId: first.id,
      toEntityId: second.id,
      kind: 'related',
      actorUserId: USER_OWNER,
    });

    expect(duplicate?.id).toBe(created?.id);
    const relationshipId = created?.id;
    if (!relationshipId) throw new Error('expected relationship id');
    const relationships = await db
      .select()
      .from(entityRelationships)
      .where(eq(entityRelationships.teamId, TEAM_A));
    expect(relationships).toEqual([
      expect.objectContaining({
        fromEntityId: expectedFrom,
        toEntityId: expectedTo,
        kind: 'related',
      }),
    ]);

    const linkEventRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_A));
    const linkEvent = linkEventRows.find(
      (row) => (row.sourceMetadata as { kind?: string } | null)?.kind === 'relationship_create',
    );
    expect(linkEvent?.id).toEqual(expect.any(String));
    const linkOutputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, relationshipId));
    expect(linkOutputs).toHaveLength(1);
    expect(linkOutputs[0]).toMatchObject({
      outputKind: 'direct_write',
      targetKind: 'object_relationship',
      operation: 'link',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
    });
    expect(linkOutputs[0]?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'system',
        rawEventId: linkEvent?.id,
      }),
    ]);
    const linkSourceRefs = linkOutputs[0]?.sourceRefs as
      | { sourcePayloadRef?: string | null }[]
      | undefined;
    const linkSourceRef = linkSourceRefs?.[0];
    expect(linkSourceRef?.sourcePayloadRef).toMatch(
      /^inline:\/\/timeline\/system\/relationship_create\//,
    );
    expect(linkOutputs[0]?.sourcePayloadRefs).toEqual([
      expect.stringMatching(/^inline:\/\/timeline\/system\/relationship_create\//),
    ]);
    expect(linkOutputs[0]?.payload).toMatchObject({
      source: 'system',
      system_event_kind: 'relationship_create',
      relationship_id: relationshipId,
      from_entity_id: expectedFrom,
      to_entity_id: expectedTo,
      relationship_kind: 'related',
      actor_kind: 'user',
      actor_user_id: USER_OWNER,
    });
    expect(linkOutputs[0]?.authorityDecision).toMatchObject({
      decision: 'direct_write',
      authority_decision: 'direct',
      source: 'system',
      target_kind: 'object_relationship',
      target_field: '__relationship_create__',
    });

    await expect(
      scope.removeRelationship(relationshipId, { kind: 'user', userId: USER_OWNER }),
    ).resolves.toBe(true);
    const relationshipChangeRows = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.teamId, TEAM_A));
    expect(
      relationshipChangeRows
        .filter((change) =>
          ['__relationship_create__', '__relationship_delete__'].includes(change.field),
        )
        .every((change) => change.sourceEventId === null),
    ).toBe(true);
    const unlinkEventRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_A));
    const unlinkEvent = unlinkEventRows.find(
      (row) => (row.sourceMetadata as { kind?: string } | null)?.kind === 'relationship_delete',
    );
    expect(unlinkEvent?.id).toEqual(expect.any(String));
    const relationshipOutputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, relationshipId));
    expect(relationshipOutputs.map((output) => output.operation).sort()).toEqual([
      'link',
      'unlink',
    ]);
    const unlinkOutput = relationshipOutputs.find((output) => output.operation === 'unlink');
    expect(unlinkOutput).toMatchObject({
      outputKind: 'direct_write',
      targetKind: 'object_relationship',
      operation: 'unlink',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
    });
    expect(unlinkOutput?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'system',
        rawEventId: unlinkEvent?.id,
      }),
    ]);
    const unlinkSourceRefs = unlinkOutput?.sourceRefs as
      | { sourcePayloadRef?: string | null }[]
      | undefined;
    const unlinkSourceRef = unlinkSourceRefs?.[0];
    expect(unlinkSourceRef?.sourcePayloadRef).toMatch(
      /^inline:\/\/timeline\/system\/relationship_delete\//,
    );
    expect(unlinkOutput?.sourcePayloadRefs).toEqual([
      expect.stringMatching(/^inline:\/\/timeline\/system\/relationship_delete\//),
    ]);
    expect(unlinkOutput?.payload).toMatchObject({
      source: 'system',
      system_event_kind: 'relationship_delete',
      relationship_id: relationshipId,
      from_entity_id: expectedFrom,
      to_entity_id: expectedTo,
      relationship_kind: 'related',
    });
    expect(unlinkOutput?.authorityDecision).toMatchObject({
      decision: 'direct_write',
      authority_decision: 'direct',
      source: 'system',
      target_kind: 'object_relationship',
      target_field: '__relationship_delete__',
    });
  });

  it('collapses reverse related duplicates when transferring relationships during merge', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const survivor = await scope.createObject({
      type: 'company',
      canonicalName: 'Acme',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const duplicate = await scope.createObject({
      type: 'company',
      canonicalName: 'ACME Ltd',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const person = await scope.createObject({
      type: 'person',
      canonicalName: 'John Doe',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.addRelationship({
      fromEntityId: survivor.id,
      toEntityId: person.id,
      kind: 'related',
      actorUserId: USER_OWNER,
    });
    await scope.addRelationship({
      fromEntityId: person.id,
      toEntityId: duplicate.id,
      kind: 'related',
      actorUserId: USER_OWNER,
    });

    await scope.mergeObjects({
      survivorId: survivor.id,
      mergedIds: [duplicate.id],
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const [expectedFrom, expectedTo] = [survivor.id, person.id].sort();
    const relationships = await db
      .select()
      .from(entityRelationships)
      .where(eq(entityRelationships.teamId, TEAM_A));
    expect(
      relationships.filter(
        (relationship) =>
          relationship.kind === 'related' &&
          relationship.fromEntityId === expectedFrom &&
          relationship.toEntityId === expectedTo,
      ),
    ).toHaveLength(1);
    expect(relationships).not.toContainEqual(
      expect.objectContaining({ fromEntityId: duplicate.id }),
    );
    expect(relationships).not.toContainEqual(expect.objectContaining({ toEntityId: duplicate.id }));
  });
});

describe('object scope — section feeds', () => {
  it('orders fact rows by source event time so older backfills do not look newer', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const project = await scope.createObject({
      type: 'project',
      canonicalName: 'Atlas rollout',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const eventRows = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_A,
          authorUserId: USER_OWNER,
          source: 'system',
          contentText: 'Older evidence extracted later',
          visibility: 'team',
          occurredAt: new Date('2026-06-14T09:00:00.000Z'),
        },
        {
          teamId: TEAM_A,
          authorUserId: USER_OWNER,
          source: 'telegram',
          contentText: 'Newer evidence extracted earlier',
          visibility: 'team',
          occurredAt: new Date('2026-06-15T09:00:00.000Z'),
        },
      ])
      .returning({ id: rawEvents.id });
    const olderEventId = eventRows[0]?.id;
    const newerEventId = eventRows[1]?.id;
    if (!olderEventId || !newerEventId) throw new Error('Failed to insert test raw events');
    const factRows = await db
      .insert(facts)
      .values([
        {
          teamId: TEAM_A,
          rawEventId: olderEventId,
          statement: 'Older source claim.',
          confidence: 0.9,
          modelVersion: 'test',
          extractedAt: new Date('2026-06-16T09:00:00.000Z'),
        },
        {
          teamId: TEAM_A,
          rawEventId: newerEventId,
          statement: 'Newer source claim.',
          confidence: 0.9,
          modelVersion: 'test',
          extractedAt: new Date('2026-06-15T10:00:00.000Z'),
        },
      ])
      .returning({ id: facts.id });
    const olderFactId = factRows[0]?.id;
    const newerFactId = factRows[1]?.id;
    if (!olderFactId || !newerFactId) throw new Error('Failed to insert test facts');
    await db.insert(factEntities).values([
      { factId: olderFactId, entityId: project.id, role: 'subject' },
      { factId: newerFactId, entityId: project.id, role: 'subject' },
    ]);

    const page = await scope.getObjectSectionPage(project.id, 'facts');

    expect(page?.items).toEqual([
      expect.objectContaining({
        id: newerFactId,
        statement: 'Newer source claim.',
        occurredAt: new Date('2026-06-15T09:00:00.000Z'),
        source: 'telegram',
      }),
      expect.objectContaining({
        id: olderFactId,
        statement: 'Older source claim.',
        occurredAt: new Date('2026-06-14T09:00:00.000Z'),
        source: 'system',
      }),
    ]);
  });

  it('includes other active objects attached to the same fact', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const project = await scope.createObject({
      type: 'project',
      canonicalName: 'Atlas rollout',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const customer = await scope.createObject({
      type: 'company',
      canonicalName: 'Northwind',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const owner = await scope.createObject({
      type: 'person',
      canonicalName: 'Mia Chen',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const otherTeamObject = await withTeam(db, TEAM_B, USER_OTHER_TEAM).objects.createObject({
      type: 'company',
      canonicalName: 'Other Team Co',
      actor: { kind: 'user', userId: USER_OTHER_TEAM },
    });
    const event = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'system',
        contentText: 'Atlas rollout evidence',
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    const eventId = event[0]?.id;
    if (!eventId) throw new Error('Failed to insert test raw event');
    const fact = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: eventId,
        statement: 'Atlas rollout depends on Northwind approval from Mia Chen.',
        confidence: 0.9,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    const factId = fact[0]?.id;
    if (!factId) throw new Error('Failed to insert test fact');
    await db.insert(factEntities).values([
      { factId, entityId: project.id, role: 'subject' },
      { factId, entityId: customer.id, role: 'object' },
      { factId, entityId: owner.id, role: 'subject' },
      { factId, entityId: owner.id, role: 'topic' },
      { factId, entityId: otherTeamObject.id, role: 'topic' },
    ]);

    const page = await scope.getObjectSectionPage(project.id, 'facts');

    expect(page?.items).toEqual([
      expect.objectContaining({
        id: factId,
        statement: 'Atlas rollout depends on Northwind approval from Mia Chen.',
        sharedObjects: [
          {
            id: owner.id,
            canonicalName: 'Mia Chen',
            type: 'person',
            role: 'subject, topic',
          },
          {
            id: customer.id,
            canonicalName: 'Northwind',
            type: 'company',
            role: 'object',
          },
        ],
      }),
    ]);
  });
});

describe('object scope — merge cleanup', () => {
  it('merges compatible objects, moves derived rows, dedupes edges, and hides merged rows', async () => {
    const workspace = withTeam(db, TEAM_A, USER_OWNER);
    const scope = workspace.objects;
    const survivor = await scope.createObject({
      type: 'company',
      canonicalName: 'PwC',
      aliases: ['PricewaterhouseCoopers'],
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const typo = await scope.createObject({
      type: 'company',
      canonicalName: 'PVC',
      aliases: ['P.W.C.'],
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const vendor = await scope.createObject({
      type: 'vendor',
      canonicalName: 'PwC Finland',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const related = await scope.createObject({
      type: 'project',
      canonicalName: 'Audit rollout',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Follow up with PwC',
      parentObjectId: typo.id,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const board = await workspace.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [
        { name: 'Discussed', kind: 'active' },
        { name: 'Contract signed', kind: 'done' },
      ],
    });
    const survivorCard = await workspace.boards.addBoardItem(board.id, {
      entityId: survivor.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const typoCardDueAt = new Date('2026-11-05T11:00:00.000Z');
    const typoCard = await workspace.boards.addBoardItem(board.id, {
      entityId: typo.id,
      laneId: board.lanes[1]?.id ?? null,
      responsibleUserId: USER_MEMBER,
      dueAt: typoCardDueAt,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [typoDueEventBeforeMerge] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_A));
    expect(typoDueEventBeforeMerge).toEqual(
      expect.objectContaining({
        startAt: typoCardDueAt,
        deletedAt: null,
      }),
    );
    const [staleTypoObjectDueEvent] = await db
      .insert(calendarEvents)
      .values({
        teamId: TEAM_A,
        createdByUserId: USER_OWNER,
        title: 'Due: PVC',
        startAt: new Date('2026-11-06T11:00:00.000Z'),
        endAt: new Date('2026-11-06T11:30:00.000Z'),
        timezone: 'UTC',
        metadata: {
          kind: 'due_date',
          source: 'object',
          entity_id: typo.id,
        },
      })
      .returning();
    if (!staleTypoObjectDueEvent) throw new Error('Failed to insert object due event');

    await scope.addRelationship({
      fromEntityId: survivor.id,
      toEntityId: related.id,
      kind: 'related',
      actorUserId: USER_OWNER,
    });
    await scope.addRelationship({
      fromEntityId: typo.id,
      toEntityId: related.id,
      kind: 'related',
      actorUserId: USER_OWNER,
    });
    await scope.createNote({
      entityId: typo.id,
      body: 'Duplicate spelling from capture',
      authorUserId: USER_OWNER,
    });
    await scope.createNote({
      entityId: survivor.id,
      body: 'Existing survivor note',
      authorUserId: USER_OWNER,
    });
    const event = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'system',
        contentText: 'PwC evidence',
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    const eventId = event[0]?.id;
    if (!eventId) throw new Error('Failed to insert test raw event');
    const fact = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: eventId,
        statement: 'PVC is PwC',
        confidence: 0.9,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    const factId = fact[0]?.id;
    if (!factId) throw new Error('Failed to insert test fact');
    await db.insert(factEntities).values({
      factId,
      entityId: typo.id,
      role: 'subject',
    });
    const survivorFact = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: eventId,
        statement: 'PwC is already known',
        confidence: 0.9,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    const survivorFactId = survivorFact[0]?.id;
    if (!survivorFactId) throw new Error('Failed to insert survivor test fact');
    await db.insert(factEntities).values({
      factId: survivorFactId,
      entityId: survivor.id,
      role: 'subject',
    });

    const preview = await scope.getObjectMergePreview(
      [survivor.id, typo.id, vendor.id],
      survivor.id,
    );
    expect(preview.survivorId).toBe(survivor.id);
    expect(preview.aliasesToAdd).toEqual(expect.arrayContaining(['PVC', 'P.W.C.', 'PwC Finland']));
    expect(preview.counts).toMatchObject({ facts: 2, notes: 2, relationships: 3, openTasks: 1 });
    expect(preview.countsBySurvivorId[survivor.id]).toMatchObject({
      facts: 2,
      notes: 2,
      relationships: 3,
      openTasks: 1,
    });
    expect(preview.countsBySurvivorId[typo.id]).toEqual(preview.countsBySurvivorId[survivor.id]);
    expect(preview.factSamplesByObjectId[survivor.id]).toEqual([
      expect.objectContaining({ statement: 'PwC is already known' }),
    ]);
    expect(preview.factSamplesByObjectId[typo.id]).toEqual([
      expect.objectContaining({ statement: 'PVC is PwC' }),
    ]);

    await expect(
      scope.mergeObjects({
        survivorId: survivor.id,
        mergedIds: [typo.id, vendor.id],
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).resolves.toMatchObject({ mergedIds: [typo.id, vendor.id] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(qdrantFakes.deletePointsForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        scope: 'object',
        sourceId: typo.id,
      }),
    );
    expect(qdrantFakes.deletePointsForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        scope: 'entity',
        sourceId: typo.id,
      }),
    );
    expect(qdrantFakes.deletePointsForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        scope: 'object',
        sourceId: vendor.id,
      }),
    );
    expect(qdrantFakes.deletePointsForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        scope: 'entity',
        sourceId: vendor.id,
      }),
    );
    expect(qdrantFakes.deletePoints).toHaveBeenCalled();

    await expect(scope.listObjects({ archived: false })).resolves.not.toContainEqual(
      expect.objectContaining({ id: typo.id }),
    );
    await expect(scope.getMergedObjectTarget(typo.id)).resolves.toMatchObject({ id: survivor.id });
    const detail = await scope.getObject(survivor.id);
    expect(detail?.aliases).toEqual(
      expect.arrayContaining(['PricewaterhouseCoopers', 'PVC', 'P.W.C.', 'PwC Finland']),
    );
    expect(detail?.openTasks).toEqual([expect.objectContaining({ id: task.id })]);

    const factLinks = await db.select().from(factEntities).where(eq(factEntities.factId, factId));
    expect(factLinks).toEqual([
      expect.objectContaining({ entityId: survivor.id, role: 'subject' }),
    ]);

    const rels = await db
      .select()
      .from(entityRelationships)
      .where(eq(entityRelationships.teamId, TEAM_A));
    const [expectedRelFrom, expectedRelTo] = [survivor.id, related.id].sort();
    expect(
      rels.filter(
        (rel) =>
          rel.fromEntityId === expectedRelFrom &&
          rel.toEntityId === expectedRelTo &&
          rel.kind === 'related',
      ),
    ).toHaveLength(1);
    expect(rels).not.toContainEqual(expect.objectContaining({ fromEntityId: typo.id }));

    const changeRows = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, survivor.id));
    expect(changeRows.map((row) => row.field)).toEqual(
      expect.arrayContaining(['__merge__', '__merged_from__', '__note_create__']),
    );
    expect(
      changeRows
        .filter((row) => ['__merge__', '__merged_from__'].includes(row.field))
        .every((row) => row.sourceEventId === null),
    ).toBe(true);
    const mergeEventRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_A));
    const mergeEvent = mergeEventRows.find(
      (row) => (row.sourceMetadata as { kind?: string } | null)?.kind === 'object_merge',
    );
    expect(mergeEvent?.id).toEqual(expect.any(String));
    const mergeOutputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, survivor.id));
    const mergeOutput = mergeOutputs.find((output) => output.operation === 'merge');
    expect(mergeOutput).toMatchObject({
      outputKind: 'direct_write',
      targetKind: 'object',
      operation: 'merge',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
    });
    expect(mergeOutput?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'system',
        rawEventId: mergeEvent?.id,
      }),
    ]);
    const mergeSourceRefs = mergeOutput?.sourceRefs as
      | { sourcePayloadRef?: string | null }[]
      | undefined;
    const mergeSourceRef = mergeSourceRefs?.[0];
    expect(mergeSourceRef?.sourcePayloadRef).toMatch(
      /^inline:\/\/timeline\/system\/object_merge\//,
    );
    expect(mergeOutput?.sourcePayloadRefs).toEqual([
      expect.stringMatching(/^inline:\/\/timeline\/system\/object_merge\//),
    ]);
    expect(mergeOutput?.payload).toMatchObject({
      source: 'system',
      system_event_kind: 'object_merge',
      object_type: 'company',
      canonical_name: 'PwC',
      actor_kind: 'user',
      actor_user_id: USER_OWNER,
      merged_entity_ids: [typo.id, vendor.id],
      merged_objects: [
        expect.objectContaining({ id: typo.id, canonicalName: 'PVC', type: 'company' }),
        expect.objectContaining({ id: vendor.id, canonicalName: 'PwC Finland', type: 'vendor' }),
      ],
    });
    expect(mergeOutput?.authorityDecision).toMatchObject({
      decision: 'direct_write',
      authority_decision: 'direct',
      source: 'system',
      target_kind: 'object',
      target_field: '__merge__',
    });
    const cardRows = await db.select().from(boardItems).where(eq(boardItems.boardId, board.id));
    expect(cardRows.filter((row) => !row.archivedAt)).toEqual([
      expect.objectContaining({ id: survivorCard.id, entityId: survivor.id }),
    ]);
    const archivedTypoCard = cardRows.find((row) => row.id === typoCard.id);
    expect(archivedTypoCard?.entityId).toBe(survivor.id);
    expect(archivedTypoCard?.archivedAt).toBeInstanceOf(Date);
    const [typoDueEventAfterMerge] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, typoDueEventBeforeMerge?.id ?? ''));
    expect(typoDueEventAfterMerge?.deletedAt).toBeInstanceOf(Date);
    const [staleTypoObjectDueEventAfterMerge] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, staleTypoObjectDueEvent.id));
    expect(staleTypoObjectDueEventAfterMerge?.deletedAt).toBeInstanceOf(Date);
    const boardHistoryRows = await db
      .select()
      .from(boardItemChanges)
      .where(eq(boardItemChanges.boardId, board.id));
    expect(boardHistoryRows.every((row) => row.entityId !== typo.id)).toBe(true);

    const finalSurvivor = await scope.createObject({
      type: 'company',
      canonicalName: 'PwC Global',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [calendarLinkedToLoser, calendarLinkedToBoth] = await db
      .insert(calendarEvents)
      .values([
        {
          teamId: TEAM_A,
          createdByUserId: USER_OWNER,
          title: 'PwC cleanup review',
          startAt: new Date('2026-06-12T09:00:00Z'),
          endAt: new Date('2026-06-12T10:00:00Z'),
          timezone: 'UTC',
          metadata: {},
        },
        {
          teamId: TEAM_A,
          createdByUserId: USER_OWNER,
          title: 'PwC duplicate link review',
          startAt: new Date('2026-06-13T09:00:00Z'),
          endAt: new Date('2026-06-13T10:00:00Z'),
          timezone: 'UTC',
          metadata: {},
        },
      ])
      .returning({ id: calendarEvents.id });
    if (!calendarLinkedToLoser || !calendarLinkedToBoth) {
      throw new Error('Failed to insert calendar events');
    }
    await db.insert(calendarEventEntities).values([
      {
        calendarEventId: calendarLinkedToLoser.id,
        entityId: survivor.id,
        teamId: TEAM_A,
      },
      {
        calendarEventId: calendarLinkedToBoth.id,
        entityId: survivor.id,
        teamId: TEAM_A,
      },
      {
        calendarEventId: calendarLinkedToBoth.id,
        entityId: finalSurvivor.id,
        teamId: TEAM_A,
      },
    ]);

    await expect(
      scope.mergeObjects({
        survivorId: finalSurvivor.id,
        mergedIds: [survivor.id],
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).resolves.toMatchObject({ survivor: { id: finalSurvivor.id }, mergedIds: [survivor.id] });
    await expect(scope.getMergedObjectTarget(typo.id)).resolves.toMatchObject({
      id: finalSurvivor.id,
    });

    const calendarLinks = await db
      .select()
      .from(calendarEventEntities)
      .where(
        inArray(calendarEventEntities.calendarEventId, [
          calendarLinkedToLoser.id,
          calendarLinkedToBoth.id,
        ]),
      );
    expect(calendarLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          calendarEventId: calendarLinkedToLoser.id,
          entityId: finalSurvivor.id,
        }),
        expect.objectContaining({
          calendarEventId: calendarLinkedToBoth.id,
          entityId: finalSurvivor.id,
        }),
      ]),
    );
    expect(
      calendarLinks.filter((link) => link.calendarEventId === calendarLinkedToBoth.id),
    ).toHaveLength(1);
  });

  it('blocks task merges and cross-team ids', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const otherScope = withTeam(db, TEAM_B, USER_OTHER_TEAM).objects;
    const first = await scope.createObject({
      type: 'task',
      canonicalName: 'One task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const second = await scope.createObject({
      type: 'task',
      canonicalName: 'Another task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const otherTeamObject = await otherScope.createObject({
      type: 'company',
      canonicalName: 'Other team company',
      actor: { kind: 'user', userId: USER_OTHER_TEAM },
    });

    await expect(
      scope.mergeObjects({
        survivorId: first.id,
        mergedIds: [second.id],
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).rejects.toThrow('Only same-type objects can be merged');
    await expect(
      scope.mergeObjects({
        survivorId: first.id,
        mergedIds: [otherTeamObject.id],
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).rejects.toThrow('One or more objects no longer exists');
  });

  it('queues summaries only from sufficient team-visible object memory', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const [privateEvent] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'web',
        contentText: 'DFK private note',
        occurredAt: new Date('2026-06-01T10:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_OWNER,
      })
      .returning({ id: rawEvents.id });
    if (!privateEvent) throw new Error('failed to insert private event');
    const [privateFact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: privateEvent.id,
        statement: 'DFK has private evidence.',
        confidence: 1,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!privateFact) throw new Error('failed to insert private fact');
    await db.insert(factEntities).values({
      factId: privateFact.id,
      entityId: object.id,
      role: 'subject',
    });

    await expect(
      scope.enqueueObjectSummaryRefresh(object.id, { trigger: 'manual' }),
    ).resolves.toMatchObject({ canGenerate: false, reason: 'not_enough_object_memory' });

    const [teamEvent] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'web',
        contentText: 'DFK team-visible planning',
        occurredAt: new Date('2026-06-02T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    if (!teamEvent) throw new Error('failed to insert team event');
    const teamFacts = await db
      .insert(facts)
      .values([
        {
          teamId: TEAM_A,
          rawEventId: teamEvent.id,
          statement: 'DFK is discussing a pilot.',
          confidence: 1,
          modelVersion: 'test',
        },
        {
          teamId: TEAM_A,
          rawEventId: teamEvent.id,
          statement: 'DFK meeting is confirmed for June 30.',
          confidence: 1,
          modelVersion: 'test',
        },
      ])
      .returning({ id: facts.id });
    await db.insert(factEntities).values(
      teamFacts.map((fact) => ({
        factId: fact.id,
        entityId: object.id,
        role: 'subject' as const,
      })),
    );

    await expect(
      scope.enqueueObjectSummaryRefresh(object.id, { trigger: 'manual' }),
    ).resolves.toMatchObject({ canGenerate: true, enqueued: true });
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'manual' },
      {},
    );
  });

  it('does not mark summaries pending when manual enqueue fails', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'web',
        contentText: 'DFK team-visible planning',
        occurredAt: new Date('2026-06-02T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    if (!event) throw new Error('failed to insert event');
    const teamFacts = await db
      .insert(facts)
      .values([
        {
          teamId: TEAM_A,
          rawEventId: event.id,
          statement: 'DFK is discussing a pilot.',
          confidence: 1,
          modelVersion: 'test',
        },
        {
          teamId: TEAM_A,
          rawEventId: event.id,
          statement: 'DFK meeting is confirmed for June 30.',
          confidence: 1,
          modelVersion: 'test',
        },
      ])
      .returning({ id: facts.id });
    await db.insert(factEntities).values(
      teamFacts.map((fact) => ({
        factId: fact.id,
        entityId: object.id,
        role: 'subject' as const,
      })),
    );
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'ready',
      summary: {
        overview: 'DFK is in discovery.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK is in discovery.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'old-fingerprint',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockRejectedValueOnce(new Error('redis down'));

    await expect(
      scope.enqueueObjectSummaryRefresh(object.id, { trigger: 'manual' }),
    ).rejects.toThrow('redis down');

    const rows = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(rows[0]?.status).toBe('ready');
    expect(rows[0]?.plainText).toBe('DFK is in discovery.');
  });

  it('refreshes parent object summaries when a linked task changes', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const parent = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Send DFK proposal',
      parentObjectId: parent.id,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockClear();

    await scope.updateObject(task.id, { status: 'doing' }, { kind: 'user', userId: USER_OWNER });

    await vi.waitFor(() => {
      expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
        { teamId: TEAM_A, objectId: task.id, trigger: 'auto' },
        { delayMs: 120_000 },
      );
      expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
        { teamId: TEAM_A, objectId: parent.id, trigger: 'auto' },
        { delayMs: 120_000 },
      );
    });
  });

  it('does not block object updates on automatic summary refresh enqueue', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await vi.waitFor(() => {
      expect(queue.enqueueObjectSummaryJob).toHaveBeenCalled();
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockClear();
    let resolveSummaryJob: ((value: { enqueued: boolean; jobId: string }) => void) | undefined;
    vi.mocked(queue.enqueueObjectSummaryJob).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSummaryJob = resolve;
        }),
    );
    const updatePromise = scope.updateObject(
      object.id,
      { status: 'active' },
      { kind: 'user', userId: USER_OWNER },
    );

    try {
      await vi.waitFor(() => {
        expect(queue.enqueueObjectSummaryJob).toHaveBeenCalled();
      });
      await expect(
        Promise.race([
          updatePromise,
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('update waited for summary refresh'));
            }, 100);
          }),
        ]),
      ).resolves.toMatchObject({ object: { id: object.id }, changedFields: ['status'] });
    } finally {
      vi.mocked(queue.enqueueObjectSummaryJob).mockResolvedValue({
        enqueued: true,
        jobId: 'summary-job',
      });
      if (resolveSummaryJob) {
        resolveSummaryJob({ enqueued: true, jobId: 'summary-job' });
      }
      await updatePromise.catch(() => undefined);
      await flushBackgroundWork();
    }
  });

  it('marks an existing summary stale when an automatic refresh is requested', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockClear();
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'ready',
      summary: {
        overview: 'DFK is in discovery.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK is in discovery.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'old-fingerprint',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
    });

    await scope.updateObject(object.id, { status: 'active' }, { kind: 'user', userId: USER_OWNER });

    await vi.waitFor(async () => {
      const rows = await db
        .select()
        .from(objectSummaries)
        .where(eq(objectSummaries.entityId, object.id));
      expect(rows[0]?.status).toBe('stale');
      expect(rows[0]?.staleAt).toBeInstanceOf(Date);
      expect(rows[0]?.plainText).toBe('DFK is in discovery.');
    });
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });

  it('uses generator source windows for object detail summary eligibility', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const base = Date.parse('2026-06-02T10:00:00.000Z');
    await db.insert(objectNotes).values([
      {
        teamId: TEAM_A,
        entityId: object.id,
        authorUserId: USER_OWNER,
        body: 'This older note is long enough to generate a summary, but it is outside the top eight note source window.',
        createdAt: new Date(base),
        updatedAt: new Date(base),
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        teamId: TEAM_A,
        entityId: object.id,
        authorUserId: USER_OWNER,
        body: `short ${index}`,
        createdAt: new Date(base + (index + 1) * 1000),
        updatedAt: new Date(base + (index + 1) * 1000),
      })),
    ]);

    const detail = await scope.getObject(object.id);

    expect(detail?.notes).toHaveLength(9);
    expect(detail?.summary?.canGenerate).toBe(false);
    expect(detail?.summary?.cannotGenerateReason).toBe('not_enough_object_memory');
  });

  it('does not count legacy object-change source_event_id rows as summary change sources', async () => {
    const workspace = withTeam(db, TEAM_A, USER_OWNER);
    const object = await workspace.objects.createObject({
      type: 'company',
      canonicalName: 'Legacy Summary Co',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const legacyEvent = await workspace.timeline.createEvent({
      authorUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'Legacy object change source pointer.',
      visibility: 'team',
    });

    await withHistoricalLegacyObjectProvenance(async () => {
      await db.insert(objectChanges).values({
        teamId: TEAM_A,
        entityId: object.id,
        actorKind: 'agent',
        actorUserId: null,
        status: 'applied',
        field: 'stage',
        previousValue: null,
        newValue: 'pilot',
        sourceEventId: legacyEvent.id,
        note: 'Legacy pointer should not feed summary context.',
      });
    });

    const detail = await workspace.objects.getObject(object.id);

    expect(detail?.summary?.sourceCounts.changes).toBe(0);
  });

  it('invalidates object summaries from output source refs, not legacy object-change pointers', async () => {
    const workspace = withTeam(db, TEAM_A, USER_OWNER);
    const object = await workspace.objects.createObject({
      type: 'company',
      canonicalName: 'Output Summary Co',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const task = await workspace.objects.createObject({
      type: 'task',
      canonicalName: 'Refresh output-backed summary',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const legacyEvent = await workspace.timeline.createEvent({
      authorUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'Legacy object summary pointer.',
      visibility: 'team',
    });
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'ready',
      summary: {
        overview: 'Output Summary Co is ready.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'Output Summary Co is ready.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'legacy-pointer-summary',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
    });
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: task.id,
      status: 'ready',
      summary: {
        overview: 'Refresh output-backed summary is queued.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'Refresh output-backed summary is queued.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'task-output-summary',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
    });
    await withHistoricalLegacyObjectProvenance(async () => {
      await db.insert(objectChanges).values({
        teamId: TEAM_A,
        entityId: object.id,
        actorKind: 'agent',
        actorUserId: null,
        status: 'applied',
        field: 'stage',
        previousValue: null,
        newValue: 'pilot',
        sourceEventId: legacyEvent.id,
        note: 'Legacy pointer should not invalidate summaries.',
      });
    });

    await expect(
      invalidateObjectSummariesForRawEvent(db, workspace, legacyEvent.id),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(objectSummaries).where(eq(objectSummaries.entityId, object.id)),
    ).resolves.toHaveLength(1);

    const [run] = await db
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_A,
        trigger: 'manual_repair',
        scope: 'object-summary-output-source-ref',
        status: 'completed',
        inputFingerprint: 'object-summary-output-source-ref',
        engineVersion: 'test-v1',
      })
      .returning({ id: reconciliationRuns.id });
    await db.insert(reconciliationOutputs).values([
      {
        teamId: TEAM_A,
        runId: run?.id ?? '',
        outputKind: 'direct_write',
        targetKind: 'object',
        operation: 'update',
        targetId: object.id,
        payload: { canonical_name: object.canonicalName, status: 'pilot' },
        authorityDecision: { decision: 'authoritative', policy_version: 'test-v1' },
        requiresApproval: false,
        sourceRefs: [{ source: 'telegram', rawEventId: legacyEvent.id }],
        visibility: 'team',
        visibilityFloor: 'team',
        dedupeKey: 'object-summary-output-source-ref',
        status: 'applied',
      },
      {
        teamId: TEAM_A,
        runId: run?.id ?? '',
        outputKind: 'direct_write',
        targetKind: 'task',
        operation: 'update',
        targetId: task.id,
        payload: { canonical_name: task.canonicalName, status: 'open' },
        authorityDecision: { decision: 'authoritative', policy_version: 'test-v1' },
        requiresApproval: false,
        sourceRefs: [{ source: 'telegram', rawEventId: legacyEvent.id }],
        visibility: 'team',
        visibilityFloor: 'team',
        dedupeKey: 'task-summary-output-source-ref',
        status: 'applied',
      },
    ]);

    await expect(
      invalidateObjectSummariesForRawEvent(db, workspace, legacyEvent.id),
    ).resolves.toEqual(expect.arrayContaining([object.id, task.id]));
    await expect(
      db.select().from(objectSummaries).where(eq(objectSummaries.entityId, object.id)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(objectSummaries).where(eq(objectSummaries.entityId, task.id)),
    ).resolves.toHaveLength(0);
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: task.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });

  it('creates a pending summary row when an automatic refresh starts without an existing summary', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockClear();

    await scope.updateObject(object.id, { status: 'active' }, { kind: 'user', userId: USER_OWNER });

    await vi.waitFor(async () => {
      const rows = await db
        .select()
        .from(objectSummaries)
        .where(eq(objectSummaries.entityId, object.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('pending');
      expect(rows[0]?.plainText).toBe('');
    });
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });

  it('marks a pending summary with existing prose stale when memory changes mid-generation', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockClear();
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'pending',
      summary: {
        overview: 'DFK is in discovery.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK is in discovery.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'old-fingerprint',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
      lastAttemptedAt: new Date('2026-06-02T10:06:00.000Z'),
    });

    await scope.updateObject(object.id, { status: 'active' }, { kind: 'user', userId: USER_OWNER });

    await vi.waitFor(async () => {
      const rows = await db
        .select()
        .from(objectSummaries)
        .where(eq(objectSummaries.entityId, object.id));
      expect(rows[0]?.status).toBe('stale');
      expect(rows[0]?.staleAt).toBeInstanceOf(Date);
      expect(rows[0]?.plainText).toBe('DFK is in discovery.');
    });
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });

  it('keeps stale summaries available for object search snippets', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const object = await scope.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'stale',
      summary: {
        overview: 'DFK has a confirmed June 30 pilot discussion.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK has a confirmed June 30 pilot discussion.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'old-fingerprint',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
      staleAt: new Date('2026-06-02T10:10:00.000Z'),
    });

    await expect(scope.listReadyObjectSummaries([object.id])).resolves.toMatchObject([
      {
        entityId: object.id,
        plainText: 'DFK has a confirmed June 30 pilot discussion.',
      },
    ]);
  });

  it('stores generated summaries with validated source refs', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'web',
        contentText: 'DFK team-visible planning',
        occurredAt: new Date('2026-06-02T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    if (!event) throw new Error('failed to insert event');
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: event.id,
        statement: 'DFK meeting is confirmed for June 30.',
        confidence: 1,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!fact) throw new Error('failed to insert fact');
    await db.insert(factEntities).values({
      factId: fact.id,
      entityId: object.id,
      role: 'subject',
    });
    await scope.objects.createNote({
      entityId: object.id,
      authorUserId: USER_OWNER,
      body: 'DFK summary note with enough human-authored context for generation.',
    });

    const enqueueObjectEmbedJob = vi.fn().mockResolvedValue(undefined);

    await expect(
      generateAndStoreObjectSummary(
        db,
        scope,
        object.id,
        { trigger: 'manual' },
        {
          chatStructured: <TSchema extends z.ZodType>(
            input: ChatStructuredInput<TSchema>,
          ): Promise<ChatStructuredResult<TSchema>> =>
            Promise.resolve({
              model: 'test-summary-model',
              object: input.schema.parse({
                overview: 'DFK has a confirmed June 30 meeting.',
                overviewSourceRefs: [{ kind: 'fact', id: fact.id }],
                currentState: [
                  {
                    label: 'Timing',
                    text: 'The meeting is confirmed for June 30.',
                    sourceRefs: [{ kind: 'fact', id: fact.id }],
                  },
                ],
                openQuestions: [],
                conflicts: [],
              }),
            }),
          enqueueObjectEmbedJob,
        },
      ),
    ).resolves.toEqual({ status: 'ready' });

    const rows = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(rows[0]?.status).toBe('ready');
    expect(rows[0]?.model).toBe('test-summary-model');
    expect(rows[0]?.plainText).toContain('confirmed June 30');
  });

  it('fails summary generation instead of storing hallucinated source refs', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Invalid Ref Co',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'web',
        contentText: 'Invalid Ref Co team-visible planning.',
        occurredAt: new Date('2026-06-02T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    if (!event) throw new Error('failed to insert event');
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: event.id,
        statement: 'Invalid Ref Co has enough source-backed planning context.',
        confidence: 1,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!fact) throw new Error('failed to insert fact');
    await db.insert(factEntities).values({
      factId: fact.id,
      entityId: object.id,
      role: 'subject',
    });
    await scope.objects.createNote({
      entityId: object.id,
      authorUserId: USER_OWNER,
      body: 'Invalid Ref Co summary note with enough human-authored context for generation.',
    });
    const enqueueObjectEmbedJob = vi.fn().mockResolvedValue(undefined);

    await expect(
      generateAndStoreObjectSummary(
        db,
        scope,
        object.id,
        { trigger: 'manual' },
        {
          chatStructured: <TSchema extends z.ZodType>(
            input: ChatStructuredInput<TSchema>,
          ): Promise<ChatStructuredResult<TSchema>> =>
            Promise.resolve({
              model: 'test-summary-model',
              object: input.schema.parse({
                overview: 'Invalid Ref Co has source-backed planning context.',
                overviewSourceRefs: [
                  { kind: 'timeline_event', id: '99999999-9999-4999-8999-999999999999' },
                ],
                currentState: [],
                openQuestions: [],
                conflicts: [],
              }),
            }),
          enqueueObjectEmbedJob,
        },
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'invalid_source_ref:timeline_event:99999999-9999-4999-8999-999999999999',
      retryable: false,
    });

    const [summary] = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(summary?.status).toBe('failed');
    expect(summary?.plainText).toBe('');
    expect(summary?.sourceRefs).toEqual([]);
    expect(summary?.lastErrorCode).toBe(
      'invalid_source_ref:timeline_event:99999999-9999-4999-8999-999999999999',
    );
    expect(enqueueObjectEmbedJob).not.toHaveBeenCalled();
  });

  it('lets generated summaries cite reconciliation association evidence', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const object = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Acme rollout',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await db.update(entities).set({ stage: 'implementation' }).where(eq(entities.id, object.id));
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'email',
        contentText: 'Forwarded email: Acme approved rollout implementation.',
        occurredAt: new Date('2026-06-02T10:00:00.000Z'),
        visibility: 'team',
        sourceMetadata: {
          source_payload_ref: 'inline://test/acme-rollout-email',
          payload_digest: 'sha256:acme-rollout-email',
        },
      })
      .returning({ id: rawEvents.id });
    if (!event) throw new Error('failed to insert event');
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_A,
        artifactClusterKind: 'customer_project',
        artifactType: 'project',
        canonicalName: 'Acme rollout',
        canonicalEntityId: object.id,
      })
      .returning({ id: artifactClusters.id });
    if (!cluster) throw new Error('failed to insert cluster');
    const [evidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_A,
        rawEventId: event.id,
        sourcePayloadRef: 'inline://test/acme-rollout-email',
        payloadDigest: 'sha256:acme-rollout-email',
        source: 'email',
        provider: 'email',
        eventType: 'customer_project_update',
        occurredAt: new Date('2026-06-02T10:00:00.000Z'),
        visibility: 'team',
        actor: { kind: 'customer' },
        contentDigest: 'sha256:acme-rollout-content',
        title: 'Acme approved rollout implementation',
        summary: 'Acme approved the rollout implementation plan.',
        metadata: {},
        normalizerVersion: 'summary-test',
        replayState: 'full',
        dedupeKey: 'summary-test-evidence',
      })
      .returning({ id: reconciliationEvidence.id });
    if (!evidence) throw new Error('failed to insert evidence');
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_A,
      clusterId: cluster.id,
      evidenceId: evidence.id,
      rawEventId: event.id,
      role: 'decision',
      strength: 'hard',
      associationSource: 'hard_anchor',
      sourceRefs: [{ source: 'email', rawEventId: event.id, evidenceId: evidence.id }],
      dedupeKey: 'summary-test-association',
    });
    let prompt = '';

    await expect(
      generateAndStoreObjectSummary(
        db,
        scope,
        object.id,
        { trigger: 'manual' },
        {
          chatStructured: <TSchema extends z.ZodType>(
            input: ChatStructuredInput<TSchema>,
          ): Promise<ChatStructuredResult<TSchema>> => {
            prompt = input.prompt;
            return Promise.resolve({
              model: 'test-summary-model',
              object: input.schema.parse({
                overview: 'Acme rollout is in implementation after customer approval.',
                overviewSourceRefs: [{ kind: 'timeline_event', id: event.id }],
                currentState: [
                  {
                    label: 'Customer approval',
                    text: 'Acme approved the implementation plan.',
                    sourceRefs: [{ kind: 'timeline_event', id: event.id }],
                  },
                ],
                openQuestions: [],
                conflicts: [],
              }),
            });
          },
          enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).resolves.toEqual({ status: 'ready' });

    expect(prompt).toContain('Reconciliation decision');
    expect(prompt).toContain('Acme approved the rollout implementation plan.');
    const [summary] = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(summary?.sourceRefs).toEqual([{ kind: 'timeline_event', id: event.id }]);
    expect(summary?.sourceCounts).toMatchObject({ events: 1, facts: 0 });
  });

  it('does not store a generated summary when the object changed during generation', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'web',
        contentText: 'DFK team-visible planning',
        occurredAt: new Date('2026-06-02T10:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    if (!event) throw new Error('failed to insert event');
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: event.id,
        statement: 'DFK meeting is confirmed for June 30.',
        confidence: 1,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!fact) throw new Error('failed to insert fact');
    await db.insert(factEntities).values({
      factId: fact.id,
      entityId: object.id,
      role: 'subject',
    });
    await scope.objects.createNote({
      entityId: object.id,
      authorUserId: USER_OWNER,
      body: 'DFK summary note with enough human-authored context for generation.',
    });
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'pending',
      summary: {
        overview: 'DFK is in discovery.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK is in discovery.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'old-fingerprint',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
      lastAttemptedAt: new Date('2026-06-02T10:06:00.000Z'),
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockClear();

    await expect(
      generateAndStoreObjectSummary(
        db,
        scope,
        object.id,
        { trigger: 'auto' },
        {
          chatStructured: async <TSchema extends z.ZodType>(
            input: ChatStructuredInput<TSchema>,
          ): Promise<ChatStructuredResult<TSchema>> => {
            await db
              .update(objectSummaries)
              .set({
                status: 'stale',
                staleAt: new Date(Date.now() + 60_000),
                updatedAt: new Date(),
              })
              .where(eq(objectSummaries.entityId, object.id));
            return {
              model: 'test-summary-model',
              object: input.schema.parse({
                overview: 'Outdated DFK summary.',
                overviewSourceRefs: [{ kind: 'fact', id: fact.id }],
                currentState: [],
                openQuestions: [],
                conflicts: [],
              }),
            };
          },
          enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).resolves.toEqual({ status: 'skipped', reason: 'stale_during_generation' });

    const rows = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(rows[0]?.status).toBe('stale');
    expect(rows[0]?.plainText).toBe('DFK is in discovery.');
    expect(rows[0]?.plainText).not.toContain('Outdated');
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });

  it('keeps an existing summary visible when a source event becomes team-visible', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const event = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      visibilityOwnerUserId: USER_OWNER,
      source: 'web',
      contentText: 'DFK private planning becomes team-visible',
      occurredAt: new Date('2026-06-02T10:00:00.000Z'),
      visibility: 'private',
    });
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: event.id,
        statement: 'DFK meeting is confirmed for June 30.',
        confidence: 1,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!fact) throw new Error('failed to insert fact');
    await db.insert(factEntities).values({
      factId: fact.id,
      entityId: object.id,
      role: 'subject',
    });
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'ready',
      summary: {
        overview: 'DFK is in discovery.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK is in discovery.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'old-fingerprint',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
    });
    vi.mocked(queue.enqueueObjectSummaryJob).mockClear();

    await scope.timeline.setEventVisibility(event.id, { visibility: 'team' });

    const rows = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(rows[0]?.status).toBe('stale');
    expect(rows[0]?.staleAt).toBeInstanceOf(Date);
    expect(rows[0]?.plainText).toBe('DFK is in discovery.');
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });

  it('removes stored summaries when a cited source event becomes private', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const event = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      visibilityOwnerUserId: USER_OWNER,
      source: 'web',
      contentText: 'DFK team-visible planning',
      occurredAt: new Date('2026-06-02T10:00:00.000Z'),
      visibility: 'team',
    });
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: event.id,
        statement: 'DFK meeting is confirmed for June 30.',
        confidence: 1,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!fact) throw new Error('failed to insert fact');
    await db.insert(factEntities).values({
      factId: fact.id,
      entityId: object.id,
      role: 'subject',
    });
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'ready',
      summary: {
        overview: 'DFK has a confirmed June 30 meeting.',
        overviewSourceRefs: [{ kind: 'fact', id: fact.id }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK has a confirmed June 30 meeting.',
      sourceRefs: [{ kind: 'fact', id: fact.id }],
      sourceCounts: {
        fields: 2,
        facts: 1,
        events: 1,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'test-fingerprint',
      model: 'test-summary-model',
      promptVersion: 'object-summary-v1',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
    });

    await scope.timeline.setEventVisibility(event.id, { visibility: 'private' });

    const rows = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(rows).toHaveLength(0);
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });

  it('removes stored summaries when a cited source event is tombstoned', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const event = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      visibilityOwnerUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'DFK team-visible planning',
      occurredAt: new Date('2026-06-02T10:00:00.000Z'),
      visibility: 'team',
      sourceMetadata: {
        tg_chat_id: 42,
        tg_chat_type: 'private',
        tg_message_id: 10,
        tg_update_id: 123,
      },
    });
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_A,
        rawEventId: event.id,
        statement: 'DFK meeting is confirmed for June 30.',
        confidence: 1,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!fact) throw new Error('failed to insert fact');
    await db.insert(factEntities).values({
      factId: fact.id,
      entityId: object.id,
      role: 'subject',
    });
    await upsertObjectSummary({
      teamId: TEAM_A,
      entityId: object.id,
      status: 'ready',
      summary: {
        overview: 'DFK has a confirmed June 30 meeting.',
        overviewSourceRefs: [{ kind: 'fact', id: fact.id }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK has a confirmed June 30 meeting.',
      sourceRefs: [{ kind: 'fact', id: fact.id }],
      sourceCounts: {
        fields: 2,
        facts: 1,
        events: 1,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'test-fingerprint',
      model: 'test-summary-model',
      promptVersion: 'object-summary-v1',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
    });

    await expect(scope.timeline.removeTelegramMessage(event.id)).resolves.toBe(true);

    const rows = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(rows).toHaveLength(0);
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: object.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
  });
});
