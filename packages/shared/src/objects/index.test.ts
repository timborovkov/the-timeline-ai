import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  boardItemChanges,
  boardItems,
  calendarEventEntities,
  calendarEvents,
  chatMessages,
  chatSessions,
  entities,
  entityRelationships,
  factEntities,
  facts,
  objectChanges,
  objectNotes,
  objectSummaries,
  notifications,
  rawEvents,
} from '@timeline/db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStructuredInput, ChatStructuredResult } from '#src/llm/chat.js';
import type { z } from 'zod';

import { generateAndStoreObjectSummary } from '#src/objects/summaries.js';
import * as queue from '#src/queue/queues.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

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

async function seedWorkspace(): Promise<void> {
  await pg.exec(`
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

beforeEach(async () => {
  vi.clearAllMocks();
  qdrantFakes.getQdrantClient.mockReturnValue({
    deletePoints: qdrantFakes.deletePoints,
    deletePointsForSource: qdrantFakes.deletePointsForSource,
  });
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seedWorkspace();
  db = drizzle(pg) as unknown as AnyDb;
}, 60_000);

afterEach(async () => {
  await pg.close();
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

describe('object scope — team ownership and audit behavior', () => {
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

    const changes = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, object.id));
    expect(changes.map((change) => change.field).sort()).toEqual(['__create__', 'status']);
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

  it('does not mirror suggested task due dates before human acceptance', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;

    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Review agent-suggested deadline',
      assigneeUserId: USER_MEMBER,
      dueAt: new Date('2026-07-11T09:00:00.000Z'),
      agentSuggested: true,
      actor: { kind: 'agent', userId: null },
    });

    const inboxRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, task.id));
    expect(inboxRows).toEqual([
      expect.objectContaining({
        userId: USER_MEMBER,
        kind: 'agent_suggestion',
      }),
    ]);
    expect(inboxRows.some((row) => row.kind === 'task_due')).toBe(false);
    await expect(
      db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A)),
    ).resolves.toEqual([]);

    await scope.updateObject(task.id, { status: 'open' }, { kind: 'user', userId: USER_OWNER });

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
});

describe('object scope — relationships', () => {
  it('stores related relationships in canonical endpoint order and dedupes reverse inserts', async () => {
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

    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: task.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
    expect(queue.enqueueObjectSummaryJob).toHaveBeenCalledWith(
      { teamId: TEAM_A, objectId: parent.id, trigger: 'auto' },
      { delayMs: 120_000 },
    );
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
          enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
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
