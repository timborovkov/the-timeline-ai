// Direct-chat state must remain private, idempotent, bounded, and reusable by
// provider identifiers that the product does not know about at compile time.
import { PGlite } from '@electric-sql/pglite';
import {
  chatMessages,
  chatSessions,
  chatSurfaceSessionLinks,
  chatSurfaceTurns,
  type Db,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
}, 240_000);

beforeEach(async () => {
  await pg.exec(`
    TRUNCATE TABLE chat_surface_turns, chat_surface_session_links, chat_messages,
      chat_sessions, team_members, teams, users CASCADE;
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team', 'Team');
    INSERT INTO users (id, email) VALUES
      ('${USER_ID}', 'owner@example.com'),
      ('${OTHER_USER_ID}', 'other@example.com');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('${TEAM_ID}', '${USER_ID}', 'owner'),
      ('${TEAM_ID}', '${OTHER_USER_ID}', 'member');
  `);
});

afterAll(async () => {
  await pg.close();
});

function request(eventId: string) {
  return {
    surface: 'future-provider',
    externalEventId: eventId,
    externalMessageId: `message-${eventId}`,
    externalConversationKey: 'account:one:dm:conversation',
    externalUserKey: 'account:one:user:external',
    teamId: TEAM_ID,
    userId: USER_ID,
    userName: 'Owner',
    question: 'What changed this week?',
  };
}

describe('conversation surface scope', () => {
  it('creates one future-provider session and deduplicates provider redelivery', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID).conversations;
    const first = await scope.createTurn(request('event-1'));
    const duplicate = await scope.createTurn(request('event-1'));
    const busy = await scope.createTurn(request('event-2'));

    expect(first.status).toBe('accepted');
    expect(duplicate).toMatchObject({
      status: 'duplicate',
      turn: { id: first.status === 'accepted' ? first.turn.id : '' },
    });
    expect(busy).toEqual({ status: 'busy' });

    const sessions = await db.select().from(chatSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      surface: 'future-provider',
      title: 'What changed this week?',
      createdBy: USER_ID,
    });
    await expect(
      withTeam(db, TEAM_ID, OTHER_USER_ID).conversations.getTurn(
        first.status === 'accepted' ? first.turn.id : '',
      ),
    ).resolves.toBeNull();
  });

  it('persists the answer before delivery and replays only bounded text history', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID).conversations;
    const created = await scope.createTurn(request('event-1'));
    if (created.status !== 'accepted') throw new Error('expected accepted turn');
    const claimed = await scope.claimTurn(created.turn.id);
    expect(claimed.status).toBe('claimed');
    await scope.storeAnswer({
      turnId: created.turn.id,
      answer: 'A durable answer',
      requestedModelId: 'requested',
      responseModelId: 'response',
      toolObservability: { totalResultCount: 2 },
    });

    const answered = await db
      .select()
      .from(chatSurfaceTurns)
      .where(eq(chatSurfaceTurns.id, created.turn.id));
    expect(answered[0]).toMatchObject({
      status: 'answered',
      answerText: 'A durable answer',
      requestedModelId: 'requested',
      responseModelId: 'response',
    });
    expect(await db.select().from(chatMessages)).toHaveLength(2);
    await expect(scope.recentHistory(created.turn.chatSessionId)).resolves.toEqual([
      { role: 'user', content: 'What changed this week?' },
      { role: 'assistant', content: 'A durable answer' },
    ]);

    await db.insert(chatMessages).values(
      Array.from({ length: 24 }, (_, index): typeof chatMessages.$inferInsert => ({
        teamId: TEAM_ID,
        sessionId: created.turn.chatSessionId,
        role: index % 2 === 0 ? 'user' : 'assistant',
        authorUserId: index % 2 === 0 ? USER_ID : null,
        content: { text: `${String(index).padStart(2, '0')}:${'x'.repeat(20)}` },
        createdAt: new Date(1_800_000_000_000 + index),
      })),
    );
    await db.insert(chatMessages).values({
      teamId: TEAM_ID,
      sessionId: created.turn.chatSessionId,
      role: 'tool',
      content: { output: 'must not enter conversational replay' },
      createdAt: new Date(1_800_000_100_000),
    });

    const history = await scope.recentHistory(created.turn.chatSessionId);
    expect(history).toHaveLength(20);
    expect(history[0]?.content).toBe(`04:${'x'.repeat(20)}`);
    expect(history.at(-1)?.content).toBe(`23:${'x'.repeat(20)}`);
    expect(JSON.stringify(history)).not.toContain('must not enter');
  });

  it('archives and unlinks a surface session on reset', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID).conversations;
    const created = await scope.createTurn(request('event-1'));
    if (created.status !== 'accepted') throw new Error('expected accepted turn');
    await expect(scope.resetSession(request('ignored'))).resolves.toBe(true);

    expect(await db.select().from(chatSurfaceSessionLinks)).toHaveLength(0);
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, created.turn.chatSessionId));
    expect(sessions[0]?.archivedAt).toBeInstanceOf(Date);
    const turns = await db
      .select()
      .from(chatSurfaceTurns)
      .where(eq(chatSurfaceTurns.id, created.turn.id));
    expect(turns[0]).toMatchObject({ status: 'cancelled', errorCode: 'session_reset' });
  });

  it('replaces a stale surface link after membership moves to another team', async () => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${OTHER_TEAM_ID}', 'other-team', 'Other Team');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${OTHER_TEAM_ID}', '${USER_ID}', 'member');
    `);
    const oldScope = withTeam(db, TEAM_ID, USER_ID).conversations;
    const oldTurn = await oldScope.createTurn(request('event-old-team'));
    if (oldTurn.status !== 'accepted') throw new Error('expected accepted old-team turn');
    await db
      .update(chatSurfaceTurns)
      .set({ status: 'delivered', deliveredAt: new Date() })
      .where(eq(chatSurfaceTurns.id, oldTurn.turn.id));
    await pg.exec(`
      UPDATE team_members
      SET removed_at = now()
      WHERE team_id = '${TEAM_ID}' AND user_id = '${USER_ID}';
    `);

    const moved = await withTeam(db, OTHER_TEAM_ID, USER_ID).conversations.createTurn({
      ...request('event-new-team'),
      teamId: OTHER_TEAM_ID,
    });

    expect(moved.status).toBe('accepted');
    expect(await db.select().from(chatSurfaceSessionLinks)).toMatchObject([
      { teamId: OTHER_TEAM_ID, userId: USER_ID },
    ]);
    const oldSessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, oldTurn.turn.chatSessionId));
    expect(oldSessions[0]?.archivedAt).toBeInstanceOf(Date);
  });

  it('enforces the per-user turn limit across completed conversations', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID).conversations;
    for (let index = 0; index < 10; index += 1) {
      const created = await scope.createTurn({
        ...request(`event-${String(index)}`),
        externalConversationKey: `account:one:dm:${String(index)}`,
      });
      expect(created.status).toBe('accepted');
      if (created.status === 'accepted') {
        await db
          .update(chatSurfaceTurns)
          .set({ status: 'delivered', deliveredAt: new Date() })
          .where(eq(chatSurfaceTurns.id, created.turn.id));
      }
    }

    await expect(
      scope.createTurn({
        ...request('event-over-limit'),
        externalConversationKey: 'account:one:dm:over-limit',
      }),
    ).resolves.toEqual({ status: 'rate_limited' });
  });
});
