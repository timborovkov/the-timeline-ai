import {
  boardItemChanges,
  boardItems,
  boardLanes,
  boards,
  calendarEvents,
  entities,
  notifications,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  type Db,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PGlite } from '@electric-sql/pglite';

import {
  buildBoardDirectWriteSourceContext,
  defaultBoardLanes,
  defaultBoardRecommendedTypes,
} from '#src/boards/index.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

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

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_MEMBER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_OTHER_TEAM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let pg: PGlite;
let db: Db;
let testDb: ResettablePGliteTestDb;

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

async function setBoardUpdatedAt(boardId: string, updatedAt: Date): Promise<void> {
  await db.update(boards).set({ updatedAt }).where(eq(boards.id, boardId));
}

async function boardUpdatedAt(boardId: string): Promise<Date> {
  const [row] = await db
    .select({ updatedAt: boards.updatedAt })
    .from(boards)
    .where(eq(boards.id, boardId));
  if (!row) throw new Error('Board not found');
  return row.updatedAt;
}

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(seedWorkspace);
  pg = testDb.pg;
  db = drizzle(pg) as unknown as Db;
}, 60_000);

async function withHistoricalLegacyObjectProvenance<T>(run: () => Promise<T>): Promise<T> {
  await pg.exec(`
    ALTER TABLE entities DISABLE TRIGGER entities_legacy_provenance_write_guard;
  `);
  try {
    return await run();
  } finally {
    await pg.exec(`
      ALTER TABLE entities ENABLE TRIGGER entities_legacy_provenance_write_guard;
    `);
  }
}

async function withHistoricalLegacyBoardProvenance<T>(run: () => Promise<T>): Promise<T> {
  await pg.exec(`
    ALTER TABLE board_item_changes DROP CONSTRAINT board_item_changes_legacy_source_event_id_null_chk;
  `);
  try {
    return await run();
  } finally {
    await pg.exec(`
      ALTER TABLE board_item_changes ADD CONSTRAINT board_item_changes_legacy_source_event_id_null_chk CHECK (source_event_id IS NULL) NOT VALID;
    `);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  qdrantFakes.getQdrantClient.mockReturnValue({
    deletePoints: qdrantFakes.deletePoints,
    deletePointsForSource: qdrantFakes.deletePointsForSource,
  });
  await testDb.reset();
});

afterAll(async () => {
  await testDb.close();
});

