import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  messageDeliveries,
  teamDigestDestinations,
  telegramChatBindings,
} from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { withChatDeliveryPrincipal } from '#src/conversation-surfaces/deferred-delivery.js';
import { digestDestinationDedupeKey } from '#src/messaging/destinations.js';
import { HttpTelegramApi } from '#src/telegram/api.js';
import {
  applyTelegramChatMigration,
  parseTelegramMigratedChatId,
  rethrowTelegramChatMigrationWriteError,
  TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE,
  TelegramChatMigrationConflictError,
  telegramChatMigrationFromMessage,
  telegramMigratedChatId,
  telegramMigratedDigestRedirectDisposition,
  verifyTelegramChatMigrationOwnership,
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

  it('maps a binding unique-constraint error to a cross-team conflict', () => {
    const unique = Object.assign(new Error('Failed query: insert'), {
      cause: Object.assign(
        new Error(
          'duplicate key value violates unique constraint "telegram_chat_bindings_tg_chat_id_unique"',
        ),
        { code: '23505', constraint: 'telegram_chat_bindings_tg_chat_id_unique' },
      ),
    });
    expect(() => rethrowTelegramChatMigrationWriteError(unique)).toThrow(
      TelegramChatMigrationConflictError,
    );
    expect(() => rethrowTelegramChatMigrationWriteError(new Error('DB timeout'))).toThrow(
      'DB timeout',
    );
  });

  it('skips a redirected digest send when the migrated key was already sent', () => {
    const oldKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd: '2026-06-14T12:00:00.000Z',
      destination: { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID) },
    });
    const newKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd: '2026-06-14T12:00:00.000Z',
      destination: { kind: 'telegram_chat', targetId: String(NEW_CHAT_ID) },
    });
    expect(
      telegramMigratedDigestRedirectDisposition({
        inFlightDedupeKey: oldKey,
        teamId: TEAM_ID,
        fromChatId: OLD_CHAT_ID,
        toChatId: NEW_CHAT_ID,
        alreadySentDedupeKeys: [newKey],
      }),
    ).toEqual({ alreadyDelivered: true, skipRedirect: true });
    expect(
      telegramMigratedDigestRedirectDisposition({
        inFlightDedupeKey: oldKey,
        teamId: TEAM_ID,
        fromChatId: OLD_CHAT_ID,
        toChatId: NEW_CHAT_ID,
        alreadySentDedupeKeys: [],
        pendingDedupeKeys: [newKey],
      }),
    ).toEqual({ alreadyDelivered: false, skipRedirect: true });
    expect(
      telegramMigratedDigestRedirectDisposition({
        inFlightDedupeKey: undefined,
        teamId: TEAM_ID,
        fromChatId: OLD_CHAT_ID,
        toChatId: NEW_CHAT_ID,
        alreadySentDedupeKeys: [newKey],
      }),
    ).toEqual({ alreadyDelivered: false, skipRedirect: false });
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
    vi.unstubAllGlobals();
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

  it('fails closed when the sending team binding disappears before the write', async () => {
    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((...args: Parameters<typeof originalTransaction>) => {
      return (async () => {
        await pg.exec(`
          DELETE FROM telegram_chat_bindings WHERE tg_chat_id = ${OLD_CHAT_ID};
          INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
          VALUES (${NEW_CHAT_ID}, '${OTHER_TEAM_ID}', 'Other');
        `);
        return originalTransaction(...args);
      })();
    }) as typeof db.transaction;

    await expect(
      applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID, { sendingTeamId: TEAM_ID }),
    ).rejects.toThrow(TelegramChatMigrationConflictError);

    const bindings = await db.select().from(telegramChatBindings);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ tgChatId: NEW_CHAT_ID, teamId: OTHER_TEAM_ID });
    expect(
      (await db.select().from(teamDigestDestinations)).map((row) => ({
        teamId: row.teamId,
        targetId: row.targetId,
      })),
    ).toEqual([{ teamId: TEAM_ID, targetId: String(OLD_CHAT_ID) }]);
  });

  it('does not redirect a digest send after the sending team binding disappears', async () => {
    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((...args: Parameters<typeof originalTransaction>) => {
      return (async () => {
        await pg.exec(`
          DELETE FROM telegram_chat_bindings WHERE tg_chat_id = ${OLD_CHAT_ID};
          INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
          VALUES (${NEW_CHAT_ID}, '${OTHER_TEAM_ID}', 'Other');
        `);
        return originalTransaction(...args);
      })();
    }) as typeof db.transaction;
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: 'Bad Request: group chat was upgraded to a supergroup chat',
          parameters: { migrate_to_chat_id: NEW_CHAT_ID },
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      sendingTeamId: TEAM_ID,
      onChatMigrated: (fromChatId, toChatId) =>
        applyTelegramChatMigration(db, fromChatId, toChatId, { sendingTeamId: TEAM_ID }),
    });
    const input = { chat_id: OLD_CHAT_ID, text: 'Acme daily digest' };

    const error = await api.sendMessage(input).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE });
    expect(input.chat_id).toBe(OLD_CHAT_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.select().from(teamDigestDestinations)).toMatchObject([
      { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID), teamId: TEAM_ID },
    ]);
    expect(await db.select().from(telegramChatBindings)).toMatchObject([
      { tgChatId: NEW_CHAT_ID, teamId: OTHER_TEAM_ID },
    ]);
  });

  it('treats a unique-constraint race on the binding write as a cross-team conflict', async () => {
    const originalTransaction = db.transaction.bind(db);
    db.transaction = ((...args: Parameters<typeof originalTransaction>) => {
      return (async () => {
        await pg.exec(`
          INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
          VALUES (${NEW_CHAT_ID}, '${OTHER_TEAM_ID}', 'Other');
        `);
        return originalTransaction(...args);
      })();
    }) as typeof db.transaction;

    await expect(applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID)).rejects.toThrow(
      TelegramChatMigrationConflictError,
    );

    const bindings = await db.select().from(telegramChatBindings);
    expect(bindings).toHaveLength(2);
    expect(bindings.map((row) => ({ tgChatId: row.tgChatId, teamId: row.teamId }))).toEqual(
      expect.arrayContaining([
        { tgChatId: OLD_CHAT_ID, teamId: TEAM_ID },
        { tgChatId: NEW_CHAT_ID, teamId: OTHER_TEAM_ID },
      ]),
    );
    expect(
      (await db.select().from(teamDigestDestinations)).map((row) => ({
        teamId: row.teamId,
        targetId: row.targetId,
      })),
    ).toEqual([{ teamId: TEAM_ID, targetId: String(OLD_CHAT_ID) }]);
  });

  it('does not rewrite destinations when the new id is bound to another team', async () => {
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
      VALUES (${NEW_CHAT_ID}, '${OTHER_TEAM_ID}', 'Other');
      INSERT INTO team_digest_destinations (team_id, kind, target_id, label, enabled)
      VALUES ('${OTHER_TEAM_ID}', 'telegram_chat', '${NEW_CHAT_ID}', 'Other', true);
    `);

    await expect(applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID)).rejects.toThrow(
      TelegramChatMigrationConflictError,
    );

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

  it('rewrites workspace digest ledger keys with the migrated chat id', async () => {
    const windowEnd = '2026-06-14T12:00:00.000Z';
    const oldKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd,
      destination: { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID) },
    });
    const newKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd,
      destination: { kind: 'telegram_chat', targetId: String(NEW_CHAT_ID) },
    });
    const otherTeamKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: OTHER_TEAM_ID,
      windowEnd,
      destination: { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID) },
    });
    const slackKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd,
      destination: { kind: 'slack_channel', targetId: String(OLD_CHAT_ID) },
    });
    await db.insert(messageDeliveries).values([
      {
        intent: 'daily_digest',
        channel: 'telegram',
        teamId: TEAM_ID,
        status: 'sent',
        provider: 'telegram',
        dedupeKey: oldKey,
      },
      {
        intent: 'daily_digest',
        channel: 'telegram',
        teamId: OTHER_TEAM_ID,
        status: 'sent',
        provider: 'telegram',
        dedupeKey: otherTeamKey,
      },
      {
        intent: 'daily_digest',
        channel: 'slack',
        teamId: TEAM_ID,
        status: 'sent',
        provider: 'slack',
        dedupeKey: slackKey,
      },
    ]);

    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);

    expect(
      (await db.select({ dedupeKey: messageDeliveries.dedupeKey }).from(messageDeliveries)).map(
        (row) => row.dedupeKey,
      ),
    ).toEqual(expect.arrayContaining([newKey, otherTeamKey, slackKey]));
    expect(await db.select().from(messageDeliveries)).toHaveLength(3);
    expect(
      (await db.select({ dedupeKey: messageDeliveries.dedupeKey }).from(messageDeliveries)).map(
        (row) => row.dedupeKey,
      ),
    ).not.toContain(oldKey);
  });

  it('rewrites when the sending workspace owns the old binding', async () => {
    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID, { sendingTeamId: TEAM_ID });

    expect(await db.select().from(telegramChatBindings)).toMatchObject([
      { tgChatId: NEW_CHAT_ID, teamId: TEAM_ID, title: 'Sales' },
    ]);
    expect(await db.select().from(teamDigestDestinations)).toMatchObject([
      { kind: 'telegram_chat', targetId: String(NEW_CHAT_ID), teamId: TEAM_ID },
    ]);
  });

  it('does not redirect after the old group is unlinked and the supergroup is bound to another team', async () => {
    await pg.exec(`
      DELETE FROM telegram_chat_bindings WHERE tg_chat_id = ${OLD_CHAT_ID};
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
      VALUES (${NEW_CHAT_ID}, '${OTHER_TEAM_ID}', 'Other supergroup');
      INSERT INTO team_digest_destinations (team_id, kind, target_id, label, enabled)
      VALUES ('${OTHER_TEAM_ID}', 'telegram_chat', '${NEW_CHAT_ID}', 'Other', true);
    `);

    await expect(
      verifyTelegramChatMigrationOwnership(db, OLD_CHAT_ID, NEW_CHAT_ID, {
        sendingTeamId: TEAM_ID,
      }),
    ).rejects.toThrow(TelegramChatMigrationConflictError);
    await expect(
      applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID, { sendingTeamId: TEAM_ID }),
    ).rejects.toThrow(TelegramChatMigrationConflictError);

    expect(
      (await db.select().from(telegramChatBindings)).map((row) => ({
        tgChatId: row.tgChatId,
        teamId: row.teamId,
      })),
    ).toEqual([{ tgChatId: NEW_CHAT_ID, teamId: OTHER_TEAM_ID }]);
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

  it('does not retry a digest send into a supergroup later bound to another team', async () => {
    await pg.exec(`
      DELETE FROM telegram_chat_bindings WHERE tg_chat_id = ${OLD_CHAT_ID};
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, title)
      VALUES (${NEW_CHAT_ID}, '${OTHER_TEAM_ID}', 'Other supergroup');
    `);
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: 'Bad Request: group chat was upgraded to a supergroup chat',
          parameters: { migrate_to_chat_id: NEW_CHAT_ID },
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      sendingTeamId: TEAM_ID,
      onChatMigrated: (fromChatId, toChatId) =>
        applyTelegramChatMigration(db, fromChatId, toChatId, { sendingTeamId: TEAM_ID }),
    });
    const input = { chat_id: OLD_CHAT_ID, text: 'Acme daily digest' };

    const error = await api.sendMessage(input).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE });
    expect(input.chat_id).toBe(OLD_CHAT_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.select().from(teamDigestDestinations)).toMatchObject([
      { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID), teamId: TEAM_ID },
    ]);
    expect(await db.select().from(telegramChatBindings)).toMatchObject([
      { tgChatId: NEW_CHAT_ID, teamId: OTHER_TEAM_ID },
    ]);
  });

  it('does not authorize a leftover digest destination when neither chat is bound to the sender', async () => {
    await pg.exec(`DELETE FROM telegram_chat_bindings WHERE tg_chat_id = ${OLD_CHAT_ID};`);

    expect(
      await verifyTelegramChatMigrationOwnership(db, OLD_CHAT_ID, NEW_CHAT_ID, {
        sendingTeamId: TEAM_ID,
      }),
    ).toBeNull();
    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID, { sendingTeamId: TEAM_ID });

    expect(await db.select().from(telegramChatBindings)).toHaveLength(0);
    expect(await db.select().from(teamDigestDestinations)).toMatchObject([
      { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID), teamId: TEAM_ID },
    ]);
  });

  it('does not redirect a digest send when the new chat already received it', async () => {
    const windowEnd = '2026-06-14T12:00:00.000Z';
    const oldKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd,
      destination: { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID) },
    });
    const newKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd,
      destination: { kind: 'telegram_chat', targetId: String(NEW_CHAT_ID) },
    });
    await pg.exec(`
      INSERT INTO team_digest_destinations (team_id, kind, target_id, label, enabled)
      VALUES ('${TEAM_ID}', 'telegram_chat', '${NEW_CHAT_ID}', 'Sales supergroup', true);
    `);
    await db.insert(messageDeliveries).values([
      {
        intent: 'daily_digest',
        channel: 'telegram',
        teamId: TEAM_ID,
        status: 'pending',
        provider: 'telegram',
        dedupeKey: oldKey,
      },
      {
        intent: 'daily_digest',
        channel: 'telegram',
        teamId: TEAM_ID,
        status: 'sent',
        provider: 'telegram',
        dedupeKey: newKey,
      },
    ]);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: 'Bad Request: group chat was upgraded to a supergroup chat',
            parameters: { migrate_to_chat_id: NEW_CHAT_ID },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 99 } }));
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      sendingTeamId: TEAM_ID,
      onChatMigrated: (fromChatId, toChatId) =>
        applyTelegramChatMigration(db, fromChatId, toChatId, { sendingTeamId: TEAM_ID }),
    });
    const input = { chat_id: OLD_CHAT_ID, text: 'Acme daily digest' };

    await withChatDeliveryPrincipal({ teamId: TEAM_ID, dedupeKey: oldKey }, () =>
      api.sendMessage(input),
    );

    expect(input.chat_id).toBe(OLD_CHAT_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (await db.select({ dedupeKey: messageDeliveries.dedupeKey }).from(messageDeliveries)).map(
        (row) => row.dedupeKey,
      ),
    ).toEqual(expect.arrayContaining([oldKey, newKey]));
  });

  it('does not clobber an existing digest ledger key for the new chat id', async () => {
    const windowEnd = '2026-06-14T12:00:00.000Z';
    const oldKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd,
      destination: { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID) },
    });
    const newKey = digestDestinationDedupeKey({
      scope: 'workspace',
      teamId: TEAM_ID,
      windowEnd,
      destination: { kind: 'telegram_chat', targetId: String(NEW_CHAT_ID) },
    });
    await db.insert(messageDeliveries).values([
      {
        intent: 'daily_digest',
        channel: 'telegram',
        teamId: TEAM_ID,
        status: 'sent',
        provider: 'telegram',
        dedupeKey: oldKey,
      },
      {
        intent: 'daily_digest',
        channel: 'telegram',
        teamId: TEAM_ID,
        status: 'sent',
        provider: 'telegram',
        dedupeKey: newKey,
      },
    ]);

    await applyTelegramChatMigration(db, OLD_CHAT_ID, NEW_CHAT_ID);

    expect(
      (await db.select({ dedupeKey: messageDeliveries.dedupeKey }).from(messageDeliveries)).map(
        (row) => row.dedupeKey,
      ),
    ).toEqual(expect.arrayContaining([oldKey, newKey]));
    expect(await db.select().from(messageDeliveries)).toHaveLength(2);
  });
});
