import { TELEGRAM_BOT_COMMAND_REGISTRATIONS } from '@timeline/shared/telegram/commands';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import {
  registerTelegramCommandMenu,
  registerTelegramWebhook,
  provisionTelegramBot,
  type TelegramBotApiPost,
} from '@/lib/telegram-bot-provision';
describe('Telegram provisioning', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const request = {
    environment: 'staging',
    expectedBotId: 1234,
    origin: 'https://app.test',
    apply: false,
    botToken: 'token',
    webhookSecret: 'secret',
  };
  const allowedUpdates = ['message', 'edited_message', 'callback_query'];

  it('previews the expected bot without writing to Telegram', async () => {
    const post = vi.fn<TelegramBotApiPost>((_token, method) =>
      Promise.resolve(method === 'getMe' ? { id: 1234, is_bot: true } : { url: '' }),
    );
    expect(await provisionTelegramBot(request, post)).toMatchObject({
      applied: false,
      environment: 'staging',
      botId: 1234,
      webhook: 'unconfigured',
    });
    expect(post.mock.calls.map(([, method]) => method)).toEqual(['getMe', 'getWebhookInfo']);
  });

  it('rejects a mismatched bot identity before any write', async () => {
    const post = vi.fn<TelegramBotApiPost>(() => Promise.resolve({ id: 3456, is_bot: true }));
    await expect(provisionTelegramBot({ ...request, apply: true }, post)).rejects.toThrow(
      'does not belong to the expected bot',
    );
    expect(post.mock.calls.map(([, method]) => method)).toEqual(['getMe']);
  });

  it('applies and verifies all three command scopes and the webhook', async () => {
    const post = vi.fn<TelegramBotApiPost>((_token, method, body) => {
      if (method === 'getMe') return Promise.resolve({ id: 1234, is_bot: true });
      if (method === 'getWebhookInfo')
        return Promise.resolve({
          url: 'https://app.test/api/telegram/webhook',
          allowed_updates: allowedUpdates,
        });
      if (method === 'getMyCommands') {
        const scope = (body as { scope: { type: string } }).scope;
        return Promise.resolve(
          TELEGRAM_BOT_COMMAND_REGISTRATIONS.find(
            (registration) => registration.scope.type === scope.type,
          )?.commands,
        );
      }
      return Promise.resolve(true);
    });
    expect(await provisionTelegramBot({ ...request, apply: true }, post)).toMatchObject({
      applied: true,
      webhook: 'already-registered',
    });
    expect(post.mock.calls.filter(([, method]) => method === 'getMyCommands')).toHaveLength(3);
    expect(post).toHaveBeenCalledWith(
      'token',
      'setWebhook',
      expect.objectContaining({
        secret_token: 'secret',
        drop_pending_updates: false,
      }),
    );
  });

  it('posts setMyCommands for default, private, and group scopes', async () => {
    const postTelegram = vi.fn<TelegramBotApiPost>(() => Promise.resolve(true));
    const result = await registerTelegramCommandMenu('token', postTelegram);
    expect(result).toEqual({
      status: 'registered',
      detail: 'scopes=default,all_private_chats,all_group_chats',
    });
    expect(postTelegram.mock.calls.map(([, method, body]) => [method, body])).toEqual(
      TELEGRAM_BOT_COMMAND_REGISTRATIONS.map((registration) => ['setMyCommands', registration]),
    );
  });

  it('registers and verifies the webhook URL', async () => {
    let registered = false;
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'setWebhook') {
        registered = true;
        return Promise.resolve(true);
      }
      if (method === 'getWebhookInfo') {
        return Promise.resolve({
          url: registered ? 'https://app.test/api/telegram/webhook' : '',
          pending_update_count: 0,
          allowed_updates: allowedUpdates,
        });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    const result = await registerTelegramWebhook(
      {
        botToken: 'token',
        webhookSecret: 'secret',
        authUrl: 'https://app.test',
      },
      postTelegram,
    );
    expect(result.status).toBe('registered');
    expect(postTelegram).toHaveBeenCalledWith('token', 'setWebhook', {
      url: 'https://app.test/api/telegram/webhook',
      secret_token: 'secret',
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      drop_pending_updates: false,
    });
  });

  it('still re-applies setWebhook after getWebhookInfo already matches the target URL', async () => {
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'getWebhookInfo') {
        return Promise.resolve({
          url: 'https://app.test/api/telegram/webhook',
          allowed_updates: allowedUpdates,
        });
      }
      if (method === 'setWebhook') return Promise.resolve(true);
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    const result = await registerTelegramWebhook(
      {
        botToken: 'token',
        webhookSecret: 'rotated-secret',
        authUrl: 'https://app.test',
      },
      postTelegram,
    );
    expect(result).toEqual({
      status: 'already-registered',
      detail: 'webhook already registered',
    });
    expect(postTelegram).toHaveBeenCalledWith(
      'token',
      'setWebhook',
      expect.objectContaining({
        secret_token: 'rotated-secret',
      }),
    );
  });

  it('retries setWebhook with backoff then succeeds', async () => {
    vi.useFakeTimers();
    let setAttempts = 0;
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'getWebhookInfo') {
        return Promise.resolve({
          url: setAttempts > 0 ? 'https://app.test/api/telegram/webhook' : '',
          allowed_updates: allowedUpdates,
        });
      }
      if (method === 'setWebhook') {
        setAttempts += 1;
        if (setAttempts < 3) return Promise.reject(new TypeError('fetch failed'));
        return Promise.resolve(true);
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    const pending = registerTelegramWebhook(
      {
        botToken: 'token',
        webhookSecret: 'secret',
        authUrl: 'https://app.test',
      },
      postTelegram,
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result.status).toBe('registered');
    expect(setAttempts).toBe(3);
  });
});