describe('board scope', () => {
  it('uses generic pipeline lanes by default', () => {
    expect(defaultBoardLanes('pipeline').map((lane) => lane.name)).toEqual([
      'New',
      'Qualified',
      'Scoping',
      'Proposal',
      'Committed',
      'Active',
      'Won',
      'Lost',
    ]);
  });

  it('recommends CRM object types on pipeline boards', () => {
    expect(defaultBoardRecommendedTypes('pipeline')).toEqual([
      'company',
      'deal',
      'person',
      'project',
    ]);
    expect(defaultBoardRecommendedTypes('task_board')).toEqual(['task', 'follow_up']);
    expect(defaultBoardRecommendedTypes('catalog')).toEqual([
      'project',
      'document',
      'vendor',
      'other',
    ]);
    expect(defaultBoardRecommendedTypes('custom')).toEqual([]);
  });

  it('builds direct-write source context from private board evidence visibility', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Private board status change from Sentry incident.',
        occurredAt: new Date('2026-07-01T11:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_OWNER,
        sourceMetadata: {
          provider: 'sentry',
          source_payload_ref: 'sentry://issue/board-raw-1',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('expected raw event');

    const [evidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_A,
        rawEventId: raw.id,
        sourcePayloadRef: 'sentry://issue/board-evidence-1',
        source: 'integration',
        provider: 'sentry',
        externalObjectId: 'ISSUE-1',
        externalEventId: 'ISSUE-1:update',
        eventType: 'sentry.issue',
        occurredAt: new Date('2026-07-01T11:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_OWNER,
        actor: {},
        contentDigest: 'board-private-digest',
        normalizerVersion: 'test-normalizer',
        replayState: 'full',
        dedupeKey: 'board-private-dedupe',
      })
      .returning({ id: reconciliationEvidence.id });
    if (!evidence) throw new Error('expected evidence');

    const firstContext = await buildBoardDirectWriteSourceContext({
      db,
      teamId: TEAM_A,
      sourceRawEventId: raw.id,
    });
    expect(firstContext).toEqual({
      sourceRefs: [
        {
          source: 'integration',
          rawEventId: raw.id,
          sourcePayloadRef: 'sentry://issue/board-raw-1',
        },
      ],
      sourcePayloadRefs: ['sentry://issue/board-evidence-1', 'sentry://issue/board-raw-1'],
      visibility: 'private',
      visibilityOwnerUserId: USER_OWNER,
      visibilityUserIds: null,
    });
    expect(firstContext.sourceRefs[0]).not.toHaveProperty('evidenceId');

    await db.insert(reconciliationEvidence).values({
      teamId: TEAM_A,
      rawEventId: raw.id,
      sourcePayloadRef: 'sentry://issue/board-evidence-2',
      source: 'integration',
      provider: 'sentry',
      externalObjectId: 'ISSUE-1',
      externalEventId: 'ISSUE-1:update:v2',
      eventType: 'sentry.issue',
      occurredAt: new Date('2026-07-01T11:00:00.000Z'),
      visibility: 'private',
      visibilityOwnerUserId: USER_OWNER,
      actor: {},
      contentDigest: 'board-private-digest-v2',
      normalizerVersion: 'test-normalizer-v2',
      replayState: 'full',
      dedupeKey: 'board-private-dedupe-v2',
    });

    const secondContext = await buildBoardDirectWriteSourceContext({
      db,
      teamId: TEAM_A,
      sourceRawEventId: raw.id,
    });
    expect(secondContext.sourceRefs).toEqual(firstContext.sourceRefs);
    expect(secondContext.sourceRefs[0]).not.toHaveProperty('evidenceId');
  });

  it('falls back to raw-event visibility for board direct writes without evidence', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Monday board item moved for selected viewers.',
        occurredAt: new Date('2026-07-01T11:05:00.000Z'),
        visibility: 'specific_users',
        visibilityUserIds: [USER_OWNER, USER_MEMBER],
        sourceMetadata: {
          provider: 'monday',
          source_payload_ref: 'monday://board/42/item/99',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('expected raw event');

    await expect(
      buildBoardDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: raw.id,
      }),
    ).resolves.toEqual({
      sourceRefs: [
        {
          source: 'integration',
          rawEventId: raw.id,
          sourcePayloadRef: 'monday://board/42/item/99',
        },
      ],
      sourcePayloadRefs: ['monday://board/42/item/99'],
      visibility: 'specific_users',
      visibilityOwnerUserId: null,
      visibilityUserIds: [USER_OWNER, USER_MEMBER],
    });
  });

  it('rejects board direct-write source refs that are missing from the scoped team', async () => {
    const [otherTeamRaw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_B,
        authorUserId: USER_OTHER_TEAM,
        source: 'integration',
        contentText: 'Other team board source event.',
        occurredAt: new Date('2026-07-01T11:10:00.000Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'monday',
          source_payload_ref: 'monday://other-team/board/1/item/2',
        },
      })
      .returning({ id: rawEvents.id });
    if (!otherTeamRaw) throw new Error('expected raw event');

    await expect(
      buildBoardDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: otherTeamRaw.id,
      }),
    ).rejects.toThrow('Source raw event not found for team');

    await expect(
      buildBoardDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toThrow('Source raw event not found for team');
  });

  it('rejects board direct-write source refs without a replay payload ref', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_A,
        authorUserId: USER_OWNER,
        source: 'integration',
        contentText: 'Legacy board source event without replay metadata.',
        occurredAt: new Date('2026-07-01T11:20:00.000Z'),
        visibility: 'team',
        sourceMetadata: { provider: 'legacy' },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('expected raw event');

    await expect(
      buildBoardDirectWriteSourceContext({
        db,
        teamId: TEAM_A,
        sourceRawEventId: raw.id,
      }),
    ).rejects.toThrow('Source raw event is missing a replay payload ref');
  });

  it('keeps board items team-scoped and rejects objects from other teams', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const other = withTeam(db, TEAM_B, USER_OTHER_TEAM);
    const board = await owner.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Discussed', kind: 'active' }],
    });
    const otherObject = await other.objects.createObject({
      type: 'company',
      canonicalName: 'Other Corp',
      actor: { kind: 'user', userId: USER_OTHER_TEAM },
    });

    await expect(
      owner.boards.addBoardItem(board.id, {
        entityId: otherObject.id,
        laneId: board.lanes[0]?.id ?? null,
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).rejects.toThrow('Object not in this team');
  });

  it('rejects archived objects before creating a board item', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Active work only',
      templateKind: 'custom',
      lanes: [],
    });
    const object = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Archived candidate',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await scope.objects.archiveObject(object.id, { kind: 'user', userId: USER_OWNER });

    await expect(
      scope.boards.addBoardItem(board.id, {
        entityId: object.id,
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).rejects.toThrow('Archived objects cannot be added to boards');
  });

  it('adds a board item once and writes history for moves', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Development tasks',
      templateKind: 'task_board',
      lanes: [
        { name: 'Todo', kind: 'active' },
        { name: 'Blocked', kind: 'blocked' },
      ],
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Ship Boards 2.0',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: task.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await expect(
      scope.boards.addBoardItem(board.id, {
        entityId: task.id,
        actor: { kind: 'user', userId: USER_OWNER },
      }),
    ).rejects.toThrow();

    await scope.boards.updateBoardItem(
      item.id,
      { laneId: board.lanes[1]?.id ?? null, priority: 2 },
      { kind: 'user', userId: USER_OWNER },
    );

    const changes = await db
      .select()
      .from(boardItemChanges)
      .where(eq(boardItemChanges.boardItemId, item.id));
    expect(changes.map((change) => change.field).sort()).toEqual(['__add__', 'laneId', 'priority']);
    expect(changes.every((change) => change.sourceEventId === null)).toBe(true);

    const outputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, item.id));
    expect(outputs).toHaveLength(2);

    const membershipOutput = outputs.find(
      (output) => output.targetKind === 'board_membership' && output.operation === 'create',
    );
    const updateOutput = outputs.find(
      (output) => output.targetKind === 'board_item_update' && output.operation === 'update',
    );
    expect(membershipOutput).toMatchObject({
      outputKind: 'direct_write',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
    });
    expect(updateOutput).toMatchObject({
      outputKind: 'direct_write',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
    });
    expect(updateOutput?.payload).toMatchObject({
      system_event_kind: 'board_item_update',
      changed_fields: ['laneId', 'priority'],
    });
    expect(updateOutput?.authorityDecision).toMatchObject({
      authority_decision: 'direct',
      target_kind: 'board_item_update',
      target_field: '__update__',
      changed_fields: ['laneId', 'priority'],
    });

    const updateSourceRef = (
      updateOutput?.sourceRefs as
        | { rawEventId?: string; evidenceId?: string; sourcePayloadRef?: string }[]
        | null
    )?.[0];
    expect(updateSourceRef?.rawEventId).toEqual(expect.any(String));
    expect(updateSourceRef?.evidenceId).toBeUndefined();
    expect(updateSourceRef?.sourcePayloadRef).toEqual(
      expect.stringMatching(/^inline:\/\/timeline\/system\/board_item_update\//),
    );
    expect(updateOutput?.sourcePayloadRefs).toEqual([
      expect.stringMatching(/^inline:\/\/timeline\/system\/board_item_update\//),
    ]);
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, updateSourceRef?.rawEventId ?? ''));
    expect(evidence).toMatchObject({
      rawEventId: updateSourceRef?.rawEventId,
      source: 'system',
      replayState: 'full',
      visibility: 'team',
    });
    expect(evidence?.sourcePayloadRef).toMatch(/^inline:\/\/timeline\/system\/board_item_update\//);
    expect(evidence?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    const [sourceRawEvent] = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.id, updateSourceRef?.rawEventId ?? ''));
    const sourceMetadata = sourceRawEvent?.sourceMetadata as Record<string, unknown> | undefined;
    expect(sourceMetadata?.payload_digest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(sourceMetadata).toMatchObject({
      kind: 'board_item_update',
      source_snapshot: {
        board_item_id: item.id,
        changed_fields: ['laneId', 'priority'],
      },
    });
    await expect(scope.boards.getBoard(board.id, { itemLimit: 'all' })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: item.id, laneId: board.lanes[1]?.id })],
    });
  });

  it('does not expose legacy object agentSuggested flags through board items', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Legacy suggested board',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Legacy suggested board task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await withHistoricalLegacyObjectProvenance(async () => {
      await db
        .update(entities)
        .set({ agentSuggested: true, status: 'suggested' })
        .where(eq(entities.id, task.id));
    });
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: task.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const detail = await scope.boards.getBoard(board.id);

    expect(detail?.items.find((row) => row.id === item.id)?.object).toMatchObject({
      id: task.id,
      status: 'suggested',
      agentSuggested: false,
    });
  });

  it('filters board items by board fields and underlying object fields', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [
        { name: 'New', kind: 'active' },
        { name: 'Lost', kind: 'lost' },
      ],
    });
    const matchingCompany = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Northstar Labs',
      status: 'open',
      assigneeUserId: USER_MEMBER,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const otherCompany = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Other Labs',
      status: 'open',
      assigneeUserId: USER_OWNER,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const firstLane = board.lanes[0];
    const secondLane = board.lanes[1];
    if (!firstLane || !secondLane) throw new Error('seeded board should include two lanes');
    const firstLaneId = firstLane.id;
    const secondLaneId = secondLane.id;

    const matchingItem = await scope.boards.addBoardItem(board.id, {
      entityId: matchingCompany.id,
      laneId: firstLaneId,
      responsibleUserId: USER_MEMBER,
      priority: 1,
      dueAt: new Date('2026-08-04T00:00:00.000Z'),
      nextStep: 'Call finance lead',
      customFields: { segment: 'audit' },
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await scope.boards.addBoardItem(board.id, {
      entityId: otherCompany.id,
      laneId: secondLaneId,
      responsibleUserId: USER_OWNER,
      priority: 2,
      dueAt: null,
      nextStep: 'Wait',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await db
      .update(boardItems)
      .set({
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-20T00:00:00.000Z'),
      })
      .where(eq(boardItems.id, matchingItem.id));

    await expect(
      scope.boards.getBoard(board.id, {
        itemLimit: 'all',
        itemFilter: {
          query: 'finance audit',
          laneId: firstLaneId,
          responsibleUserId: USER_MEMBER,
          priority: 1,
          dueAfter: new Date('2026-08-01T00:00:00.000Z'),
          dueBefore: new Date('2026-08-05T00:00:00.000Z'),
          createdAfter: new Date('2026-07-01T00:00:00.000Z'),
          createdBefore: new Date('2026-07-31T00:00:00.000Z'),
          updatedAfter: new Date('2026-07-15T00:00:00.000Z'),
          updatedBefore: new Date('2026-07-25T00:00:00.000Z'),
          object: {
            type: 'company',
            status: 'open',
            assigneeUserId: USER_MEMBER,
            archived: false,
          },
        },
      }),
    ).resolves.toMatchObject({
      itemCount: 1,
      items: [expect.objectContaining({ id: matchingItem.id })],
    });

    await expect(
      scope.boards.getBoard(board.id, {
        itemLimit: 'all',
        itemFilter: {
          dueDateRange: {
            timezone: 'America/Los_Angeles',
            from: '2026-08-04',
            to: '2026-08-05',
          },
        },
      }),
    ).resolves.toMatchObject({
      itemCount: 1,
      items: [expect.objectContaining({ id: matchingItem.id })],
    });
  });

  it('notifies the responsible user and mirrors board item due dates to the team calendar', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Partnership pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Scoping', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Northstar Labs',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const dueAt = new Date('2026-08-12T10:00:00.000Z');

    const item = await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
      responsibleUserId: USER_MEMBER,
      dueAt,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, company.id));
    expect(inboxRows).toEqual([
      expect.objectContaining({
        userId: USER_MEMBER,
        kind: 'board_item_due',
        summary: 'Northstar Labs on Partnership pipeline — Due · Aug 12, 2026',
      }),
    ]);

    let eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows).toEqual([
      expect.objectContaining({
        title: 'Due: Northstar Labs - member@test.local',
        description:
          'Board: Partnership pipeline\nResponsible: member@test.local\nObject type: company',
        startAt: new Date('2026-08-11T21:00:00.000Z'),
        allDay: true,
        timezone: 'Europe/Helsinki',
        showAs: 'free',
      }),
    ]);
    expect(eventRows[0]?.metadata).toEqual(
      expect.objectContaining({
        kind: 'due_date',
        source: 'board_item',
        board_id: board.id,
        board_item_id: item.id,
      }),
    );
    expect(eventRows[0]?.scheduledRawEventId).toEqual(expect.any(String));
    expect(eventRows[0]?.startAtRawEventId).toEqual(expect.any(String));

    const movedDueAt = new Date('2026-08-13T10:00:00.000Z');
    await scope.boards.updateBoardItem(
      item.id,
      { dueAt: movedDueAt },
      { kind: 'user', userId: USER_OWNER },
    );
    eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.startAt).toEqual(new Date('2026-08-12T21:00:00.000Z'));
    const afterMoveInboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, company.id));
    expect(
      afterMoveInboxRows.filter((row) => row.kind === 'board_item_due' && row.readAt === null),
    ).toEqual([
      expect.objectContaining({
        summary: 'Northstar Labs on Partnership pipeline — Due · Aug 13, 2026',
      }),
    ]);

    await scope.boards.updateBoardItem(
      item.id,
      { responsibleUserId: null },
      { kind: 'user', userId: USER_OWNER },
    );
    const afterUnassignInboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, company.id));
    expect(
      afterUnassignInboxRows.filter((row) => row.kind === 'board_item_due' && row.readAt === null),
    ).toEqual([]);

    const startRawRows = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.id, eventRows[0]?.startAtRawEventId ?? ''));
    expect(startRawRows[0]).toEqual(
      expect.objectContaining({
        occurredAt: new Date('2026-08-12T21:00:00.000Z'),
      }),
    );
    expect(startRawRows[0]?.contentText).toContain('2026-08-12T21:00:00.000Z');
  });

  it('mirrors board item due dates without responsible-person inbox notifications', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Unassigned deadlines',
      templateKind: 'pipeline',
      lanes: [{ name: 'Open', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'No Owner LLC',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const dueAt = new Date('2026-08-20T14:00:00.000Z');

    await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      dueAt,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, company.id));
    expect(inboxRows).toEqual([]);

    const eventRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows).toEqual([
      expect.objectContaining({
        title: 'Due: No Owner LLC',
        description: 'Board: Unassigned deadlines\nObject type: company',
        startAt: new Date('2026-08-19T21:00:00.000Z'),
        allDay: true,
        showAs: 'free',
      }),
    ]);
  });

  it('does not notify for board item due dates when the object is archived', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Archived object board',
      templateKind: 'pipeline',
      lanes: [{ name: 'Open', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Archived Co',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await scope.objects.archiveObject(company.id, { kind: 'user', userId: USER_OWNER });

    await scope.boards.updateBoardItem(
      item.id,
      {
        responsibleUserId: USER_MEMBER,
        dueAt: new Date('2026-08-21T14:00:00.000Z'),
      },
      { kind: 'user', userId: USER_OWNER },
    );

    await expect(
      db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A)),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(notifications).where(eq(notifications.entityId, company.id)),
    ).resolves.toEqual([]);
  });

  it('tombstones board item due-date calendar events when the board is archived', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Archive me',
      templateKind: 'pipeline',
      lanes: [{ name: 'Open', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Calendar Ghost Inc',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      responsibleUserId: USER_MEMBER,
      dueAt: new Date('2026-09-01T09:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    let eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    const calendarEventId = eventRows[0]?.id;
    const rawIds = [eventRows[0]?.scheduledRawEventId, eventRows[0]?.startAtRawEventId].filter(
      (id): id is string => id !== null && id !== undefined,
    );

    await scope.boards.archiveBoard(board.id);

    eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows[0]?.deletedAt).toBeInstanceOf(Date);
    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, company.id));
    expect(inboxRows.find((row) => row.kind === 'board_item_due')?.readAt).toBeInstanceOf(Date);
    const rawRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_A));
    expect(
      rawRows
        .filter((row) => rawIds.includes(row.id))
        .every((row) => (row.sourceMetadata as { deleted?: boolean }).deleted === true),
    ).toBe(true);
    expect(qdrantFakes.deletePointsForSource).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        scope: 'calendar_event',
        sourceId: calendarEventId,
      }),
    );
  });

  it('bumps board activity when items are added, updated, and removed', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Development tasks',
      templateKind: 'task_board',
      lanes: [
        { name: 'Todo', kind: 'active' },
        { name: 'Done', kind: 'done' },
      ],
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Keep pinned boards fresh',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const oldUpdatedAt = new Date('2026-01-01T00:00:00.000Z');

    await setBoardUpdatedAt(board.id, oldUpdatedAt);
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: task.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    expect((await boardUpdatedAt(board.id)).getTime()).toBeGreaterThan(oldUpdatedAt.getTime());

    await setBoardUpdatedAt(board.id, oldUpdatedAt);
    await scope.boards.updateBoardItem(
      item.id,
      { laneId: board.lanes[1]?.id ?? null },
      { kind: 'user', userId: USER_OWNER },
    );
    expect((await boardUpdatedAt(board.id)).getTime()).toBeGreaterThan(oldUpdatedAt.getTime());

    await setBoardUpdatedAt(board.id, oldUpdatedAt);
    await scope.boards.removeBoardItem(item.id, { kind: 'user', userId: USER_OWNER });
    expect((await boardUpdatedAt(board.id)).getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
  });

  it('renames a board inside the active team', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const other = withTeam(db, TEAM_B, USER_OTHER_TEAM);
    const board = await owner.boards.createBoard({
      name: 'Original board',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    const task = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Refresh renamed board metadata',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: task.id,
      laneId: board.lanes[0]?.id ?? null,
      responsibleUserId: USER_MEMBER,
      dueAt: new Date('2026-10-01T09:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const oldUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    await setBoardUpdatedAt(board.id, oldUpdatedAt);

    await expect(owner.boards.renameBoard({ id: board.id, name: 'Renamed board' })).resolves.toBe(
      true,
    );
    await expect(other.boards.renameBoard({ id: board.id, name: 'Wrong team' })).rejects.toThrow(
      'Board not found',
    );

    const [row] = await db
      .select({ name: boards.name, updatedAt: boards.updatedAt })
      .from(boards)
      .where(eq(boards.id, board.id));
    expect(row?.name).toBe('Renamed board');
    expect(row?.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());

    const calendarRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_A));
    expect(calendarRows).toEqual([
      expect.objectContaining({
        description: 'Board: Renamed board\nResponsible: member@test.local\nObject type: task',
      }),
    ]);
    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    const dueNotifications = inboxRows.filter(
      (notification) => notification.kind === 'board_item_due',
    );
    const oldNameNotification = dueNotifications.find(
      (notification) =>
        notification.summary ===
        'Refresh renamed board metadata on Original board — Due · Oct 1, 2026',
    );
    const newNameNotification = dueNotifications.find(
      (notification) =>
        notification.summary ===
        'Refresh renamed board metadata on Renamed board — Due · Oct 1, 2026',
    );
    expect(oldNameNotification?.readAt).toBeInstanceOf(Date);
    expect(newNameNotification?.readAt).toBeNull();
  });

  it('rejects cross-team board item rows at the database boundary', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const other = withTeam(db, TEAM_B, USER_OTHER_TEAM);
    const board = await owner.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Discussed', kind: 'active' }],
    });
    const otherObject = await other.objects.createObject({
      type: 'company',
      canonicalName: 'Other Corp',
      actor: { kind: 'user', userId: USER_OTHER_TEAM },
    });

    await expect(
      db.insert(boardItems).values({
        teamId: TEAM_A,
        boardId: board.id,
        entityId: otherObject.id,
        laneId: board.lanes[0]?.id ?? null,
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid suggested board item values before they become actionable', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await expect(
      scope.boards.proposeBoardItemUpdate({
        boardItemId: item.id,
        field: 'priority',
        newValue: 999,
      }),
    ).rejects.toThrow('Invalid priority');
  });

  it('does not stamp sourceEventId on new suggested board history rows', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'Add Revigo to the pipeline.',
      visibility: 'team',
    });
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const change = await scope.boards.proposeBoardMembership({
      boardId: board.id,
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
      sourceEventId: event.id,
      note: 'Legacy callers may still pass this pointer.',
    });

    expect(change.sourceEventId).toBeNull();
  });

  it('does not expose legacy board source_event_id as hydrated provenance evidence', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'Legacy board history source pointer.',
      visibility: 'team',
    });
    const board = await scope.boards.createBoard({
      name: 'Legacy board',
      templateKind: 'pipeline',
      lanes: [{ name: 'Tracked', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Legacy Co',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await withHistoricalLegacyBoardProvenance(async () => {
      await db.insert(boardItemChanges).values({
        teamId: TEAM_A,
        boardId: board.id,
        boardItemId: item.id,
        entityId: company.id,
        actorKind: 'agent',
        actorUserId: null,
        status: 'applied',
        field: 'laneId',
        previousValue: null,
        newValue: board.lanes[0]?.id ?? null,
        sourceEventId: event.id,
        suggestionItemId: null,
        note: 'Legacy pointer should not become provenance evidence.',
        changedAt: new Date('2026-07-02T10:00:00.000Z'),
      });
    });

    const history = await scope.boards.listBoardItemHistory(item.id);
    const legacyChange = history.find((change) => change.field === 'laneId');

    expect(legacyChange).toEqual(
      expect.objectContaining({
        field: 'laneId',
        sourceEventId: null,
        evidence: [],
      }),
    );
  });

  it('does not leave a board behind when lane creation input is invalid', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);

    await expect(
      scope.boards.createBoard({
        name: 'Broken board',
        templateKind: 'custom',
        lanes: [{ name: '', kind: 'active' }],
      }),
    ).rejects.toThrow('Lane name required');

    const rows = await db.select().from(boards).where(eq(boards.teamId, TEAM_A));
    expect(rows).toHaveLength(0);
  });

  it('updates board settings and moves items out of removed lanes', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Rigid pipeline',
      templateKind: 'pipeline',
      lanes: [
        { name: 'Backlog', kind: 'active' },
        { name: 'Doing', kind: 'active' },
        { name: 'Done', kind: 'done' },
      ],
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Make stages editable',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const removedLaneId = board.lanes[1]?.id;
    if (!removedLaneId) throw new Error('Missing lane');
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: task.id,
      laneId: removedLaneId,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const doneLaneId = board.lanes[2]?.id;
    const backlogLaneId = board.lanes[0]?.id;
    if (!doneLaneId || !backlogLaneId) throw new Error('Missing lanes');

    await expect(
      scope.boards.updateBoardSettings({
        id: board.id,
        name: 'Flexible board',
        purpose: 'Tune stages as work changes',
        lanes: [
          { id: doneLaneId, name: 'Done', kind: 'done' },
          { id: backlogLaneId, name: 'Ideas', kind: 'active' },
          { name: 'Review', kind: 'active' },
        ],
      }),
    ).resolves.toBe(true);

    const updated = await scope.boards.getBoard(board.id, { itemLimit: 'all' });
    expect(updated?.name).toBe('Flexible board');
    expect(updated?.purpose).toBe('Tune stages as work changes');
    expect(updated?.lanes.filter((lane) => !lane.archivedAt).map((lane) => lane.name)).toEqual([
      'Done',
      'Ideas',
      'Review',
    ]);
    expect(updated?.items.find((row) => row.id === item.id)?.laneId).toBeNull();

    const [archivedLane] = await db
      .select()
      .from(boardLanes)
      .where(eq(boardLanes.id, removedLaneId));
    expect(archivedLane?.archivedAt).toBeTruthy();
  });

  it('keeps stale suggested item updates pending when the item is no longer active', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const suggestion = await scope.boards.proposeBoardItemUpdate({
      boardItemId: item.id,
      field: 'priority',
      newValue: 1,
    });

    await scope.boards.removeBoardItem(item.id, { kind: 'user', userId: USER_OWNER });

    await expect(
      scope.boards.acceptBoardItemChange(suggestion.id, { kind: 'user', userId: USER_OWNER }),
    ).rejects.toThrow('Board item no longer active');

    const [change] = await db
      .select()
      .from(boardItemChanges)
      .where(eq(boardItemChanges.id, suggestion.id));
    expect(change?.status).toBe('suggested');

    const outputs = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, item.id));
    const removeOutput = outputs.find(
      (output) =>
        output.targetKind === 'board_membership' && output.operation === 'archive_or_cancel',
    );
    expect(removeOutput).toMatchObject({
      outputKind: 'direct_write',
      status: 'applied',
      requiresApproval: false,
      visibility: 'team',
      visibilityFloor: 'team',
      payload: {
        system_event_kind: 'board_item_remove',
        board_item_id: item.id,
        previous_lane_id: board.lanes[0]?.id ?? null,
      },
    });
    const removeSourceRef = (
      removeOutput?.sourceRefs as
        | { rawEventId?: string; evidenceId?: string; sourcePayloadRef?: string }[]
        | null
    )?.[0];
    expect(removeSourceRef?.rawEventId).toEqual(expect.any(String));
    expect(removeSourceRef?.evidenceId).toBeUndefined();
    expect(removeSourceRef?.sourcePayloadRef).toEqual(
      expect.stringMatching(/^inline:\/\/timeline\/system\/board_item_remove\//),
    );
    expect(removeOutput?.sourcePayloadRefs).toEqual([
      expect.stringMatching(/^inline:\/\/timeline\/system\/board_item_remove\//),
    ]);
  });

  it('accepts board membership suggestions idempotently when the item was already added', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const suggestion = await scope.boards.proposeBoardMembership({
      boardId: board.id,
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
    });
    const item = await scope.boards.addBoardItem(board.id, {
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    await expect(
      scope.boards.acceptBoardItemChange(suggestion.id, { kind: 'user', userId: USER_OWNER }),
    ).resolves.toBe(item.id);

    const changes = await db
      .select()
      .from(boardItemChanges)
      .where(eq(boardItemChanges.id, suggestion.id));
    expect(changes[0]?.status).toBe('applied');
    const itemRows = await db.select().from(boardItems).where(eq(boardItems.entityId, company.id));
    expect(itemRows.filter((row) => !row.archivedAt)).toHaveLength(1);
  });

  it('keeps board membership suggestions pending when cleanup archived their project', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const suggestionItemId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const board = await scope.boards.createBoard({
      name: 'Project delivery',
      templateKind: 'custom',
      lanes: [{ name: 'Planned', kind: 'active' }],
    });
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Abandoned suggested project',
      metadata: { agent_suggestion_project_for_item_id: suggestionItemId },
      actor: { kind: 'agent', userId: null },
    });
    const suggestion = await scope.boards.proposeBoardMembership({
      boardId: board.id,
      entityId: project.id,
      laneId: board.lanes[0]?.id ?? null,
    });
    await expect(
      scope.objects.archiveSuggestedProjectIfUnused(project.id, suggestionItemId, {
        kind: 'agent',
        userId: null,
      }),
    ).resolves.toBe(true);

    await expect(
      scope.boards.acceptBoardItemChange(suggestion.id, { kind: 'user', userId: USER_OWNER }),
    ).rejects.toThrow('Archived suggested projects cannot be added to boards');

    const [change] = await db
      .select({ status: boardItemChanges.status })
      .from(boardItemChanges)
      .where(eq(boardItemChanges.id, suggestion.id));
    expect(change?.status).toBe('suggested');
    const itemRows = await db
      .select({ id: boardItems.id })
      .from(boardItems)
      .where(eq(boardItems.entityId, project.id));
    expect(itemRows).toHaveLength(0);
  });

  it('keeps board membership suggestions pending when their object was archived', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Approval archive race',
      templateKind: 'custom',
      lanes: [],
    });
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Archived before approval',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const suggestion = await scope.boards.proposeBoardMembership({
      boardId: board.id,
      entityId: object.id,
      laneId: null,
    });
    await scope.objects.archiveObject(object.id, { kind: 'user', userId: USER_OWNER });

    await expect(
      scope.boards.acceptBoardItemChange(suggestion.id, { kind: 'user', userId: USER_OWNER }),
    ).rejects.toThrow('Archived objects cannot be added to boards');

    const [persisted] = await db
      .select({ status: boardItemChanges.status })
      .from(boardItemChanges)
      .where(eq(boardItemChanges.id, suggestion.id));
    expect(persisted?.status).toBe('suggested');
  });

  it('accepts board membership suggestions without duplicate add history', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const oldUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    const suggestion = await scope.boards.proposeBoardMembership({
      boardId: board.id,
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
    });

    await setBoardUpdatedAt(board.id, oldUpdatedAt);
    const itemId = await scope.boards.acceptBoardItemChange(suggestion.id, {
      kind: 'user',
      userId: USER_OWNER,
    });

    expect(itemId).not.toBeNull();
    expect((await boardUpdatedAt(board.id)).getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
    if (itemId === null) throw new Error('Expected accepted suggestion to create a board item');

    const changes = await db
      .select()
      .from(boardItemChanges)
      .where(eq(boardItemChanges.boardItemId, itemId));
    expect(
      changes.filter((change) => change.field === '__add__' && change.status === 'applied'),
    ).toHaveLength(1);
    expect(changes[0]?.id).toBe(suggestion.id);
  });

  it('hydrates accepted board suggestion evidence into board item history', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'Add Revigo to the pilot pipeline negotiation lane.',
      visibility: 'team',
    });
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Add Revigo to pilot pipeline',
      dedupeKey: 'board-history-evidence',
      evidence: [{ rawEventId: event.id, quote: 'Add Revigo to the pilot pipeline' }],
      items: [
        {
          operation: 'create',
          targetKind: 'board_membership',
          title: 'Add Revigo to Pilot pipeline',
          dedupeKey: 'board-history-evidence:item',
          proposedPayload: {
            boardId: board.id,
            entityId: company.id,
            laneId: board.lanes[0]?.id ?? null,
            sourceEventId: event.id,
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    const detail = await scope.boards.getBoard(board.id, { itemLimit: 'all' });
    const item = detail?.items[0];
    expect(item).toBeDefined();

    const history = await scope.boards.listBoardItemHistory(item?.id ?? '');

    expect(history[0]).toEqual(
      expect.objectContaining({
        field: '__add__',
        suggestionItemId: bundle.items[0]?.id,
        sourceEventId: null,
        evidence: [
          expect.objectContaining({
            rawEventId: event.id,
            source: 'telegram',
            quote: 'Add Revigo to the pilot pipeline',
            contentText: 'Add Revigo to the pilot pipeline negotiation lane.',
          }),
        ],
      }),
    );
  });

  it('hydrates multi-source output refs into board item history', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const firstEvent = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'Add Revigo to the pilot pipeline.',
      visibility: 'team',
    });
    const secondEvent = await scope.timeline.createEvent({
      authorUserId: USER_OWNER,
      source: 'telegram',
      contentText: 'Add DFK to the pilot pipeline.',
      visibility: 'team',
    });
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Add companies to pilot pipeline',
      dedupeKey: 'board-history-ambiguous-evidence',
      evidence: [
        { rawEventId: firstEvent.id, quote: 'Add Revigo' },
        { rawEventId: secondEvent.id, quote: 'Add DFK' },
      ],
      items: [
        {
          operation: 'create',
          targetKind: 'board_membership',
          title: 'Add Revigo to Pilot pipeline',
          dedupeKey: 'board-history-ambiguous-evidence:item',
          proposedPayload: {
            boardId: board.id,
            entityId: company.id,
            laneId: board.lanes[0]?.id ?? null,
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    const detail = await scope.boards.getBoard(board.id, { itemLimit: 'all' });
    const history = await scope.boards.listBoardItemHistory(detail?.items[0]?.id ?? '');

    expect(history[0]).toEqual(
      expect.objectContaining({
        field: '__add__',
        suggestionItemId: bundle.items[0]?.id,
        sourceEventId: null,
      }),
    );
    expect(history[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawEventId: firstEvent.id,
          source: 'telegram',
          quote: 'Add Revigo',
          contentText: 'Add Revigo to the pilot pipeline.',
        }),
        expect.objectContaining({
          rawEventId: secondEvent.id,
          source: 'telegram',
          quote: 'Add DFK',
          contentText: 'Add DFK to the pilot pipeline.',
        }),
      ]),
    );
    expect(history[0]?.evidence).toHaveLength(2);
  });

  it('does not treat one visible event from a multi-event bundle as unambiguous evidence', async () => {
    const member = withTeam(db, TEAM_A, USER_MEMBER);
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const visibleEvent = await member.timeline.createEvent({
      authorUserId: USER_MEMBER,
      source: 'telegram',
      contentText: 'Add Revigo to the pilot pipeline.',
      visibility: 'team',
    });
    const hiddenEvent = await member.timeline.createEvent({
      authorUserId: USER_MEMBER,
      source: 'telegram',
      contentText: 'Add DFK to the pilot pipeline.',
      visibility: 'private',
    });
    const board = await member.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await member.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_MEMBER },
    });
    const bundle = await member.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Add companies to pilot pipeline',
      dedupeKey: 'board-history-visibility-skew-evidence',
      evidence: [
        { rawEventId: visibleEvent.id, quote: 'Add Revigo' },
        { rawEventId: hiddenEvent.id, quote: 'Add DFK' },
      ],
      items: [
        {
          operation: 'create',
          targetKind: 'board_membership',
          title: 'Add Revigo to Pilot pipeline',
          dedupeKey: 'board-history-visibility-skew-evidence:item',
          proposedPayload: {
            boardId: board.id,
            entityId: company.id,
            laneId: board.lanes[0]?.id ?? null,
          },
        },
      ],
    });

    await expect(member.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    const detail = await owner.boards.getBoard(board.id, { itemLimit: 'all' });
    const history = await owner.boards.listBoardItemHistory(detail?.items[0]?.id ?? '');

    expect(history[0]).toEqual(
      expect.objectContaining({
        field: '__add__',
        suggestionItemId: bundle.items[0]?.id,
        evidence: [],
      }),
    );
  });

  it('returns bounded board item pages with the full active item count', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Development tasks',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });

    for (const name of ['One', 'Two', 'Three']) {
      const task = await scope.objects.createObject({
        type: 'task',
        canonicalName: name,
        actor: { kind: 'user', userId: USER_OWNER },
      });
      await scope.boards.addBoardItem(board.id, {
        entityId: task.id,
        laneId: board.lanes[0]?.id ?? null,
        actor: { kind: 'user', userId: USER_OWNER },
      });
    }

    const detail = await scope.boards.getBoard(board.id, { itemLimit: 1 });
    expect(detail?.itemCount).toBe(3);
    expect(detail?.items).toHaveLength(1);

    const fullDetail = await scope.boards.getBoard(board.id, { itemLimit: 'all' });
    expect(fullDetail?.itemCount).toBe(3);
    expect(fullDetail?.items).toHaveLength(3);
  });

  it('returns board item pages and work queue rows beyond the old 500-row cap', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Expanded task board',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    const laneId = board.lanes[0]?.id;
    if (!laneId) throw new Error('Expected board lane');

    await pg.query(
      `WITH inserted_entities AS (
         INSERT INTO entities (team_id, type, canonical_name, status, aliases, metadata, updated_at)
         SELECT $1, 'task', 'Bulk board task ' || gs::text, 'open', '[]'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00.000Z'::timestamptz + (gs || ' seconds')::interval
         FROM generate_series(1, 501) AS gs
         RETURNING id, canonical_name
       )
       INSERT INTO board_items (team_id, board_id, entity_id, lane_id, position, responsible_user_id)
       SELECT $1, $2, id, $3, row_number() OVER (ORDER BY canonical_name), $4
       FROM inserted_entities`,
      [TEAM_A, board.id, laneId, USER_OWNER],
    );

    const detail = await scope.boards.getBoard(board.id, { itemLimit: 501 });
    expect(detail?.itemCount).toBe(501);
    expect(detail?.items).toHaveLength(501);
    expect(detail?.items.map((item) => item.object.canonicalName)).toContain('Bulk board task 1');

    await expect(
      scope.boards.listWorkQueueItems({
        dueBefore: new Date('2026-06-30T00:00:00.000Z'),
        limit: 501,
      }),
    ).resolves.toHaveLength(501);
  });

  it('keeps pins per user and exposes object board context', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const member = withTeam(db, TEAM_A, USER_MEMBER);
    const board = await owner.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await owner.objects.createObject({
      type: 'company',
      canonicalName: 'Revigo',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: company.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.pins.pin({ kind: 'board', key: board.id });

    await expect(owner.boards.listPinnedBoards()).resolves.toHaveLength(1);
    await expect(member.boards.listPinnedBoards()).resolves.toHaveLength(0);
    await expect(owner.boards.listObjectBoardContext(company.id)).resolves.toMatchObject([
      { boardName: 'Pilot pipeline', laneName: 'Negotiation' },
    ]);

    const itemRows = await db.select().from(boardItems).where(eq(boardItems.entityId, company.id));
    expect(itemRows).toHaveLength(1);
  });

  it('ignores archived objects in pinned board due counts', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const board = await owner.boards.createBoard({
      name: 'Pinned due counts',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    const overdueTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Archived overdue task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const dueSoonTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Archived due soon task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: overdueTask.id,
      dueAt: new Date('2020-01-01T00:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: dueSoonTask.id,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.objects.archiveObject(overdueTask.id, { kind: 'user', userId: USER_OWNER });
    await owner.objects.archiveObject(dueSoonTask.id, { kind: 'user', userId: USER_OWNER });
    await owner.pins.pin({ kind: 'board', key: board.id });

    await expect(owner.boards.listPinnedBoards()).resolves.toEqual([
      expect.objectContaining({
        itemCount: 0,
        laneCounts: [],
        dueSoonCount: 0,
        overdueCount: 0,
      }),
    ]);
  });

  it('counts active pinned board items by due window', async () => {
    const now = new Date('2026-07-20T16:00:00.000Z');
    const timezone = 'America/Los_Angeles';
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const board = await owner.boards.createBoard({
      name: 'Active due counts',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    const overdueTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Overdue active task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const dueSoonTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Due today active task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const fourteenthDayTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Fourteenth day active task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const fifteenthDayTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Fifteenth day active task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const legacyOverdueTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Legacy local-date overdue task',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: overdueTask.id,
      dueAt: new Date('2026-07-19T00:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: dueSoonTask.id,
      dueAt: new Date('2026-07-20T00:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: fourteenthDayTask.id,
      dueAt: new Date('2026-08-03T00:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: fifteenthDayTask.id,
      dueAt: new Date('2026-08-04T00:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: legacyOverdueTask.id,
      dueAt: new Date('2026-07-20T06:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.pins.pin({ kind: 'board', key: board.id });

    await expect(owner.boards.listPinnedBoards({ timezone, now })).resolves.toEqual([
      expect.objectContaining({
        itemCount: 5,
        dueSoonCount: 2,
        overdueCount: 2,
      }),
    ]);
  });

  it('lists work queue board items for responsible and unassigned due work', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const member = withTeam(db, TEAM_A, USER_MEMBER);
    const board = await owner.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [
        { name: 'Scoping', kind: 'active' },
        { name: 'Blocked', kind: 'blocked' },
      ],
    });
    const [responsibleObject, teamDueObject, hiddenObject, teammateDueObject, doneObject] =
      await Promise.all([
        owner.objects.createObject({
          type: 'deal',
          canonicalName: 'Responsible deal',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        owner.objects.createObject({
          type: 'project',
          canonicalName: 'Team due project',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        owner.objects.createObject({
          type: 'task',
          canonicalName: 'Unrelated task',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        owner.objects.createObject({
          type: 'task',
          canonicalName: 'Teammate due task',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        owner.objects.createObject({
          type: 'task',
          canonicalName: 'Completed work',
          status: 'done',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
      ]);

    const responsibleItem = await owner.boards.addBoardItem(board.id, {
      entityId: responsibleObject.id,
      responsibleUserId: USER_OWNER,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const teamDueItem = await owner.boards.addBoardItem(board.id, {
      entityId: teamDueObject.id,
      dueAt: new Date('2026-06-20T00:00:00.000Z'),
      laneId: board.lanes[1]?.id ?? null,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await owner.boards.addBoardItem(board.id, {
      entityId: hiddenObject.id,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const teammateDueItem = await owner.boards.addBoardItem(board.id, {
      entityId: teammateDueObject.id,
      responsibleUserId: USER_MEMBER,
      dueAt: new Date('2026-06-18T00:00:00.000Z'),
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const doneItem = await owner.boards.addBoardItem(board.id, {
      entityId: doneObject.id,
      responsibleUserId: USER_OWNER,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const ownerRows = await owner.boards.listWorkQueueItems({
      dueBefore: new Date('2026-06-30T00:00:00.000Z'),
    });
    expect(ownerRows.map((row) => row.id).sort()).toEqual(
      [responsibleItem.id, teamDueItem.id].sort(),
    );
    expect(ownerRows.map((row) => row.id)).not.toContain(teammateDueItem.id);
    expect(ownerRows.map((row) => row.id)).not.toContain(doneItem.id);
    const teamDueRow = ownerRows.find((row) => row.id === teamDueItem.id);
    expect(teamDueRow?.boardName).toBe('Pilot pipeline');
    expect(teamDueRow?.laneName).toBe('Blocked');
    expect(teamDueRow?.laneKind).toBe('blocked');
    expect(teamDueRow?.responsibleUserId).toBeNull();
    expect(teamDueRow?.object.canonicalName).toBe('Team due project');

    const memberRows = await member.boards.listWorkQueueItems({
      dueBefore: new Date('2026-06-30T00:00:00.000Z'),
    });
    expect(memberRows.map((row) => row.id).sort()).toEqual(
      [teamDueItem.id, teammateDueItem.id].sort(),
    );
  });

  it('excludes archived and cross-team rows from work queue board items', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const other = withTeam(db, TEAM_B, USER_OTHER_TEAM);
    const [activeBoard, archivedBoard, otherBoard] = await Promise.all([
      owner.boards.createBoard({
        name: 'Active board',
        templateKind: 'task_board',
        lanes: [{ name: 'Todo', kind: 'active' }],
      }),
      owner.boards.createBoard({
        name: 'Archived board',
        templateKind: 'task_board',
        lanes: [{ name: 'Todo', kind: 'active' }],
      }),
      other.boards.createBoard({
        name: 'Other board',
        templateKind: 'task_board',
        lanes: [{ name: 'Todo', kind: 'active' }],
      }),
    ]);
    const [activeObject, archivedObject, archivedItemObject, archivedBoardObject, otherObject] =
      await Promise.all([
        owner.objects.createObject({
          type: 'task',
          canonicalName: 'Visible work',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        owner.objects.createObject({
          type: 'task',
          canonicalName: 'Archived object',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        owner.objects.createObject({
          type: 'task',
          canonicalName: 'Archived item',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        owner.objects.createObject({
          type: 'task',
          canonicalName: 'Archived board item',
          actor: { kind: 'user', userId: USER_OWNER },
        }),
        other.objects.createObject({
          type: 'task',
          canonicalName: 'Other work',
          actor: { kind: 'user', userId: USER_OTHER_TEAM },
        }),
      ]);
    const activeItem = await owner.boards.addBoardItem(activeBoard.id, {
      entityId: activeObject.id,
      responsibleUserId: USER_OWNER,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const archivedObjectItem = await owner.boards.addBoardItem(activeBoard.id, {
      entityId: archivedObject.id,
      responsibleUserId: USER_OWNER,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const archivedItem = await owner.boards.addBoardItem(activeBoard.id, {
      entityId: archivedItemObject.id,
      responsibleUserId: USER_OWNER,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const archivedBoardItem = await owner.boards.addBoardItem(archivedBoard.id, {
      entityId: archivedBoardObject.id,
      responsibleUserId: USER_OWNER,
      actor: { kind: 'user', userId: USER_OWNER },
    });
    await other.boards.addBoardItem(otherBoard.id, {
      entityId: otherObject.id,
      responsibleUserId: USER_OTHER_TEAM,
      actor: { kind: 'user', userId: USER_OTHER_TEAM },
    });
    const now = new Date('2026-06-14T00:00:00.000Z');
    await Promise.all([
      db.update(entities).set({ archivedAt: now }).where(eq(entities.id, archivedObject.id)),
      db.update(boardItems).set({ archivedAt: now }).where(eq(boardItems.id, archivedItem.id)),
      db.update(boards).set({ archivedAt: now }).where(eq(boards.id, archivedBoard.id)),
    ]);

    const rows = await owner.boards.listWorkQueueItems({
      dueBefore: new Date('2026-06-30T00:00:00.000Z'),
    });
    expect(rows.map((row) => row.id)).toEqual([activeItem.id]);
    expect(rows.map((row) => row.id)).not.toContain(archivedObjectItem.id);
    expect(rows.map((row) => row.id)).not.toContain(archivedItem.id);
    expect(rows.map((row) => row.id)).not.toContain(archivedBoardItem.id);
  });

  it('keeps responsible null-due board items when due rows exceed limit', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const board = await owner.boards.createBoard({
      name: 'Capacity board',
      templateKind: 'pipeline',
      lanes: [{ name: 'Backlog', kind: 'active' }],
    });

    const teamDueTasks = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        owner.objects.createObject({
          type: 'task',
          canonicalName: `Due teammate task ${String(index + 1).padStart(2, '0')}`,
          actor: { kind: 'user', userId: USER_OWNER },
        }),
      ),
    );
    const responsibleTask = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Owner-only to-do',
      actor: { kind: 'user', userId: USER_OWNER },
    });

    for (const task of teamDueTasks) {
      await owner.boards.addBoardItem(board.id, {
        entityId: task.id,
        dueAt: new Date('2026-06-18T00:00:00.000Z'),
        actor: { kind: 'user', userId: USER_OWNER },
      });
    }

    const responsibleItem = await owner.boards.addBoardItem(board.id, {
      entityId: responsibleTask.id,
      responsibleUserId: USER_OWNER,
      actor: { kind: 'user', userId: USER_OWNER },
    });

    const rows = await owner.boards.listWorkQueueItems({
      dueBefore: new Date('2026-06-30T00:00:00.000Z'),
      limit: 20,
    });

    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.id)).toContain(responsibleItem.id);
    const responsibleItemRow = rows.find((row) => row.id === responsibleItem.id);
    expect(responsibleItemRow).toBeDefined();
    expect(responsibleItemRow?.dueAt).toBeNull();
    expect(responsibleItemRow?.responsibleUserId).toBe(USER_OWNER);
  });
});
