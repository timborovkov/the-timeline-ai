import { PGlite } from '@electric-sql/pglite';
import { type Db, teamDigestDestinations, telegramChatBindings } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import {
  applyTelegramChatMigration,
  parseTelegramMigratedChatId,
  telegramChatMigrationFromMessage,
  telegramMigratedChatId,
} from '#src/telegram/chat-migration.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD_CHAT_ID = -123456;
const NEW_CHAT_ID = -1004317012921;

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_ID}', 'acme', 'Acme'),
      ('${OTHER_TEAM_ID}', 'other', 'Other');
    INSERT INTO users (id, email, name)
    VALUES ('${OWNER_ID}', 'owner@example.test', 'Owner');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
    INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
    VALUES (${OLD_CHAT_ID}, '${TEAM_ID}', 'Sales');
    INSERT INTO team_digest_destinations (team_id, kind, target_id, label, enabled)
    VALUES ('${TEAM_ID}', 'telegram_chat', '${OLD_CHAT_ID}', 'Sales', true);
  `);
}

describe('telegram chat migration helpers', () => {
  it('parses migrate_to_chat_id from the Telegram 400 body', () => {
    const body =
      '400 {"ok":false,"error_code":400,"description":"Bad Request: group chat was upgraded to a supergroup chat","parameters":{"migrate_to_chat_id":-1004317012921}}';
    expect(parseTelegramMigratedChatId(body)).toBe(NEW_CHAT_ID);
    expect(
      telegramMigratedChatId(
        Object.assign(new Error(`Telegram sendMessage failed: ${body}`), {
          migrateToChatId: NEW_CHAT_ID,
        }),
      ),
    ).toBe(NEW_CHAT_ID);
  });

  it('reads migrate_to and migrate_from on inbound service messages', () => {
    expect(
      telegramChatMigrationFromMessage({
        chat: { id: OLD_CHAT_ID },
        migrate_to_chat_id: NEW_CHAT_ID,
      }),
    ).toEqual({ fromChatId: OLD_CHAT_ID, toChatId: NEW_CHAT_ID });
    expect(
      telegramChatMigrationFromMessage({
        chat: { id: NEW_CHAT_ID },
        migrate_from_chat_id: OLD_CHAT_ID,
      }),
    ).toEqual({ fromChatId: OLD_CHAT_ID, toChatId: NEW_CHAT_ID });
    expect(telegramChatMigrationFromMessage({ chat: { id: OLD_CHAT_ID } })).toBeNull();
  });
});

describe('applyTelegramChatMigration', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg) as unknown as Db;
  });

  afterEach(async () => {
    await pg.close();
  });

  it('rewrites the chat binding and telegram digest destination', async () => {
    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);

    expect(await db.select().from(telegramChatBindings)).toMatchObject([
      { tgChatId: NEW_CHAT_ID, teamId: TEAM_ID, title: 'Sales' },
    ]);
    expect(await db.select().from(teamDigestDestinations)).toMatchObject([
      { kind: 'telegram_chat', targetId: String(NEW_CHAT_ID), teamId: TEAM_ID },
    ]);
  });

  it('is idempotent after the ids have already moved', async () => {
    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);
    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);

    expect(await db.select().from(telegramChatBindings)).toHaveLength(1);
    expect(await db.select().from(teamDigestDestinations)).toHaveLength(1);
    expect((await db.select().from(telegramChatBindings))[0]?.tgChatId).toBe(NEW_CHAT_ID);
  });

  it('drops the stale binding when the new id is already bound to the same team', async () => {
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
      VALUES (${NEW_CHAT_ID}, '${TEAM_ID}', 'Sales supergroup');
    `);

    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);

    const bindings = await db.select().from(telegramChatBindings);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ tgChatId: NEW_CHAT_ID, title: 'Sales supergroup' });
  });

  it('rewrites only the owning team digest destination', async () => {
    await pg.exec(`
      INSERT INTO team_digest_destinations (team_id, kind, target_id, label, enabled)
      VALUES ('${OTHER_TEAM_ID}', 'telegram_chat', '${OLD_CHAT_ID}', 'Other stale', true);
    `);

    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);

    expect(
      (await db.select().from(teamDigestDestinations)).map((row) => ({
        teamId: row.teamId,
        targetId: row.targetId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { teamId: TEAM_ID, targetId: String(NEW_CHAT_ID) },
        { teamId: OTHER_TEAM_ID, targetId: String(OLD_CHAT_ID) },
      ]),
    );
    expect(await db.select().from(teamDigestDestinations)).toHaveLength(2);
  });

  it('does not rewrite destinations when the new id is bound to another team', async () => {
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
      VALUES (${NEW_CHAT_ID}, '${OTHER_TEAM_ID}', 'Other');
      INSERT INTO team_digest_destinations (team_id, kind, target_id, label, enabled)
      VALUES ('${OTHER_TEAM_ID}', 'telegram_chat', '${NEW_CHAT_ID}', 'Other', true);
    `);

    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);

    const bindings = await db.select().from(telegramChatBindings);
    expect(bindings).toHaveLength(2);
    expect(bindings.map((row) => row.tgChatId).sort((a, b) => a - b)).toEqual([
      NEW_CHAT_ID,
      OLD_CHAT_ID,
    ]);
    expect(
      (await db.select().from(teamDigestDestinations)).map((row) => ({
        teamId: row.teamId,
        targetId: row.targetId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { teamId: TEAM_ID, targetId: String(OLD_CHAT_ID) },
        { teamId: OTHER_TEAM_ID, targetId: String(NEW_CHAT_ID) },
      ]),
    );
    expect(await db.select().from(teamDigestDestinations)).toHaveLength(2);
  });
});
