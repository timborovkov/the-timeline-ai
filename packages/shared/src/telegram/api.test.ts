import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { withChatDeliveryPrincipal } from '#src/conversation-surfaces/deferred-delivery.js';
import { digestDestinationDedupeKey } from '#src/messaging/destinations.js';
import { HttpTelegramApi } from '#src/telegram/api.js';
import {
  TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE,
  TelegramChatMigrationConflictError,
} from '#src/telegram/chat-migration.js';

const SENDING_TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OLD_CHAT_ID = -123456;
const NEW_CHAT_ID = -1004317012921;
const DIGEST_WINDOW_END = '2026-06-14T12:00:00.000Z';
const OLD_DIGEST_KEY = digestDestinationDedupeKey({
  scope: 'workspace',
  teamId: SENDING_TEAM_ID,
  windowEnd: DIGEST_WINDOW_END,
  destination: { kind: 'telegram_chat', targetId: String(OLD_CHAT_ID) },
});
const NEW_DIGEST_KEY = digestDestinationDedupeKey({
  scope: 'workspace',
  teamId: SENDING_TEAM_ID,
  windowEnd: DIGEST_WINDOW_END,
  destination: { kind: 'telegram_chat', targetId: String(NEW_CHAT_ID) },
});

function upgradedGroupResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error_code: 400,
      description: 'Bad Request: group chat was upgraded to a supergroup chat',
      parameters: { migrate_to_chat_id: -1004317012921 },
    }),
    { status: 400 },
  );
}

