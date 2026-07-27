import { PGlite } from '@electric-sql/pglite';
import {
  chatSurfaceTurns,
  meetingCaptureConfirmations,
  meetings,
  reconciliationEvidence,
  savedMeetingAliases,
  savedMeetings,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueueModule from '#src/queue/queues.js';
import type { TelegramApi } from '#src/telegram/api.js';

import { resetEnvForTests } from '#src/env.js';
import { resetMeetingBotProviderForTests } from '#src/meeting-bots/index.js';
import {
  handleUpdate,
  parseCommand,
  startTelegramTypingHeartbeat,
} from '#src/telegram/dispatcher.js';
import { verifyWebhookSecret } from '#src/telegram/secret.js';
import { tgUpdateSchema } from '#src/telegram/types.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', async (importOriginal) => ({
  ...(await importOriginal<typeof QueueModule>()),
  enqueueConversationAgentJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'turn' }),
}));

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TG_USER_ID = 7;

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

function recordingTg(messages: string[]): TelegramApi {
  return {
    ...fakeTg,
    sendMessage: (input) => {
      messages.push(input.text);
      return Promise.resolve();
    },
  };
}

function recordingTgPayloads(payloads: Parameters<TelegramApi['sendMessage']>[0][]): TelegramApi {
  return {
    ...fakeTg,
    sendMessage: (input) => {
      payloads.push(input);
      return Promise.resolve();
    },
  };
}

