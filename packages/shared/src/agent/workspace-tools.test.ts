import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';

import type { TeamScope } from '#src/team-scope.js';
import type { ResettablePGliteTestDb } from '#src/test/pglite.js';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '@timeline/db';
import type { ToolSet } from 'ai';

const queueFakes = vi.hoisted(() => ({
  enqueueCalendarEventEmbedJob: vi.fn().mockResolvedValue(undefined),
}));

const qdrantFakes = vi.hoisted(() => ({
  deletePoints: vi.fn().mockResolvedValue(undefined),
  deletePointsForSource: vi.fn().mockResolvedValue(undefined),
  getQdrantClient: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('#src/queue/queues.js'),
  async () => ({
    ...(await import('#src/queue/queues.js')),
    enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueEntityEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueObjectNoteEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueObjectChangeEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueCalendarEventEmbedJob: queueFakes.enqueueCalendarEventEmbedJob,
    enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-job' }),
  }),
  () => import('#src/queue/queues.js'),
);
await vi.mock(
  import.meta.resolve('#src/qdrant/client.js'),
  () => ({
    getQdrantClient: qdrantFakes.getQdrantClient,
  }),
  () => import('#src/qdrant/client.js'),
);

const { drizzle } = await import('drizzle-orm/pglite');
const { withTeam } = await import('#src/team-scope.js');
const { createResettablePGliteTestDb } = await import('#src/test/pglite.js');
const { buildAgentTools, userApprovalForTools } = await import('#src/agent/tools.js');
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

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(seedWorkspace);
  pg = testDb.pg;
  db = drizzle(pg) as unknown as Db;
}, 60_000);
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
async function call<T = Record<string, unknown>>(
  tools: ToolSet,
  name: string,
  input: unknown,
): Promise<T> {
  const execute = tools[name]?.execute as (input: unknown, options: unknown) => Promise<T>;
  return execute(input, { toolCallId: 'test-call', messages: [] });
}
interface BoardResult {
  ok: boolean;
  board_id: string;
  board: {
    name: string;
    updatedAt: string;
    lanes: { id: string; name: string; kind: string | null }[];
    qualificationEnabled: boolean;
  };
}
const reason = 'User explicitly requested this change.';
function toolsFor(scope: TeamScope) {
  return buildAgentTools(scope, { taskCategoryClassificationEnabled: false });
}

