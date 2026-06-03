import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  chatMessages,
  chatSessions,
  entities,
  objectChanges,
  objectNotes,
  rawEvents,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

/**
 * Real-DB integration tests for workspace objects. This module owns a large
 * part of the product contract: object CRUD, audit rows, notes, suggestions,
 * notifications, chat sessions, and team/user isolation. These tests exercise
 * persisted behavior through `withTeam(...).objects`, not private helpers.
 */

vi.mock('#src/queue/queues.js', () => ({
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueEntityEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectNoteEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectChangeEmbedJob: vi.fn().mockResolvedValue(undefined),
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
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seedWorkspace();
  db = drizzle(pg) as unknown as AnyDb;
});

afterEach(async () => {
  await pg.close();
});

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

describe('object scope — board and archive visibility', () => {
  it('hides archived objects when requested and keeps board views inside their team', async () => {
    const ownerScope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const otherScope = withTeam(db, TEAM_B, USER_OTHER_TEAM).objects;
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

    const board = await ownerScope.saveBoardView({
      name: 'Team A board',
      kind: 'kanban',
      filter: { status: 'todo' },
    });

    await expect(ownerScope.getBoardView(board.id)).resolves.toMatchObject({
      name: 'Team A board',
    });
    await expect(otherScope.getBoardView(board.id)).resolves.toBeNull();

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
});
