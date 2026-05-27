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
    VALUES ('${USER_A}', 'a@example.com'), ('${USER_B}', 'b@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${USER_A}', 'owner'),
      ('${TEAM_A}', '${USER_B}', 'member'),
      ('${TEAM_B}', '${USER_A}', 'owner');
  `);
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
});
