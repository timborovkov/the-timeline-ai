import { PGlite } from '@electric-sql/pglite';
import {
  boardItemChanges,
  boardItems,
  boards,
  calendarEvents,
  notifications,
  rawEvents,
  type Db,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultBoardLanes } from '#src/boards/index.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', () => ({
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueEntityEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectNoteEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectChangeEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueCalendarEventEmbedJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#src/qdrant/client.js', () => ({
  getQdrantClient: vi.fn(() => ({
    deletePoints: vi.fn().mockResolvedValue(undefined),
    deletePointsForSource: vi.fn().mockResolvedValue(undefined),
  })),
}));

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_MEMBER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_OTHER_TEAM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let pg: PGlite;
let db: Db;

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

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seedWorkspace();
  db = drizzle(pg) as unknown as Db;
}, 20_000);

afterEach(async () => {
  await pg.close();
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

  it('adds a board item once and writes history for moves', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const board = await scope.boards.createBoard({
      name: 'Development tasks',
      templateKind: 'task_board',
      lanes: [
        { name: 'Todo', kind: 'active' },
        { name: 'Doing', kind: 'active' },
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
        summary: 'Northstar Labs on Partnership pipeline is due 2026-08-12',
      }),
    ]);

    let eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows).toEqual([
      expect.objectContaining({
        title: 'Due: Northstar Labs - member@test.local',
        description:
          'Board: Partnership pipeline\nResponsible: member@test.local\nObject type: company',
        startAt: dueAt,
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
    expect(eventRows[0]?.startAt).toEqual(movedDueAt);
    const startRawRows = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.id, eventRows[0]?.startAtRawEventId ?? ''));
    expect(startRawRows[0]).toEqual(
      expect.objectContaining({
        occurredAt: movedDueAt,
      }),
    );
    expect(startRawRows[0]?.contentText).toContain(movedDueAt.toISOString());
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
        startAt: dueAt,
        showAs: 'free',
      }),
    ]);
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
    const rawIds = [eventRows[0]?.scheduledRawEventId, eventRows[0]?.startAtRawEventId].filter(
      (id): id is string => id !== null && id !== undefined,
    );

    await scope.boards.archiveBoard(board.id);

    eventRows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_A));
    expect(eventRows[0]?.deletedAt).toBeInstanceOf(Date);
    const rawRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_A));
    expect(
      rawRows
        .filter((row) => rawIds.includes(row.id))
        .every((row) => (row.sourceMetadata as { deleted?: boolean }).deleted === true),
    ).toBe(true);
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
    await owner.boards.pinBoard(board.id);

    await expect(owner.boards.listPinnedBoards()).resolves.toHaveLength(1);
    await expect(member.boards.listPinnedBoards()).resolves.toHaveLength(0);
    await expect(owner.boards.listObjectBoardContext(company.id)).resolves.toMatchObject([
      { boardName: 'Pilot pipeline', laneName: 'Negotiation' },
    ]);

    const itemRows = await db.select().from(boardItems).where(eq(boardItems.entityId, company.id));
    expect(itemRows).toHaveLength(1);
  });
});
