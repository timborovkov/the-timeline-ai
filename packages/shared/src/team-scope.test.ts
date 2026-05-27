import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { auditLog, rawEvents, teamVisibilityDefaults } from '@timeline/db';
import { eq } from 'drizzle-orm';
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

  it('resolves visibility defaults by source, fallback, then hard team default', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'team',
      inherited: true,
    });

    await scope.timeline.setVisibilityDefault({
      source: 'team',
      visibility: 'private',
      sourceOwnerUserId: USER_A,
    });
    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'private',
      sourceOwnerUserId: USER_A,
      inherited: true,
    });

    await scope.timeline.setVisibilityDefault({ source: 'web', visibility: 'team' });
    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'team',
      inherited: false,
    });
  });

  it('rejects specific_users defaults on binary capture sources', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await expect(
      scope.timeline.setVisibilityDefault({
        source: 'telegram',
        visibility: 'specific_users',
        visibilityUserIds: [USER_A],
      }),
    ).rejects.toThrow('specific_users visibility is not supported');
  });

  it('materializes all visibility defaults from one settings fetch', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await scope.timeline.setVisibilityDefault({
      source: 'team',
      visibility: 'private',
      sourceOwnerUserId: USER_A,
    });
    await scope.timeline.setVisibilityDefault({ source: 'document', visibility: 'team' });

    await expect(scope.timeline.getVisibilityDefaults()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'web',
          visibility: 'private',
          sourceOwnerUserId: USER_A,
          inherited: true,
        }),
        expect.objectContaining({
          source: 'document',
          visibility: 'team',
          inherited: false,
        }),
      ]),
    );
  });

  it('only the visibility owner can change an existing event visibility and audits it', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    const event = await ownerScope.timeline.createEvent({
      authorUserId: USER_B,
      visibilityOwnerUserId: USER_A,
      source: 'web',
      contentText: 'owner controlled',
      visibility: 'team',
    });

    await expect(
      adminScope.timeline.setEventVisibility(event.id, { visibility: 'private' }),
    ).rejects.toThrow('Only the visibility owner');

    await ownerScope.timeline.setEventVisibility(event.id, {
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
    });
    await expect(ownerScope.timeline.getEvent(event.id)).resolves.toMatchObject({ id: event.id });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, event.id));
    expect(row?.visibility).toBe('specific_users');
    expect(row?.visibilityUserIds).toEqual([USER_B]);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.targetId, event.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('visibility_change');
    expect(auditRows[0]?.payload).toMatchObject({
      previous: { visibility: 'team' },
      next: { visibility: 'specific_users', visibilityUserIds: [USER_B] },
    });

    const defaults = await db.select().from(teamVisibilityDefaults);
    expect(defaults).toHaveLength(0);
  });

  it('lets a private source-owned event be read and edited by its visibility owner', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    const event = await ownerScope.timeline.createEvent({
      authorUserId: null,
      visibilityOwnerUserId: USER_A,
      source: 'email',
      contentText: 'unverified sender private email',
      visibility: 'private',
    });

    await expect(ownerScope.timeline.getEvent(event.id)).resolves.toMatchObject({ id: event.id });
    await expect(teammateScope.timeline.getEvent(event.id)).resolves.toBeNull();
    await expect(adminScope.timeline.getEvent(event.id)).resolves.toBeNull();

    await ownerScope.timeline.setEventVisibility(event.id, { visibility: 'team' });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, event.id));
    expect(row?.visibility).toBe('team');
  });
});
