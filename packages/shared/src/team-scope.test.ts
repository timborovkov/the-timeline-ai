import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  auditLog,
  calendarEvents,
  documents,
  documentVersions,
  integrations,
  rawEvents,
  teamVisibilityDefaults,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { withTeam } from '#src/team-scope.js';

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
  input: {
    id: string;
    authorUserId: string | null;
    text: string;
    deleted?: boolean;
    username?: string;
    tgUserId?: number;
  },
): Promise<void> {
  const metadata = {
    tg_chat_id: 42,
    tg_chat_type: 'private',
    tg_message_id: 10,
    tg_update_id: Number(input.id.slice(-6)),
    ...(input.deleted ? { deleted: true } : {}),
    ...(input.username ? { tg_username: input.username } : {}),
    ...(input.tgUserId ? { tg_user_id: input.tgUserId } : {}),
  };
  await pg.query(
    `INSERT INTO raw_events (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, source_metadata)
     VALUES ($1, $2, $3, $3, 'telegram', $4, now(), $5::jsonb)`,
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

  it('coerces invalid inherited specific-users defaults to team visibility', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_A,
      source: 'team',
      visibility: 'specific_users',
      visibilityUserIds: [USER_A],
      sourceOwnerUserId: USER_A,
      updatedByUserId: USER_A,
    });

    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'team',
      visibilityUserIds: null,
      sourceOwnerUserId: USER_A,
      inherited: true,
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

  it('rejects specific_users email events with an email-specific error', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await expect(
      scope.timeline.createEmailEvent({
        authorUserId: USER_A,
        visibility: 'specific_users',
        visibilityUserIds: [USER_A],
        messageId: 'specific-users-email@example.com',
        contentText: 'specific-users email',
        occurredAt: new Date('2026-05-27T09:00:00Z'),
      } as never),
    ).rejects.toThrow('specific_users visibility is not supported for email events');
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

  it('fails closed for person sender filters when no approved identity facet exists', async () => {
    const eventId = '00000000-0000-0000-0000-000000000106';
    await insertTelegramEvent(pg, {
      id: eventId,
      authorUserId: null,
      text: 'visible telegram from someone else',
      username: 'someone',
      tgUserId: 123,
    });
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Mikael Rintala',
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(scope.timeline.listEvents({ personObjectId: person.id })).resolves.toEqual([]);
  });

  it('does not hydrate entity facts whose source event has been tombstoned', async () => {
    const deletedId = '00000000-0000-0000-0000-000000000103';
    const entityId = '00000000-0000-0000-0000-000000000104';
    const factId = '00000000-0000-0000-0000-000000000105';
    await insertTelegramEvent(pg, {
      id: deletedId,
      authorUserId: USER_A,
      text: 'deleted source fact',
      deleted: true,
    });
    await pg.exec(`
      INSERT INTO entities (id, team_id, type, canonical_name)
      VALUES ('${entityId}', '${TEAM_A}', 'person', 'Alice Deleted');
      INSERT INTO facts (id, team_id, raw_event_id, statement, confidence, model_version)
      VALUES ('${factId}', '${TEAM_A}', '${deletedId}', 'Alice Deleted knows the old plan', 0.9, 'test-model');
      INSERT INTO fact_entities (fact_id, entity_id, role)
      VALUES ('${factId}', '${entityId}', 'subject');
    `);

    const profile = await withTeam(db as never, TEAM_A, USER_A).timeline.getEntity(entityId);

    expect(profile).not.toBeNull();
    expect(profile?.facts).toEqual([]);
    expect(profile?.events).toEqual([]);
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
      'Only the message author or a team admin can remove this event',
    );

    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    await expect(adminScope.timeline.removeTelegramMessage(telegramId)).resolves.toBe(true);

    const web = await withTeam(db as never, TEAM_A, USER_A).timeline.createEvent({
      authorUserId: USER_A,
      source: 'web',
      contentText: 'not telegram',
    });
    await expect(adminScope.timeline.removeTelegramMessage(web.id)).rejects.toThrow(
      'Only Telegram and Slack events can be removed this way',
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
    await expect(ownerScope.timeline.getEvent(event.id)).resolves.toBeNull();
    await expect(
      withTeam(db as never, TEAM_A, USER_B).timeline.getEvent(event.id),
    ).resolves.toMatchObject({
      id: event.id,
    });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, event.id));
    expect(row?.visibility).toBe('specific_users');
    expect(row?.visibilityUserIds).toEqual([USER_B]);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.targetId, event.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('visibility_change');
    expect(auditRows[0]?.metadata).toMatchObject({
      previous: { visibility: 'team' },
      next: { visibility: 'specific_users', visibilityUserIds: [USER_B] },
    });

    const defaults = await db.select().from(teamVisibilityDefaults);
    expect(defaults).toHaveLength(0);

    await ownerScope.timeline.setEventVisibility(event.id, { visibility: 'team' });
    await expect(ownerScope.timeline.getEvent(event.id)).resolves.toMatchObject({ id: event.id });
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

  it('audits source-owned private event detail reads against the visibility owner', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const event = await ownerScope.timeline.createEvent({
      authorUserId: null,
      visibilityOwnerUserId: USER_A,
      source: 'email',
      contentText: 'source-owned audit event',
      visibility: 'private',
    });

    await expect(ownerScope.timeline.getEventWithFacts(event.id)).resolves.toMatchObject({
      event: { id: event.id },
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'event.detail_read',
      targetOwnerUserId: USER_A,
    });
  });

  it('does not leak private document impact through team-visible source events', async () => {
    const documentId = '00000000-0000-0000-0000-000000000502';
    const versionId = '00000000-0000-0000-0000-000000000503';
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);

    const event = await ownerScope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'document',
      contentText: 'Uploaded board-private planning notes',
      visibility: 'team',
    });

    await db.insert(documents).values({
      id: documentId,
      teamId: TEAM_A,
      name: 'Private planning notes.pdf',
      ownerUserId: USER_A,
      visibility: 'team',
    });
    await db.insert(documentVersions).values({
      id: versionId,
      teamId: TEAM_A,
      documentId,
      version: 1,
      objectKey: 'documents/private-planning-notes.pdf',
      byteSize: 1024,
      contentType: 'application/pdf',
      checksumSha256: 'test-checksum',
      uploadedByUserId: USER_A,
      sourceEventId: event.id,
      processingStatus: 'embedded',
    });

    await expect(teammateScope.timeline.listImpactItems([event.id])).resolves.toMatchObject({
      [event.id]: [
        expect.objectContaining({
          kind: 'document',
          label: 'Private planning notes.pdf',
        }),
      ],
    });

    await ownerScope.documents.setDocumentVisibility({
      id: documentId,
      visibility: 'private',
    });

    await expect(teammateScope.timeline.listImpactItems([event.id])).resolves.toEqual({});
    await expect(ownerScope.timeline.listImpactItems([event.id])).resolves.toMatchObject({
      [event.id]: [
        expect.objectContaining({
          kind: 'document',
          label: 'Private planning notes.pdf',
        }),
      ],
    });
  });

  it('does not leak private calendar impact through raw event ids', async () => {
    const calendarEventId = '00000000-0000-0000-0000-000000000601';
    const rawEventId = '00000000-0000-0000-0000-000000000602';

    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_A,
      authorUserId: USER_A,
      visibilityOwnerUserId: USER_A,
      source: 'calendar',
      contentText: 'Private acquisition planning',
      occurredAt: new Date('2026-06-01T10:00:00Z'),
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
      sourceMetadata: { calendar_event_id: calendarEventId, action: 'event' },
    });
    await db.insert(calendarEvents).values({
      id: calendarEventId,
      teamId: TEAM_A,
      createdByUserId: USER_A,
      title: 'Private acquisition planning',
      startAt: new Date('2026-06-01T10:00:00Z'),
      endAt: new Date('2026-06-01T11:00:00Z'),
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
      startAtRawEventId: rawEventId,
    });

    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);

    await expect(teammateScope.timeline.listImpactItems([rawEventId])).resolves.toMatchObject({
      [rawEventId]: [
        expect.objectContaining({
          kind: 'calendar',
          label: 'Private acquisition planning',
        }),
      ],
    });

    await db
      .update(calendarEvents)
      .set({ visibility: 'private', visibilityUserIds: null })
      .where(eq(calendarEvents.id, calendarEventId));

    await expect(teammateScope.timeline.listImpactItems([rawEventId])).resolves.toEqual({});
    await expect(ownerScope.timeline.listImpactItems([rawEventId])).resolves.toMatchObject({
      [rawEventId]: [
        expect.objectContaining({
          kind: 'calendar',
          label: 'Private acquisition planning',
        }),
      ],
    });
  });

  it('rejects visibility edits for ownerless legacy events with a clear error', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: null,
      visibilityOwnerUserId: null,
      source: 'system',
      contentText: 'legacy ownerless event',
      visibility: 'team',
    });

    await expect(
      scope.timeline.setEventVisibility(event.id, { visibility: 'private' }),
    ).rejects.toThrow('This event has no visibility owner');
  });

  it('fails integration visibility updates for missing integrations', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(
      scope.integrations.setIntegrationVisibilityDefault(
        '99999999-9999-9999-9999-999999999999',
        'team',
      ),
    ).rejects.toThrow('Integration not found');
  });

  it('preserves per-integration visibility defaults when reconnecting', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const first = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub',
      externalAccountId: 'installation-1',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });

    const second = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub reconnected',
      externalAccountId: 'installation-1',
      visibilityDefault: 'team',
      visibilityDefaultUserIds: null,
    });

    expect(second.id).toBe(first.id);
    const [row] = await db.select().from(integrations).where(eq(integrations.id, first.id));
    expect(row).toMatchObject({
      displayName: 'GitHub reconnected',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });
  });

  it('does not validate discarded reconnect visibility defaults', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const first = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub',
      externalAccountId: 'installation-stale-default',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });

    const second = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub reconnected',
      externalAccountId: 'installation-stale-default',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: ['99999999-9999-9999-9999-999999999999'],
    });

    expect(second.id).toBe(first.id);
    const [row] = await db.select().from(integrations).where(eq(integrations.id, first.id));
    expect(row).toMatchObject({
      displayName: 'GitHub reconnected',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });
  });

  it('lists active members for the current team', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    await expect(ownerScope.timeline.listMembers()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: USER_A, role: 'owner' }),
        expect.objectContaining({ userId: USER_C, role: 'admin' }),
      ]),
    );
  });
});