// Real scoped SQL workflows: tools must create usable workspace state and reject stale/foreign edits.
describe('approved workspace actions', () => {
  it('creates a CRM board, places a card, edits lanes, and archives only the board', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const tools = toolsFor(scope);
    const created = await call<BoardResult>(tools, 'execute_board_create', {
      name: 'CRM',
      templateKind: 'pipeline',
      reason,
    });
    expect(created.ok).toBe(true);
    expect(created.board.qualificationEnabled).toBe(false);
    expect(created.board.lanes.map((l) => l.name)).toContain('Qualified');
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Acme',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const placed = await call(tools, 'execute_board_add_item', {
      boardId: created.board_id,
      entityId: object.id,
      laneId: required(created.board.lanes[0]).id,
      reason,
    });
    expect(placed.ok).toBe(true);
    const read = await call<BoardResult>(tools, 'get_board', { boardId: created.board_id });
    const updated = await call<BoardResult>(tools, 'execute_board_update', {
      boardId: created.board_id,
      expectedCurrent: read.board,
      patch: { name: 'Sales CRM', lanes: read.board.lanes.slice(1) },
      reason,
    });
    expect(updated.ok).toBe(true);
    const board = await scope.boards.getBoard(created.board_id);
    expect(board?.name).toBe('Sales CRM');
    expect(board?.items[0]?.laneId).toBeNull();
    expect(
      (
        await call(tools, 'execute_board_update', {
          boardId: created.board_id,
          expectedCurrent: read.board,
          patch: { name: 'Stale' },
          reason,
        })
      ).error,
    ).toBeDefined();
    expect(
      (
        await call(tools, 'execute_board_archive', {
          boardId: created.board_id,
          expectedCurrent: { name: 'Sales CRM', updatedAt: updated.board.updatedAt },
          reason,
        })
      ).ok,
    ).toBe(true);
    expect(await scope.boards.getBoard(created.board_id)).toBeNull();
    expect((await scope.objects.getObject(object.id))?.archivedAt).toBeNull();
  });
  it('edits own notes with revisions, links/unlinks objects, and restores an archived object', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const tools = toolsFor(scope);
    const actor = { kind: 'user' as const, userId: USER_OWNER };
    const a = await scope.objects.createObject({ type: 'project', canonicalName: 'Alpha', actor });
    const b = await scope.objects.createObject({ type: 'project', canonicalName: 'Beta', actor });
    const created = await call<{ note_id: string }>(tools, 'execute_object_note_create', {
      entityId: a.id,
      body: 'First note',
      reason,
    });
    const read = await call<{ body: string; updatedAt: string; entityId: string }>(
      tools,
      'get_object_note',
      { noteId: created.note_id },
    );
    const expected = { entityId: a.id, body: read.body, updatedAt: read.updatedAt };
    expect(
      (
        await call(tools, 'execute_object_note_update', {
          noteId: created.note_id,
          expectedCurrent: expected,
          body: 'Edited note',
          reason,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await call(tools, 'execute_object_note_delete', {
          noteId: created.note_id,
          expectedCurrent: expected,
          reason,
        })
      ).error,
    ).toBeDefined();
    const edited = await scope.objects.getObjectNotePreview(created.note_id);
    expect(edited?.body).toBe('Edited note');
    const detail = await call<{ relationships: { id: string }[]; notes: { updatedAt: string }[] }>(
      tools,
      'get_object',
      { idOrName: a.id },
    );
    expect(detail.notes[0]?.updatedAt).toBe(required(edited).updatedAt.toISOString());
    const linked = await call<{ relationship_id: string }>(
      tools,
      'execute_object_relationship_add',
      { fromEntityId: a.id, toEntityId: b.id, kind: 'blocks', reason },
    );
    const linkedRead = await call<{ relationships: { id: string }[] }>(tools, 'get_object', {
      idOrName: a.id,
    });
    expect(linkedRead.relationships.map((r) => r.id)).toContain(linked.relationship_id);
    expect(
      (
        await call(tools, 'execute_object_relationship_remove', {
          relationshipId: linked.relationship_id,
          expectedCurrent: { fromEntityId: b.id, toEntityId: a.id, kind: 'blocks' },
          reason,
        })
      ).error,
    ).toBeDefined();
    expect(
      (
        await call(tools, 'execute_object_relationship_remove', {
          relationshipId: linked.relationship_id,
          expectedCurrent: { fromEntityId: a.id, toEntityId: b.id, kind: 'blocks' },
          reason,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await call(tools, 'execute_object_note_delete', {
          noteId: created.note_id,
          expectedCurrent: {
            entityId: a.id,
            body: required(edited).body,
            updatedAt: required(edited).updatedAt.toISOString(),
          },
          reason,
        })
      ).ok,
    ).toBe(true);
    await scope.objects.archiveObject(a.id, actor);
    const archived = await scope.objects.getObject(a.id);
    expect(
      (
        await call(tools, 'execute_object_restore', {
          entityId: a.id,
          expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
          reason,
        })
      ).error,
    ).toBeDefined();
    expect(
      (
        await call(tools, 'execute_object_restore', {
          entityId: a.id,
          expectedUpdatedAt: required(archived).updatedAt.toISOString(),
          reason,
        })
      ).ok,
    ).toBe(true);
    expect((await scope.objects.getObject(a.id))?.archivedAt).toBeNull();
  });
  it('removes a primary company relationship through the guarded domain transaction', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const actor = { kind: 'user' as const, userId: USER_OWNER };
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Acme',
      actor,
    });
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Alex',
      actor,
    });
    const tools = toolsFor(scope);
    await scope.objects.setPersonCompany(person.id, company.id, actor);
    const detail = await call<{
      relationships: { id: string; fromEntityId: string; toEntityId: string; kind: string }[];
    }>(tools, 'get_object', { idOrName: person.id });
    const relationship = required(detail.relationships[0]);
    expect(await scope.objects.listPrimaryCompaniesForPeople([person.id])).toHaveLength(1);
    const removed = await call(tools, 'execute_object_relationship_remove', {
      relationshipId: relationship.id,
      expectedCurrent: relationship,
      reason,
    });
    expect(removed.ok).toBe(true);
    expect(await scope.objects.listPrimaryCompaniesForPeople([person.id])).toHaveLength(0);
  });

  it('keeps private boards, other teams, and other authors behind existing permission boundaries', async () => {
    const owner = withTeam(db, TEAM_A, USER_OWNER);
    const member = withTeam(db, TEAM_A, USER_MEMBER);
    const other = withTeam(db, TEAM_B, USER_OTHER_TEAM);
    const board = await owner.boards.createBoard({
      name: 'Private',
      templateKind: 'custom',
      lanes: [{ name: 'Todo' }],
      isShared: false,
    });
    const object = await owner.objects.createObject({
      type: 'project',
      canonicalName: 'Private test',
      actor: { kind: 'user', userId: USER_OWNER },
    });
    const note = await owner.objects.createNote({
      entityId: object.id,
      body: 'Owner note',
      authorUserId: USER_OWNER,
    });
    const preview = await owner.objects.getObjectNotePreview(note.id);
    for (const scope of [member, other]) {
      const tools = toolsFor(scope);
      const read = await call(tools, 'get_board', { boardId: board.id });
      expect(read.found === false || Boolean(read.error)).toBe(true);
      expect(
        (
          await call(tools, 'execute_board_archive', {
            boardId: board.id,
            expectedCurrent: { name: board.name, updatedAt: board.updatedAt.toISOString() },
            reason,
          })
        ).error,
      ).toBeDefined();
      expect(
        (
          await call(tools, 'execute_object_note_update', {
            noteId: note.id,
            expectedCurrent: {
              entityId: object.id,
              body: 'Owner note',
              updatedAt: required(preview).updatedAt.toISOString(),
            },
            body: 'Tampered',
            reason,
          })
        ).error,
      ).toBeDefined();
      expect(
        (
          await call(tools, 'execute_object_note_delete', {
            noteId: note.id,
            expectedCurrent: {
              entityId: object.id,
              body: 'Owner note',
              updatedAt: required(preview).updatedAt.toISOString(),
            },
            reason,
          })
        ).error,
      ).toBeDefined();
    }
    expect((await owner.objects.getObjectNotePreview(note.id))?.body).toBe('Owner note');
    const foreign = toolsFor(other);
    expect(
      (
        await call(foreign, 'execute_object_note_create', {
          entityId: object.id,
          body: 'Foreign',
          reason,
        })
      ).error,
    ).toBeDefined();
    expect(
      (
        await call(foreign, 'execute_object_restore', {
          entityId: object.id,
          expectedUpdatedAt: object.updatedAt.toISOString(),
          reason,
        })
      ).error,
    ).toBeDefined();
    expect((await call(foreign, 'get_object_note', { noteId: 'not-an-id' })).error).toBeDefined();
  });
  it('requires approval for all new writes and removes them in restricted modes', () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER);
    const tools = toolsFor(scope);
    const names = [
      'execute_board_create',
      'execute_board_update',
      'execute_board_archive',
      'execute_object_restore',
      'execute_object_note_create',
      'execute_object_note_update',
      'execute_object_note_delete',
      'execute_object_relationship_add',
      'execute_object_relationship_remove',
    ];
    for (const name of names) expect(userApprovalForTools(tools)?.[name]).toBe('user-approval');
    for (const mode of ['read_only', 'proposal_only'] as const) {
      const restricted = buildAgentTools(scope, { toolMode: mode });
      for (const name of names) expect(restricted[name]).toBeUndefined();
      expect(restricted.get_board).toBeDefined();
      expect(restricted.get_object_note).toBeDefined();
    }
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required test fixture missing');
  return value;
}
