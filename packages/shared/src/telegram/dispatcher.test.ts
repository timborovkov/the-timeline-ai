import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TelegramApi } from '#src/telegram/api.js';

import { handleUpdate, parseCommand } from '#src/telegram/dispatcher.js';
import { verifyWebhookSecret } from '#src/telegram/secret.js';
import { tgUpdateSchema } from '#src/telegram/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TG_USER_ID = 7;

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

async function seedLinkedTelegramUser(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'team-a', 'Team A'), ('${OTHER_TEAM_ID}', 'team-b', 'Team B');
    INSERT INTO users (id, email) VALUES ('${USER_A}', 'a@example.com');
    INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_A}', 'owner');
    INSERT INTO telegram_users (id, tg_user_id, username, user_id)
    VALUES ('33333333-3333-3333-3333-333333333333', ${TG_USER_ID}, 'alice', '${USER_A}');
    INSERT INTO telegram_user_teams (telegram_user_id, team_id, linked_by_user_id, is_active)
    VALUES ('33333333-3333-3333-3333-333333333333', '${TEAM_ID}', '${USER_A}', true);
  `);
}

const fakeTg: TelegramApi = {
  sendMessage: () => Promise.resolve(),
  getChatAdministrators: () => Promise.resolve([]),
  answerCallbackQuery: () => Promise.resolve(),
  editMessageText: () => Promise.resolve(),
  getFile: () => Promise.reject(new Error('not used')),
  downloadFile: () => Promise.reject(new Error('not used')),
  setMessageReaction: () => Promise.resolve(),
  sendChatAction: () => Promise.resolve(),
};

async function activeTelegramRows(pg: PGlite) {
  const result = await pg.query<{
    id: string;
    content_text: string | null;
    source_metadata: Record<string, unknown>;
  }>(`
    SELECT id, content_text, source_metadata
    FROM raw_events
    WHERE source = 'telegram'
      AND COALESCE(source_metadata->>'deleted', 'false') <> 'true'
    ORDER BY occurred_at ASC, created_at ASC
  `);
  return result.rows;
}

async function allTelegramRows(pg: PGlite) {
  const result = await pg.query<{
    content_text: string | null;
    source_metadata: Record<string, unknown>;
  }>(`
    SELECT content_text, source_metadata
    FROM raw_events
    WHERE source = 'telegram'
    ORDER BY occurred_at ASC, created_at ASC
  `);
  return result.rows;
}

// These tests cover the pure pieces of the Telegram webhook flow:
//  - webhook secret verification (the auth gate on the route handler)
//  - command parsing edge cases (the routing primitive)
//  - update payload validation
// End-to-end message-to-raw_events insertion is verified manually via the
// ngrok flow documented in docs/setup/telegram.md (requires a real Postgres
// and a real bot token to drive Telegram).

describe('verifyWebhookSecret', () => {
  it('rejects when header is missing', () => {
    expect(verifyWebhookSecret(null, 'expected')).toBe(false);
    expect(verifyWebhookSecret(undefined, 'expected')).toBe(false);
    expect(verifyWebhookSecret('', 'expected')).toBe(false);
  });

  it('rejects when expected is missing', () => {
    expect(verifyWebhookSecret('header', null)).toBe(false);
    expect(verifyWebhookSecret('header', '')).toBe(false);
  });

  it('rejects when lengths differ', () => {
    expect(verifyWebhookSecret('short', 'much-longer-secret')).toBe(false);
  });

  it('rejects when values differ', () => {
    expect(verifyWebhookSecret('aaaaaa', 'bbbbbb')).toBe(false);
  });

  it('accepts exact match', () => {
    const secret = 'a'.repeat(64);
    expect(verifyWebhookSecret(secret, secret)).toBe(true);
  });
});

describe('parseCommand', () => {
  it('returns null for non-command text', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('parses a bare command', () => {
    expect(parseCommand('/help')).toEqual({ name: '/help', arg: '' });
  });

  it('parses a command with an argument', () => {
    expect(parseCommand('/link abc123')).toEqual({ name: '/link', arg: 'abc123' });
  });

  it('strips @botname suffix added in groups', () => {
    expect(parseCommand('/link@TimelineBot abc123')).toEqual({
      name: '/link',
      arg: 'abc123',
    });
    expect(parseCommand('/start@TimelineBot')).toEqual({ name: '/start', arg: '' });
  });

  it('lowercases the command name', () => {
    expect(parseCommand('/HELP')).toEqual({ name: '/help', arg: '' });
  });

  it('preserves argument case and internal whitespace', () => {
    expect(parseCommand('/link  ABC  DEF  ')).toEqual({ name: '/link', arg: 'ABC  DEF' });
  });
});

describe('tgUpdateSchema', () => {
  it('rejects payloads missing update_id', () => {
    expect(tgUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a minimal text message update', () => {
    const result = tgUpdateSchema.safeParse({
      update_id: 1,
      message: {
        message_id: 10,
        date: 1700000000,
        chat: { id: 42, type: 'private' },
        from: { id: 7, is_bot: false },
        text: 'hello',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an edited_message update', () => {
    const result = tgUpdateSchema.safeParse({
      update_id: 2,
      edited_message: {
        message_id: 10,
        date: 1700000100,
        chat: { id: 42, type: 'private' },
        from: { id: 7 },
        text: 'hello, edited',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a voice memo payload', () => {
    const result = tgUpdateSchema.safeParse({
      update_id: 4,
      message: {
        message_id: 11,
        date: 1700000200,
        chat: { id: 42, type: 'private' },
        from: { id: 7 },
        voice: { file_id: 'AwACAg...', duration: 5, mime_type: 'audio/ogg', file_size: 4096 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown chat.type', () => {
    const result = tgUpdateSchema.safeParse({
      update_id: 3,
      message: {
        message_id: 10,
        date: 1700000000,
        chat: { id: 42, type: 'invalid-chat-type' },
        text: 'hello',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('handleUpdate (fake-token guard)', () => {
  it('returns ok:false for an invalid payload without touching db', async () => {
    // If validation passed, the fake db (which has no methods) would throw.
    // It does not throw — the schema gate catches the bad payload first.
    const fakeDb = {} as never;
    const fakeTg = {
      sendMessage: () => Promise.resolve(),
      getChatAdministrators: () => Promise.resolve([]),
      answerCallbackQuery: () => Promise.resolve(),
      editMessageText: () => Promise.resolve(),
      getFile: () => Promise.reject(new Error('not used')),
      downloadFile: () => Promise.reject(new Error('not used')),
      setMessageReaction: () => Promise.resolve(),
      sendChatAction: () => Promise.resolve(),
    };
    const result = await handleUpdate({ db: fakeDb, tg: fakeTg }, { not_an_update: true });
    expect(result.ok).toBe(false);
  });
});

describe('handleUpdate telegram edit visibility', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    await seedLinkedTelegramUser(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('keeps only the latest visible row for a Telegram message after edits', async () => {
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 100,
        message: {
          message_id: 10,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'hello',
        },
      },
    );
    expect(await activeTelegramRows(pg)).toMatchObject([{ content_text: 'hello' }]);

    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 101,
        edited_message: {
          message_id: 10,
          date: 1700000000,
          edit_date: 1700000100,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'hello edited',
        },
      },
    );
    expect(await activeTelegramRows(pg)).toMatchObject([{ content_text: 'hello edited' }]);

    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 102,
        edited_message: {
          message_id: 10,
          date: 1700000000,
          edit_date: 1700000200,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'hello edited again',
        },
      },
    );

    const active = await activeTelegramRows(pg);
    expect(active).toMatchObject([{ content_text: 'hello edited again' }]);

    const all = await allTelegramRows(pg);
    expect(all).toHaveLength(3);
    expect(all[0]?.source_metadata).toMatchObject({
      deleted: true,
      delete_reason: 'telegram_superseded_by_edit',
    });
    expect(all[1]?.source_metadata).toMatchObject({
      deleted: true,
      delete_reason: 'telegram_superseded_by_edit',
    });
    expect(all[2]?.source_metadata).toMatchObject({
      tg_update_id: 102,
      tg_message_id: 10,
    });
  });

  it('does not insert another row when Telegram retries the same update_id', async () => {
    const payload = {
      update_id: 200,
      message: {
        message_id: 20,
        date: 1700000000,
        chat: { id: 42, type: 'private' },
        from: { id: TG_USER_ID, username: 'alice' },
        text: 'one delivery',
      },
    };

    await handleUpdate({ db: db as never, tg: fakeTg }, payload);
    await handleUpdate({ db: db as never, tg: fakeTg }, payload);

    const all = await allTelegramRows(pg);
    expect(all).toHaveLength(1);
    expect(all[0]?.content_text).toBe('one delivery');
  });

  it('enqueues extraction, embedding, and approval suggestions for captured DM text', async () => {
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const enqueueSuggestion = vi.fn().mockResolvedValue(undefined);

    await handleUpdate(
      {
        db: db as never,
        tg: fakeTg,
        extract: { enqueueExtract },
        embed: { enqueueEmbed },
        suggestions: { enqueueSuggestion },
      },
      {
        update_id: 204,
        message: {
          message_id: 24,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: "Let's meet on Monday and follow up with Acme and Globex.",
        },
      },
    );

    const rows = await activeTelegramRows(pg);
    expect(rows).toHaveLength(1);
    const rawEventId = rows[0]?.id;
    expect(rawEventId).toBeTruthy();
    expect(enqueueExtract).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
    expect(enqueueEmbed).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
    expect(enqueueSuggestion).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
  });

  it('does not enqueue text workers for file-only document messages', async () => {
    const enqueueExtract = vi.fn();
    const enqueueEmbed = vi.fn();
    const enqueueSuggestion = vi.fn();

    await handleUpdate(
      {
        db: db as never,
        tg: fakeTg,
        extract: { enqueueExtract },
        embed: { enqueueEmbed },
        suggestions: { enqueueSuggestion },
      },
      {
        update_id: 205,
        message: {
          message_id: 25,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          document: {
            file_id: 'doc-file',
            file_name: 'contract.pdf',
            mime_type: 'application/pdf',
            file_size: 1024,
          },
        },
      },
    );

    expect(enqueueExtract).not.toHaveBeenCalled();
    expect(enqueueEmbed).not.toHaveBeenCalled();
    expect(enqueueSuggestion).not.toHaveBeenCalled();
  });

  it('acks DM captures but not group captures', async () => {
    const reactions: unknown[] = [];
    const tg: TelegramApi = {
      ...fakeTg,
      setMessageReaction: (input) => {
        reactions.push(input);
        return Promise.resolve();
      },
    };

    await handleUpdate(
      { db: db as never, tg },
      {
        update_id: 210,
        message: {
          message_id: 21,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'dm capture',
        },
      },
    );
    expect(reactions).toHaveLength(1);

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...tg,
          getFile: () => Promise.resolve({ file_id: 'voice-file', file_path: 'voice.ogg' }),
          downloadFile: () => Promise.resolve(Buffer.from('voice')),
        },
        audio: {
          upload: () => Promise.resolve(),
          enqueueTranscribe: () => Promise.resolve(),
          buildAudioKey: ({ teamId, chatId, messageId, fileId, extension }) =>
            `teams/${teamId}/telegram/${chatId}/${messageId}-${fileId}.${extension}`,
        },
      },
      {
        update_id: 212,
        message: {
          message_id: 23,
          date: 1700000002,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          voice: { file_id: 'voice-file', duration: 4, mime_type: 'audio/ogg', file_size: 128 },
        },
      },
    );
    expect(reactions).toHaveLength(2);

    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, bound_by_user_id, title)
      VALUES (-100, '${TEAM_ID}', '${USER_A}', 'Sales');
    `);
    await handleUpdate(
      { db: db as never, tg },
      {
        update_id: 211,
        message: {
          message_id: 22,
          date: 1700000001,
          chat: { id: -100, type: 'supergroup', title: 'Sales' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'group capture',
        },
      },
    );

    expect(reactions).toHaveLength(2);
  });

  it('transcribes audio files sent through the Telegram document picker', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueTranscribe = vi.fn().mockResolvedValue(undefined);

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'song-file', file_path: 'song.mp3' }),
          downloadFile: () => Promise.resolve(Buffer.from('audio-bytes')),
        },
        audio: {
          upload,
          enqueueTranscribe,
          buildAudioKey: ({ teamId, chatId, messageId, fileId, extension }) =>
            `teams/${teamId}/telegram/${chatId}/${messageId}-${fileId}.${extension}`,
        },
      },
      {
        update_id: 213,
        message: {
          message_id: 24,
          date: 1700000003,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          document: {
            file_id: 'song-file',
            file_name: 'song.mp3',
            mime_type: 'audio/mpeg',
            file_size: 128,
          },
        },
      },
    );

    expect(upload).toHaveBeenCalledOnce();
    expect(enqueueTranscribe).toHaveBeenCalledOnce();
    const rows = await pg.query<{
      content_audio_url: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT content_audio_url, source_metadata AS metadata
       FROM raw_events
       WHERE content_audio_url IS NOT NULL`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.content_audio_url).toContain('song-file.mp3');
    expect(rows.rows[0]?.metadata).toMatchObject({
      tg_attachment_kind: 'audio',
      tg_file_id: 'song-file',
    });
  });

  it('does not tombstone another team with matching Telegram chat and message ids', async () => {
    await pg.query(
      `INSERT INTO raw_events (team_id, source, content_text, occurred_at, source_metadata)
       VALUES ($1, 'telegram', 'other team copy', now(), $2::jsonb)`,
      [
        OTHER_TEAM_ID,
        JSON.stringify({
          tg_chat_id: 42,
          tg_chat_type: 'private',
          tg_message_id: 30,
          tg_update_id: 999,
        }),
      ],
    );

    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 300,
        message: {
          message_id: 30,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'team a original',
        },
      },
    );
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 301,
        edited_message: {
          message_id: 30,
          date: 1700000000,
          edit_date: 1700000100,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'team a edit',
        },
      },
    );

    const other = await pg.query<{ deleted: string | null }>(
      `SELECT source_metadata->>'deleted' AS deleted
       FROM raw_events
       WHERE team_id = $1 AND content_text = 'other team copy'`,
      [OTHER_TEAM_ID],
    );
    expect(other.rows[0]?.deleted).toBeNull();
  });

  it('keeps the highest update_id visible when same-message edits arrive out of order', async () => {
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 400,
        message: {
          message_id: 40,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'original',
        },
      },
    );
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 402,
        edited_message: {
          message_id: 40,
          date: 1700000000,
          edit_date: 1700000100,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'newer edit',
        },
      },
    );
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 401,
        edited_message: {
          message_id: 40,
          date: 1700000000,
          edit_date: 1700000100,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'older edit delivered late',
        },
      },
    );

    const active = await activeTelegramRows(pg);
    expect(active).toMatchObject([{ content_text: 'newer edit' }]);

    const all = await allTelegramRows(pg);
    expect(all).toHaveLength(3);
    expect(all.filter((row) => row.source_metadata.deleted !== true)).toMatchObject([
      { content_text: 'newer edit' },
    ]);
  });
});