describe('HttpTelegramApi file downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects files whose Content-Length exceeds the byte limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { headers: { 'content-length': '6' } }))),
    );

    await expect(new HttpTelegramApi('token').downloadFile('voice.ogg', 5)).rejects.toThrow(
      'file_oversize',
    );
  });

  it('rejects streamed files that exceed the byte limit without provider metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('123456')))),
    );

    await expect(new HttpTelegramApi('token').downloadFile('voice.ogg', 5)).rejects.toThrow(
      'file_oversize',
    );
  });

  it('bounds Telegram API calls with an abortable request timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('request aborted', { cause: init.signal?.reason }));
            });
          }),
      ),
    );

    await expect(
      new HttpTelegramApi('token', 5).sendChatAction({ chat_id: 42, action: 'typing' }),
    ).rejects.toThrow();
  });

  it('registers bot commands for one Telegram scope', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ ok: true, result: true })));
    vi.stubGlobal('fetch', fetchMock);

    await new HttpTelegramApi('token').setMyCommands({
      commands: [{ command: 'help', description: 'Show available commands' }],
      scope: { type: 'all_private_chats' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/setMyCommands',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          commands: [{ command: 'help', description: 'Show available commands' }],
          scope: { type: 'all_private_chats' },
        }),
      }),
    );
  });
  it('preserves Telegram retry_after and marks ambiguous sends without retrying', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ parameters: { retry_after: 120 } }), { status: 429 }),
      )
      .mockRejectedValueOnce(new Error('socket closed'));
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token');
    const before = Date.now();
    const error = await api
      .sendMessage({ chat_id: 1, text: 'hello' })
      .catch((value: unknown) => value);
    expect(error).toHaveProperty('retryAt');
    if (!(error instanceof Error) || !('retryAt' in error) || !(error.retryAt instanceof Date))
      throw new Error('missing retry time');
    expect(error.retryAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    await expect(api.sendMessage({ chat_id: 1, text: 'hello' })).rejects.toMatchObject({
      code: 'delivery_outcome_unknown',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('persists a chat migration and retries sendMessage once with the new id', async () => {
    const persist = vi.fn(() => Promise.resolve(undefined));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(upgradedGroupResponse())
      .mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });
    const input = { chat_id: -123456, text: 'hello' };

    await api.sendMessage(input);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(-123456, -1004317012921);
    expect(input.chat_id).toBe(-1004317012921);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.telegram.org/bottoken/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chat_id: -1004317012921, text: 'hello' }),
      }),
    );
  });

  it('surfaces the retry error when the migrated send still fails', async () => {
    const persist = vi.fn(() => Promise.resolve(undefined));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(upgradedGroupResponse())
      .mockResolvedValueOnce(new Response('bot was blocked by the user', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });

    await expect(api.sendMessage({ chat_id: -123456, text: 'hello' })).rejects.toThrow(
      'Telegram sendMessage failed: 403 bot was blocked by the user',
    );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry sendMessage when chat migration ownership verification fails', async () => {
    const persist = vi.fn(() => Promise.reject(new Error('DB timeout')));
    const fetch = vi.fn().mockResolvedValueOnce(upgradedGroupResponse());
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });
    const input = { chat_id: -123456, text: 'hello' };

    const error = await api.sendMessage(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Telegram sendMessage failed: 400 {"ok":false,"error_code":400',
    );
    expect((error as Error).message).not.toContain('cross-team chat migration conflict');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(-123456, -1004317012921);
    expect(input.chat_id).toBe(-123456);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry sendMessage when chat migration hits a cross-team conflict', async () => {
    const persist = vi.fn(() => Promise.reject(new TelegramChatMigrationConflictError()));
    const fetch = vi.fn().mockResolvedValueOnce(upgradedGroupResponse());
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });
    const input = { chat_id: -123456, text: 'hello' };

    const error = await api.sendMessage(input).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Telegram sendMessage failed: 400');
    expect((error as Error).message).toContain('cross-team chat migration conflict; skipped retry');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(-123456, -1004317012921);
    expect(input.chat_id).toBe(-123456);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry sendMessage when migration persist hits a binding unique constraint', async () => {
    const persist = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('Failed query: update telegram_chat_bindings'), {
          cause: Object.assign(
            new Error(
              'duplicate key value violates unique constraint "telegram_chat_bindings_tg_chat_id_unique"',
            ),
            { code: '23505', constraint: 'telegram_chat_bindings_tg_chat_id_unique' },
          ),
        }),
      ),
    );
    const fetch = vi.fn().mockResolvedValueOnce(upgradedGroupResponse());
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });
    const input = { chat_id: -123456, text: 'hello' };

    const error = await api.sendMessage(input).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Telegram sendMessage failed: 400');
    expect((error as Error).message).toContain('cross-team chat migration conflict; skipped retry');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(-123456, -1004317012921);
    expect(input.chat_id).toBe(-123456);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry sendMessage when the sending workspace is missing', async () => {
    const persist = vi.fn(() => Promise.resolve(undefined));
    const fetch = vi.fn().mockResolvedValueOnce(upgradedGroupResponse());
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, { onChatMigrated: persist });
    const input = { chat_id: -123456, text: 'hello' };

    const error = await api.sendMessage(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Telegram sendMessage failed: 400 {"ok":false,"error_code":400',
    );
    expect((error as Error).message).not.toContain('cross-team chat migration conflict');
    expect(persist).not.toHaveBeenCalled();
    expect(input.chat_id).toBe(-123456);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('authorizes a migrated retry from the chat-delivery principal', async () => {
    const persist = vi.fn(() => Promise.resolve(undefined));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(upgradedGroupResponse())
      .mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, { onChatMigrated: persist });
    const input = { chat_id: -123456, text: 'hello' };

    await withChatDeliveryPrincipal({ teamId: SENDING_TEAM_ID }, () => api.sendMessage(input));

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(-123456, -1004317012921);
    expect(input.chat_id).toBe(-1004317012921);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry sendMessage when the migrated digest key is already sent', async () => {
    const persist = vi.fn(() =>
      Promise.resolve({ alreadySentDedupeKeys: [NEW_DIGEST_KEY], retryableDedupeKeys: [] }),
    );
    const fetch = vi.fn().mockResolvedValueOnce(upgradedGroupResponse());
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });
    const input = { chat_id: OLD_CHAT_ID, text: 'daily digest' };

    await withChatDeliveryPrincipal({ teamId: SENDING_TEAM_ID, dedupeKey: OLD_DIGEST_KEY }, () =>
      api.sendMessage(input),
    );

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(OLD_CHAT_ID, NEW_CHAT_ID);
    expect(input.chat_id).toBe(OLD_CHAT_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry sendMessage when the migrated digest key is already pending', async () => {
    const persist = vi.fn(() =>
      Promise.resolve({ alreadySentDedupeKeys: [], retryableDedupeKeys: [NEW_DIGEST_KEY] }),
    );
    const fetch = vi.fn().mockResolvedValueOnce(upgradedGroupResponse());
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });
    const input = { chat_id: OLD_CHAT_ID, text: 'daily digest' };

    const error = await withChatDeliveryPrincipal(
      { teamId: SENDING_TEAM_ID, dedupeKey: OLD_DIGEST_KEY },
      () => api.sendMessage(input).catch((value: unknown) => value),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Telegram sendMessage failed: 400 {"ok":false,"error_code":400',
    );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(input.chat_id).toBe(OLD_CHAT_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still retries a non-digest send when historical digest keys already exist', async () => {
    const persist = vi.fn(() =>
      Promise.resolve({ alreadySentDedupeKeys: [NEW_DIGEST_KEY], retryableDedupeKeys: [] }),
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(upgradedGroupResponse())
      .mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, {
      onChatMigrated: persist,
      sendingTeamId: SENDING_TEAM_ID,
    });
    const input = { chat_id: OLD_CHAT_ID, text: 'agent reply' };

    await api.sendMessage(input);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(input.chat_id).toBe(NEW_CHAT_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry ordinary Telegram send failures', async () => {
    const persist = vi.fn(() => Promise.resolve(undefined));
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
        status: 400,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const api = new HttpTelegramApi('token', 10_000, true, { onChatMigrated: persist });

    await expect(api.sendMessage({ chat_id: -123456, text: 'hello' })).rejects.toThrow(
      'Telegram sendMessage failed: 400',
    );
    expect(persist).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
