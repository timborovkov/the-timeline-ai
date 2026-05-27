import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { withTeam } from './team-scope.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../db/drizzle');

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) await pg.exec(stmt);
  }
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_A}', 'team-a', 'Team A'), ('${TEAM_B}', 'team-b', 'Team B');
    INSERT INTO users (id, email)
    VALUES
      ('${USER_A}', 'a@example.com'),
      ('${USER_B}', 'b@example.com'),
      ('${USER_C}', 'c@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${USER_A}', 'owner'),
      ('${TEAM_A}', '${USER_B}', 'member'),
      ('${TEAM_A}', '${USER_C}', 'admin'),
      ('${TEAM_B}', '${USER_A}', 'owner');
  `);
}

async function insertTelegramEvent(
  pg: PGlite,
  input: { id: string; authorUserId: string | null; text: string; deleted?: boolean },
): Promise<void> {
  const metadata = {
    tg_chat_id: 42,
    tg_chat_type: 'private',
    tg_message_id: 10,
    tg_update_id: Number(input.id.slice(-6)),
    ...(input.deleted ? { deleted: true } : {}),
  };
  await pg.query(
    `INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, occurred_at, source_metadata)
     VALUES ($1, $2, $3, 'telegram', $4, now(), $5::jsonb)`,
    [input.id, TEAM_A, input.authorUserId, input.text, JSON.stringify(metadata)],
  );
}

describe('withTeam namespaced port', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('exposes timeline and documents through modules, not flat methods', () => {
    const scope = withTeam(db as never, TEAM_A, USER_A) as unknown as Record<string, unknown>;

    expect(scope.timeline).toBeDefined();
    expect(scope.documents).toBeDefined();
    expect(scope.objects).toBeDefined();
    expect(scope.calendar).toBeDefined();
    expect(scope.integrations).toBeDefined();
    expect(scope.mcp).toBeDefined();

    expect(scope).not.toHaveProperty('listEvents');
    expect(scope).not.toHaveProperty('getEventWithFacts');
    expect(scope).not.toHaveProperty('searchEvents');
    expect(scope).not.toHaveProperty('getDocument');
    expect(scope).not.toHaveProperty('searchDocumentChunks');
  });

  it('binds object helpers to the scope team and keeps chat sessions private to the user', async () => {
    const scopeA = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);
    const otherTeamScope = withTeam(db as never, TEAM_B, USER_A);

    const object = await scopeA.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare board review',
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(scopeA.objects.getObject(object.id)).resolves.toMatchObject({
      id: object.id,
      canonicalName: 'Prepare board review',
    });
    await expect(otherTeamScope.objects.getObject(object.id)).resolves.toBeNull();
    await expect(otherTeamScope.objects.listObjects()).resolves.toEqual([]);

    const session = await scopeA.objects.createChatSession({ title: 'Private scratchpad' });

    await expect(scopeA.objects.listChatSessions()).resolves.toHaveLength(1);
    await expect(scopeA.objects.getChatSession(session.id)).resolves.toMatchObject({
      session: { id: session.id, title: 'Private scratchpad' },
    });
    await expect(teammateScope.objects.listChatSessions()).resolves.toEqual([]);
    await expect(teammateScope.objects.getChatSession(session.id)).resolves.toBeNull();
  });

  it('hides tombstoned raw events from timeline reads and hydration', async () => {
    const visibleId = '00000000-0000-0000-0000-000000000101';
    const deletedId = '00000000-0000-0000-0000-000000000102';
    await insertTelegramEvent(pg, {
      id: visibleId,
      authorUserId: USER_A,
      text: 'visible telegram',
    });
    await insertTelegramEvent(pg, {
      id: deletedId,
      authorUserId: USER_A,
      text: 'deleted telegram',
      deleted: true,
    });

    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(scope.timeline.listEvents({ source: 'telegram' })).resolves.toMatchObject([
      { id: visibleId },
    ]);
    await expect(scope.timeline.getEvent(deletedId)).resolves.toBeNull();
    await expect(scope.timeline.getEventsByIds([visibleId, deletedId])).resolves.toMatchObject([
      { id: visibleId },
    ]);
  });

  it('allows a Telegram author to tombstone their own message revisions', async () => {
    const originalId = '00000000-0000-0000-0000-000000000201';
    const editId = '00000000-0000-0000-0000-000000000202';
    await insertTelegramEvent(pg, {
      id: originalId,
      authorUserId: USER_A,
      text: 'original',
    });
    await insertTelegramEvent(pg, {
      id: editId,
      authorUserId: USER_A,
      text: 'edit',
    });

    const scope = withTeam(db as never, TEAM_A, USER_A);
    await expect(scope.timeline.removeTelegramMessage(editId)).resolves.toBe(true);
    await expect(scope.timeline.listEvents({ source: 'telegram' })).resolves.toEqual([]);

    const rows = await pg.query<{ reason: string; count: string }>(
      `SELECT source_metadata->>'delete_reason' AS reason, count(*)::text AS count
       FROM raw_events
       WHERE source = 'telegram'
       GROUP BY source_metadata->>'delete_reason'`,
    );
    expect(rows.rows).toEqual([{ reason: 'telegram_removed_in_timeline', count: '2' }]);
  });

  it('allows admins but rejects non-author members and non-Telegram events', async () => {
    const telegramId = '00000000-0000-0000-0000-000000000301';
    await insertTelegramEvent(pg, {
      id: telegramId,
      authorUserId: USER_A,
      text: 'moderate me',
    });

    const memberScope = withTeam(db as never, TEAM_A, USER_B);
    await expect(memberScope.timeline.removeTelegramMessage(telegramId)).rejects.toThrow(
      'Only the Telegram author or a team admin can remove this event',
    );

    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    await expect(adminScope.timeline.removeTelegramMessage(telegramId)).resolves.toBe(true);

    const web = await withTeam(db as never, TEAM_A, USER_A).timeline.createEvent({
      authorUserId: USER_A,
      source: 'web',
      contentText: 'not telegram',
    });
    await expect(adminScope.timeline.removeTelegramMessage(web.id)).rejects.toThrow(
      'Only Telegram events can be removed this way',
    );
  });

  it('rejects removed members at the team-scope chokepoint', async () => {
    await pg.exec(`
      UPDATE team_members
      SET removed_at = now(), removed_by_user_id = '${USER_A}'
      WHERE team_id = '${TEAM_A}' AND user_id = '${USER_B}';
    `);

    const removedScope = withTeam(db as never, TEAM_A, USER_B);

    await expect(removedScope.requireMembership()).rejects.toThrow('Not a member of this team');
    await expect(removedScope.timeline.listMembers()).rejects.toThrow('Not a member of this team');

    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    await expect(ownerScope.timeline.listMembers()).resolves.toEqual([
      expect.objectContaining({ userId: USER_A, role: 'owner' }),
    ]);
  });
});