function installRecallFetchMock(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    if (href.includes('recall.test')) return Promise.resolve(Response.json({ id: 'bot-tg-1' }));
    return Promise.resolve(Response.json({ ok: true }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function seedSavedMeeting(db: ReturnType<typeof drizzle>, alias = 'daily'): Promise<string> {
  const [saved] = await db
    .insert(savedMeetings)
    .values({
      teamId: TEAM_ID,
      createdByUserId: USER_A,
      title: 'Internal daily meeting',
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/telegram-saved-test',
      permissionConfirmedAt: new Date(),
      permissionConfirmedByUserId: USER_A,
      durationMinutes: 30,
      autoJoinEnabled: false,
    })
    .returning();
  if (!saved) throw new Error('expected saved meeting');
  await db.insert(savedMeetingAliases).values({
    savedMeetingId: saved.id,
    teamId: TEAM_ID,
    alias,
    normalizedAlias: alias,
  });
  return saved.id;
}

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

function audioDeps(overrides: Partial<Parameters<typeof handleUpdate>[0]['audio']> = {}) {
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    enqueueTranscribe: vi.fn().mockResolvedValue(undefined),
    buildAudioKey: ({ teamId, chatId, messageId, fileId, extension }) =>
      `teams/${teamId}/telegram/${chatId}/${messageId}-${fileId}.${extension}`,
    ...overrides,
  } satisfies NonNullable<Parameters<typeof handleUpdate>[0]['audio']>;
}

async function audioRows(pg: PGlite) {
  const result = await pg.query<{
    id: string;
    team_id: string;
    author_user_id: string | null;
    content_text: string | null;
    content_audio_url: string | null;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, team_id, author_user_id, content_text, content_audio_url, source_metadata AS metadata
     FROM raw_events
     WHERE content_audio_url IS NOT NULL
     ORDER BY created_at ASC`,
  );
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

describe('startTelegramTypingHeartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes Telegram typing every four seconds and stops cleanly after the answer is ready', async () => {
    vi.useFakeTimers();
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const stop = startTelegramTypingHeartbeat({ ...fakeTg, sendChatAction }, 42);

    expect(sendChatAction).toHaveBeenCalledTimes(1);
    expect(sendChatAction).toHaveBeenLastCalledWith({ chat_id: 42, action: 'typing' });

    await vi.advanceTimersByTimeAsync(8_000);
    expect(sendChatAction).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(sendChatAction).toHaveBeenCalledTimes(3);
  });

  it('does not overlap typing requests when Telegram is slow', async () => {
    vi.useFakeTimers();
    let resolveRequest: (() => void) | undefined;
    const sendChatAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const stop = startTelegramTypingHeartbeat({ ...fakeTg, sendChatAction }, 42);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(sendChatAction).toHaveBeenCalledOnce();

    resolveRequest?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendChatAction).toHaveBeenCalledTimes(2);

    stop();
  });

  it('does not send a queued refresh after /ask finishes', async () => {
    vi.useFakeTimers();
    let resolveRequest: (() => void) | undefined;
    const sendChatAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const stop = startTelegramTypingHeartbeat({ ...fakeTg, sendChatAction }, 42);

    await vi.advanceTimersByTimeAsync(4_000);
    stop();
    resolveRequest?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendChatAction).toHaveBeenCalledOnce();
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
  let askEnvBeforeEach: Record<
    'OPENROUTER_API_KEY' | 'QDRANT_URL' | 'REDIS_URL',
    string | undefined
  >;

  beforeEach(async () => {
    askEnvBeforeEach = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      QDRANT_URL: process.env.QDRANT_URL,
      REDIS_URL: process.env.REDIS_URL,
    };
    process.env.AUTH_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
    process.env.AUTH_URL = 'https://timeline.test';
    process.env.RECALL_API_KEY = 'recall-test-key';
    process.env.RECALL_BASE_URL = 'https://recall.test/api/v1';
    process.env.RECALL_STATUS_WEBHOOK_SECRET = `whsec_${Buffer.from('telegram-status').toString('base64')}`;
    // Dispatcher tests must not inherit a developer's live LLM configuration:
    // the /ask group-routing case intentionally exercises the unconfigured reply.
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.QDRANT_URL;
    delete process.env.REDIS_URL;
    resetEnvForTests();
    resetMeetingBotProviderForTests();
    installRecallFetchMock();
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seedLinkedTelegramUser(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetMeetingBotProviderForTests();
    await pg.close();
    const { OPENROUTER_API_KEY, QDRANT_URL, REDIS_URL } = askEnvBeforeEach;
    if (OPENROUTER_API_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = OPENROUTER_API_KEY;
    if (QDRANT_URL === undefined) delete process.env.QDRANT_URL;
    else process.env.QDRANT_URL = QDRANT_URL;
    if (REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = REDIS_URL;
    resetEnvForTests();
  });

  it('keeps only the latest visible row for an explicit Telegram note after edits', async () => {
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 100,
        message: {
          message_id: 10,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/note hello',
        },
      },
    );
    const [initial] = await activeTelegramRows(pg);
    expect(initial).toMatchObject({
      content_text: 'hello',
      source_metadata: {
        source_payload_ref: 'inline://timeline/telegram/42/10/100',
        source_snapshot_kind: 'telegram_message_update',
        source_snapshot_version: 'telegram-source-snapshot-2026-07',
        source_snapshot: {
          update_id: 100,
          chat_id: 42,
          chat_title: null,
          chat_type: 'private',
          date: 1700000000,
          edit_date: null,
          message_id: 10,
          provider: 'telegram',
          sender_id: TG_USER_ID,
          sender_name: '@alice',
          text: '/note hello',
          username: 'alice',
          audio: null,
          caption: null,
          document: null,
          entities: [],
          photo: [],
          voice: null,
        },
      },
    });
    expect(initial?.source_metadata.payload_digest).toEqual(
      expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    );
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        eq(
          reconciliationEvidence.rawEventId,
          initial?.id ?? '00000000-0000-0000-0000-000000000000',
        ),
      );
    expect(evidence).toMatchObject({
      source: 'telegram',
      provider: 'telegram',
      externalObjectId: '42:10',
      externalEventId: '100',
      replayState: 'full',
      sourcePayloadRef: 'inline://timeline/telegram/42/10/100',
    });
    expect(evidence?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));

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
          text: '/note hello edited',
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
          text: '/note hello edited again',
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
        text: '/note one delivery',
      },
    };

    await handleUpdate({ db: db as never, tg: fakeTg }, payload);
    await handleUpdate({ db: db as never, tg: fakeTg }, payload);

    const all = await allTelegramRows(pg);
    expect(all).toHaveLength(1);
    expect(all[0]?.content_text).toBe('one delivery');
  });

  it('captures shared links as metadata and timeline artifact evidence', async () => {
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 203,
        message: {
          message_id: 23,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/note Review https://example.com/deck?utm_source=tg&token=secret&a=1. Call +1 213-373-4253.',
        },
      },
    );

    const rows = await activeTelegramRows(pg);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source_metadata).toMatchObject({
      links: [
        {
          canonical_url: 'https://example.com/deck?a=1',
          display_url: 'example.com/deck',
          domain: 'example.com',
          provider: null,
          provider_object_id: null,
        },
      ],
      contacts: {
        emails: [],
        phones: [expect.objectContaining({ normalized_value: '+12133734253' })],
        addresses: [],
      },
    });

    const artifacts = await pg.query<{
      artifact_type: string;
      canonical_name: string;
      raw_event_id: string;
      role: string;
      strength: string;
      anchor_type: string;
      anchor_value: string;
    }>(`
      SELECT ac.artifact_type, ac.canonical_name, aea.raw_event_id, aea.role, aea.strength,
             aca.anchor_type, aca.anchor_value
      FROM artifact_clusters ac
      JOIN artifact_evidence_associations aea ON aea.cluster_id = ac.id
      JOIN artifact_cluster_anchors aca ON aca.cluster_id = ac.id
      WHERE ac.team_id = '${TEAM_ID}'
      ORDER BY aca.anchor_type
    `);
    expect(artifacts.rows).toEqual([
      {
        artifact_type: 'link',
        canonical_name: 'example.com/deck',
        raw_event_id: rows[0]?.id,
        role: 'related_context',
        strength: 'semantic',
        anchor_type: 'url:canonical',
        anchor_value: 'https://example.com/deck?a=1',
      },
      {
        artifact_type: 'link',
        canonical_name: 'example.com/deck',
        raw_event_id: rows[0]?.id,
        role: 'related_context',
        strength: 'semantic',
        anchor_type: 'url:display',
        anchor_value: 'example.com/deck',
      },
    ]);
  });

  it('keeps links with the same display path but different meaningful query params separate', async () => {
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 204,
        message: {
          message_id: 24,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/note Deck https://example.com/deck?a=1',
        },
      },
    );
    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 205,
        message: {
          message_id: 25,
          date: 1700000060,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/note Deck https://example.com/deck?a=2',
        },
      },
    );

    const clusters = await pg.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM artifact_clusters
      WHERE team_id = '${TEAM_ID}'
        AND artifact_type = 'link'
    `);
    expect(clusters.rows[0]?.count).toBe('2');
  });

  it('repairs missing link artifacts when Telegram retries an already-inserted update', async () => {
    const payload = {
      update_id: 206,
      message: {
        message_id: 26,
        date: 1700000000,
        chat: { id: 42, type: 'private' },
        from: { id: TG_USER_ID, username: 'alice' },
        text: '/note Spec https://example.com/spec',
      },
    };

    await handleUpdate({ db: db as never, tg: fakeTg }, payload);
    await pg.exec(`
      DELETE FROM artifact_evidence_associations;
      DELETE FROM artifact_cluster_members;
      DELETE FROM artifact_cluster_anchors;
      DELETE FROM artifact_clusters;
    `);
    await handleUpdate({ db: db as never, tg: fakeTg }, payload);

    const all = await allTelegramRows(pg);
    expect(all).toHaveLength(1);
    const artifacts = await pg.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM artifact_evidence_associations
      WHERE raw_event_id = (SELECT id FROM raw_events WHERE source = 'telegram')
    `);
    expect(artifacts.rows[0]?.count).toBe('1');
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
          text: "/note Let's meet on Monday and follow up with Acme and Globex.",
        },
      },
    );

    const rows = await activeTelegramRows(pg);
    expect(rows).toHaveLength(1);
    const rawEventId = rows[0]?.id;
    expect(rawEventId).toBeTruthy();
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        eq(reconciliationEvidence.rawEventId, rawEventId ?? '00000000-0000-0000-0000-000000000000'),
      );
    expect(evidence).toMatchObject({
      source: 'telegram',
      provider: 'telegram',
      externalObjectId: '42:24',
      externalEventId: '204',
      eventType: 'telegram.message',
      replayState: 'full',
      sourcePayloadRef: 'inline://timeline/telegram/42/24/204',
      visibility: 'team',
    });
    expect(evidence?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(enqueueExtract).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
    expect(enqueueEmbed).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
    expect(enqueueSuggestion).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
  });

  it('lists every supported DM command in /help', async () => {
    const messages: string[] = [];

    await handleUpdate(
      { db: db as never, tg: recordingTg(messages) },
      {
        update_id: 215,
        message: {
          message_id: 35,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/help',
        },
      },
    );

    expect(messages).toHaveLength(1);
    for (const command of [
      '/start',
      '/ask',
      '/note',
      '/new',
      '/join',
      '/link',
      '/team',
      '/whereami',
      '/unlink',
      '/help',
    ]) {
      expect(messages[0]).toContain(command);
    }
  });

  it('lists every supported group command in /help', async () => {
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, bound_by_user_id, title)
      VALUES (-100, '${TEAM_ID}', '${USER_A}', 'Sales');
    `);
    const messages: string[] = [];

    await handleUpdate(
      { db: db as never, tg: recordingTg(messages) },
      {
        update_id: 216,
        message: {
          message_id: 36,
          date: 1700000000,
          chat: { id: -100, type: 'supergroup', title: 'Sales' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/help',
        },
      },
    );

    expect(messages).toHaveLength(1);
    for (const command of [
      '/start',
      '/ask',
      '/join',
      '/link',
      '/team',
      '/whereami',
      '/unlink',
      '/help',
    ]) {
      expect(messages[0]).toContain(command);
    }
  });

  it('joins a Saved Meeting alias immediately from /join', async () => {
    const payloads: Parameters<TelegramApi['sendMessage']>[0][] = [];
    const tg = recordingTgPayloads(payloads);
    const savedMeetingId = await seedSavedMeeting(db);

    await handleUpdate(
      { db: db as never, tg },
      {
        update_id: 216,
        message: {
          message_id: 36,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/join daily',
        },
      },
    );

    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Joining as Team A's thetimeline.cc bot." }),
      ]),
    );
    const row = (
      await db.select().from(meetings).where(eq(meetings.savedMeetingId, savedMeetingId))
    )[0];
    expect(row).toMatchObject({
      status: 'joining',
      providerBotId: 'bot-tg-1',
      title: 'Internal daily meeting',
      meetingUrl: 'https://meet.google.com/telegram-saved-test',
    });
  });

  it('uses inline buttons and direct-reply fallback for raw URL /join confirmations', async () => {
    const payloads: Parameters<TelegramApi['sendMessage']>[0][] = [];
    const tg = recordingTgPayloads(payloads);

    await handleUpdate(
      { db: db as never, tg },
      {
        update_id: 217,
        message: {
          message_id: 37,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/join https://meet.google.com/raw-url-tg Design review',
        },
      },
    );

    const pending = await db.select().from(meetingCaptureConfirmations);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      status: 'pending',
      meetingUrl: 'https://meet.google.com/raw-url-tg',
      title: 'Design review',
      source: 'telegram',
    });
    expect(payloads[0]).toMatchObject({
      text: 'Timeline will join after you confirm participants know this call will be transcribed.',
      reply_markup: {
        inline_keyboard: [
          [
            expect.objectContaining({ text: 'Confirm and join' }),
            expect.objectContaining({ text: 'Cancel' }),
          ],
        ],
      },
    });
    expect(await db.select().from(meetings)).toHaveLength(0);

    await handleUpdate(
      { db: db as never, tg },
      {
        update_id: 218,
        message: {
          message_id: 38,
          date: 1700000001,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'yeah sure',
        },
      },
    );

    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Joining as Team A's thetimeline.cc bot." }),
      ]),
    );
    const confirmed = await db.select().from(meetingCaptureConfirmations);
    expect(confirmed[0]).toMatchObject({ status: 'confirmed' });
    const rows = await db.select().from(meetings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'joining',
      providerBotId: 'bot-tg-1',
      title: 'Design review',
      meetingUrl: 'https://meet.google.com/raw-url-tg',
    });
  });

  it('routes passive Telegram text to the agent instead of treating it as a join request', async () => {
    const payloads: Parameters<TelegramApi['sendMessage']>[0][] = [];

    await handleUpdate(
      { db: db as never, tg: recordingTgPayloads(payloads) },
      {
        update_id: 219,
        message: {
          message_id: 39,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: 'everyone join daily meeting in the conference room now',
        },
      },
    );

    expect(payloads).toHaveLength(0);
    expect(await db.select().from(meetings)).toHaveLength(0);
    expect(await db.select().from(meetingCaptureConfirmations)).toHaveLength(0);
    expect(await activeTelegramRows(pg)).toHaveLength(0);
    expect(await db.select().from(chatSurfaceTurns)).toMatchObject([
      {
        surface: 'telegram',
        questionText: 'everyone join daily meeting in the conference room now',
        status: 'queued',
      },
    ]);
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

  it('captures DM voice as an audio raw event and enqueues transcription', async () => {
    const audio = audioDeps();

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'voice-file', file_path: 'voice.ogg' }),
          downloadFile: () => Promise.resolve(Buffer.from('voice-bytes')),
        },
        audio,
      },
      {
        update_id: 206,
        message: {
          message_id: 26,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          caption: 'lead chat',
          voice: { file_id: 'voice-file', duration: 4, mime_type: 'audio/ogg', file_size: 128 },
        },
      },
    );

    const rows = await audioRows(pg);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      team_id: TEAM_ID,
      author_user_id: USER_A,
      content_text: null,
    });
    expect(rows[0]?.content_audio_url).toContain('voice-file.ogg');
    expect(rows[0]?.metadata).toMatchObject({
      audio_kind: 'voice',
      audio_mime_type: 'audio/ogg',
      tg_caption: 'lead chat',
      tg_file_id: 'voice-file',
    });
    expect(audio.upload).toHaveBeenCalledWith(
      expect.objectContaining({ body: Buffer.from('voice-bytes'), contentType: 'audio/ogg' }),
    );
    expect(audio.enqueueTranscribe).toHaveBeenCalledWith({
      rawEventId: rows[0]?.id,
      teamId: TEAM_ID,
      audioKey: rows[0]?.content_audio_url,
    });
  });

  it('captures bound group voice with group metadata and transcribe handoff', async () => {
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, bound_by_user_id, title)
      VALUES (-100, '${TEAM_ID}', '${USER_A}', 'Sales');
    `);
    const audio = audioDeps();

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'group-voice', file_path: 'group.ogg' }),
          downloadFile: () => Promise.resolve(Buffer.from('group-voice')),
        },
        audio,
      },
      {
        update_id: 207,
        message: {
          message_id: 27,
          date: 1700000000,
          chat: { id: -100, type: 'supergroup', title: 'Sales' },
          from: { id: TG_USER_ID, username: 'alice' },
          voice: { file_id: 'group-voice', duration: 3, mime_type: 'audio/ogg', file_size: 100 },
        },
      },
    );

    const rows = await audioRows(pg);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({
      tg_chat_id: -100,
      tg_chat_title: 'Sales',
      tg_chat_type: 'supergroup',
      tg_file_id: 'group-voice',
    });
    expect(audio.enqueueTranscribe).toHaveBeenCalledWith({
      rawEventId: rows[0]?.id,
      teamId: TEAM_ID,
      audioKey: rows[0]?.content_audio_url,
    });
  });

  it('captures captions as text work while routing photos to document extraction', async () => {
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const enqueueSuggestion = vi.fn().mockResolvedValue(undefined);
    const enqueueDocumentExtract = vi.fn().mockResolvedValue(undefined);

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'photo-large', file_path: 'photo.jpg' }),
          downloadFile: () => Promise.resolve(Buffer.from('jpeg-bytes')),
        },
        extract: { enqueueExtract },
        embed: { enqueueEmbed },
        suggestions: { enqueueSuggestion },
        documents: {
          upload: vi.fn().mockResolvedValue(undefined),
          enqueueExtract: enqueueDocumentExtract,
        },
      },
      {
        update_id: 208,
        message: {
          message_id: 28,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          caption: "I'll follow up with the photo lead next Monday",
          photo: [
            { file_id: 'photo-small', width: 64, height: 64, file_size: 64 },
            { file_id: 'photo-large', width: 1024, height: 768, file_size: 1024 },
          ],
        },
      },
    );

    const rows = await activeTelegramRows(pg);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content_text).toBe("I'll follow up with the photo lead next Monday");
    expect(enqueueExtract).toHaveBeenCalledWith({ rawEventId: rows[0]?.id, teamId: TEAM_ID });
    expect(enqueueEmbed).toHaveBeenCalledWith({ rawEventId: rows[0]?.id, teamId: TEAM_ID });
    expect(enqueueSuggestion).toHaveBeenCalledWith({ rawEventId: rows[0]?.id, teamId: TEAM_ID });
    expect(enqueueDocumentExtract).toHaveBeenCalledOnce();
  });

  it('routes image-only messages to document extraction without direct approval enqueue', async () => {
    const enqueueSuggestion = vi.fn();
    const enqueueDocumentExtract = vi.fn().mockResolvedValue(undefined);

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'image-only', file_path: 'image.jpg' }),
          downloadFile: () => Promise.resolve(Buffer.from('image-bytes')),
        },
        suggestions: { enqueueSuggestion },
        documents: {
          upload: vi.fn().mockResolvedValue(undefined),
          enqueueExtract: enqueueDocumentExtract,
        },
      },
      {
        update_id: 209,
        message: {
          message_id: 29,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          photo: [{ file_id: 'image-only', width: 800, height: 600, file_size: 900 }],
        },
      },
    );

    expect(enqueueSuggestion).not.toHaveBeenCalled();
    expect(enqueueDocumentExtract).toHaveBeenCalledOnce();
  });

  it('drops voice messages when audio ingest is not configured', async () => {
    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: vi.fn(),
          downloadFile: vi.fn(),
        },
      },
      {
        update_id: 214,
        message: {
          message_id: 34,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          voice: { file_id: 'voice-no-config', duration: 2, mime_type: 'audio/ogg', file_size: 50 },
        },
      },
    );

    expect(await audioRows(pg)).toHaveLength(0);
    expect(await allTelegramRows(pg)).toHaveLength(0);
  });

  it('does not duplicate a retried voice webhook and retries the transcribe handoff', async () => {
    const enqueueTranscribe = vi
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValue(undefined);
    const audio = audioDeps({ enqueueTranscribe });
    const payload = {
      update_id: 215,
      message: {
        message_id: 35,
        date: 1700000000,
        chat: { id: 42, type: 'private' },
        from: { id: TG_USER_ID, username: 'alice' },
        voice: { file_id: 'voice-retry', duration: 2, mime_type: 'audio/ogg', file_size: 50 },
      },
    };

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'voice-retry', file_path: 'retry.ogg' }),
          downloadFile: () => Promise.resolve(Buffer.from('retry')),
        },
        audio,
      },
      payload,
    );
    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'voice-retry', file_path: 'retry.ogg' }),
          downloadFile: () => Promise.resolve(Buffer.from('retry')),
        },
        audio,
      },
      payload,
    );

    const rows = await audioRows(pg);
    expect(rows).toHaveLength(1);
    expect(enqueueTranscribe).toHaveBeenCalledTimes(2);
    expect(rows[0]?.metadata).toMatchObject({
      transcription_error: 'enqueue failed: redis down',
    });
  });

  it('stores Telegram attachment metadata on captured files without synthetic document events', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'doc-file', file_path: 'contract.pdf' }),
          downloadFile: () => Promise.resolve(Buffer.from('%PDF-1.7')),
        },
        documents: { upload, enqueueExtract },
      },
      {
        update_id: 206,
        message: {
          message_id: 26,
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

    expect(upload).toHaveBeenCalledOnce();
    expect(enqueueExtract).toHaveBeenCalledOnce();
    const eventRows = await pg.query(`SELECT id FROM raw_events WHERE source = 'document'`);
    expect(eventRows.rows).toHaveLength(0);
    const rows = await pg.query<{
      file_kind: string;
      folder_id: string | null;
      source_raw_event_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT file_kind, folder_id, source_raw_event_id, metadata
       FROM documents
       WHERE name = 'contract.pdf'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.file_kind).toBe('captured');
    expect(rows.rows[0]?.folder_id).toBeNull();
    expect(rows.rows[0]?.source_raw_event_id).toBeTruthy();
    expect(rows.rows[0]?.metadata).toMatchObject({
      source: 'telegram',
      tg_file_id: 'doc-file',
    });
  });

  it('stores the binding owner on private captured files from unlinked Telegram senders', async () => {
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, bound_by_user_id, title)
      VALUES (-100, '${TEAM_ID}', '${USER_A}', 'Private Group');
      INSERT INTO team_visibility_defaults (
        team_id,
        source,
        visibility,
        source_owner_user_id,
        updated_by_user_id
      )
      VALUES ('${TEAM_ID}', 'telegram', 'private', '${USER_A}', '${USER_A}')
      ON CONFLICT (team_id, source) DO UPDATE
      SET visibility = EXCLUDED.visibility,
          source_owner_user_id = EXCLUDED.source_owner_user_id,
          updated_by_user_id = EXCLUDED.updated_by_user_id;
    `);
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () => Promise.resolve({ file_id: 'group-doc', file_path: 'group.pdf' }),
          downloadFile: () => Promise.resolve(Buffer.from('%PDF-1.7')),
        },
        documents: { upload, enqueueExtract },
      },
      {
        update_id: 207,
        message: {
          message_id: 27,
          date: 1700000000,
          chat: { id: -100, type: 'supergroup', title: 'Private Group' },
          from: { id: 99, username: 'unlinked' },
          document: {
            file_id: 'group-doc',
            file_name: 'group.pdf',
            mime_type: 'application/pdf',
            file_size: 1024,
          },
        },
      },
    );

    const rows = await pg.query<{
      owner_user_id: string | null;
      visibility: string;
      raw_visibility_owner_user_id: string | null;
    }>(
      `SELECT
         d.owner_user_id,
         d.visibility,
         r.visibility_owner_user_id AS raw_visibility_owner_user_id
       FROM documents d
       JOIN raw_events r ON r.id = d.source_raw_event_id
       WHERE d.name = 'group.pdf'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      owner_user_id: USER_A,
      visibility: 'private',
      raw_visibility_owner_user_id: USER_A,
    });
  });

  it('shows the team name with the uuid for the sole linked Telegram team', async () => {
    const messages: string[] = [];

    await handleUpdate(
      { db: db as never, tg: recordingTg(messages) },
      {
        update_id: 206,
        message: {
          message_id: 26,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/team',
        },
      },
    );

    expect(messages).toEqual([`Only one team: Team A (${TEAM_ID}). It's now active.`]);
  });

  it('shows team names with uuids when listing and switching Telegram teams', async () => {
    const messages: string[] = [];
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${OTHER_TEAM_ID}', '${USER_A}', 'member');
    `);

    await handleUpdate(
      { db: db as never, tg: recordingTg(messages) },
      {
        update_id: 207,
        message: {
          message_id: 27,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/team',
        },
      },
    );
    await handleUpdate(
      { db: db as never, tg: recordingTg(messages) },
      {
        update_id: 208,
        message: {
          message_id: 28,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/team 2',
        },
      },
    );

    expect(messages).toEqual([
      `Your teams:\n1. Team A (${TEAM_ID})  ← active\n2. Team B (${OTHER_TEAM_ID})\n\nTo switch, reply with /team <number> (e.g. /team 2).`,
      `Active team is now Team B (${OTHER_TEAM_ID}). I started a new conversation.`,
    ]);
  });

  it('shows the team name with the uuid in /whereami', async () => {
    const messages: string[] = [];

    await handleUpdate(
      { db: db as never, tg: recordingTg(messages) },
      {
        update_id: 209,
        message: {
          message_id: 29,
          date: 1700000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          text: '/whereami',
        },
      },
    );

    expect(messages).toEqual([
      `Active team: Team A (${TEAM_ID}). Messages you send here land in that team's timeline.`,
    ]);
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
          text: '/note dm capture',
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
      id: string;
      content_audio_url: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, content_audio_url, source_metadata AS metadata
       FROM raw_events
       WHERE content_audio_url IS NOT NULL`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.content_audio_url).toContain('song-file.mp3');
    expect(rows.rows[0]?.metadata).toMatchObject({
      tg_attachment_kind: 'audio',
      tg_file_id: 'song-file',
      source_payload_ref: 'inline://timeline/telegram/42/24/attachment/song-file',
      source_snapshot_kind: 'telegram_audio_attachment',
      source_snapshot_version: 'telegram-source-snapshot-2026-07',
      source_snapshot: {
        provider: 'telegram',
        capture_kind: 'audio_attachment',
        file: { file_id: 'song-file', file_name: 'song.mp3', mime_type: 'audio/mpeg' },
      },
    });
    expect(rows.rows[0]?.metadata.payload_digest).toEqual(
      expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    );
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        eq(
          reconciliationEvidence.rawEventId,
          rows.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000',
        ),
      );
    expect(evidence).toMatchObject({
      source: 'telegram',
      provider: 'telegram',
      replayState: 'full',
      sourcePayloadRef: 'inline://timeline/telegram/42/24/attachment/song-file',
    });
    expect(evidence?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
  });

  it('keeps Telegram m4a document-picker audio visible and marks transcribe enqueue failures', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueTranscribe = vi.fn().mockRejectedValue(new Error('redis down'));

    await handleUpdate(
      {
        db: db as never,
        tg: {
          ...fakeTg,
          getFile: () =>
            Promise.resolve({ file_id: 'meeting-recording', file_path: 'recording.m4a' }),
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
        update_id: 216,
        message: {
          message_id: 36,
          date: 1700000005,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          document: {
            file_id: 'meeting-recording',
            file_name: 'Nexia palaveri nauhoitus.m4a',
            mime_type: 'audio/x-m4a',
            file_size: 128,
          },
        },
      },
    );

    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'audio/x-m4a' }));
    const rows = await allTelegramRows(pg);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.content_text).toBe('Attached file Nexia palaveri nauhoitus.m4a');
    const child = rows.find((row) => row.source_metadata.tg_attachment_kind === 'audio');
    expect(child?.source_metadata).toMatchObject({
      audio_mime_type: 'audio/x-m4a',
      source_payload_ref: 'inline://timeline/telegram/42/36/attachment/meeting-recording',
      source_snapshot_kind: 'telegram_audio_attachment',
      transcription_error: 'enqueue failed: redis down',
    });
  });

  it('stores Telegram sender display names as source truth metadata', async () => {
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, bound_by_user_id, title)
      VALUES (-200, '${TEAM_ID}', '${USER_A}', 'AuditAI');
    `);

    await handleUpdate(
      { db: db as never, tg: fakeTg },
      {
        update_id: 214,
        message: {
          message_id: 25,
          date: 1700000004,
          chat: { id: -200, type: 'supergroup', title: 'AuditAI' },
          from: {
            id: 7503673734,
            first_name: 'Otto',
            last_name: 'Silventola',
            username: 'otto',
          },
          text: 'group sender metadata',
        },
      },
    );

    const rows = await pg.query<{ metadata: Record<string, unknown> }>(
      `SELECT source_metadata AS metadata
       FROM raw_events
       WHERE content_text = 'group sender metadata'`,
    );
    expect(rows.rows[0]?.metadata).toMatchObject({
      tg_sender_name: 'Otto Silventola',
      tg_username: 'otto',
      tg_chat_title: 'AuditAI',
      source_unverified: true,
    });
  });

  it('lets unlinked Telegram senders use /ask in a bound group as the team bot actor', async () => {
    const messages: string[] = [];
    await pg.exec(`
      INSERT INTO telegram_chat_bindings (tg_chat_id, team_id, bound_by_user_id, title)
      VALUES (-201, '${TEAM_ID}', '${USER_A}', 'AuditAI');
    `);

    await handleUpdate(
      { db: db as never, tg: recordingTg(messages) },
      {
        update_id: 215,
        message: {
          message_id: 26,
          date: 1700000005,
          chat: { id: -201, type: 'supergroup', title: 'AuditAI' },
          from: {
            id: 7503673734,
            first_name: 'Otto',
            last_name: 'Silventola',
            username: 'otto',
          },
          text: '/ask when did DFK get back to us?',
        },
      },
    );

    expect(messages).toEqual([
      'Chat is not configured on this server (missing OPENROUTER_API_KEY or QDRANT_URL).',
    ]);
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
          text: '/note original',
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
          text: '/note newer edit',
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
          text: '/note older edit delivered late',
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
