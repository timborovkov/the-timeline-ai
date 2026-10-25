import { TELEGRAM_BOT_COMMAND_REGISTRATIONS } from '@timeline/shared/telegram/commands';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerTelegramCommandMenu,
  registerTelegramWebhook,
  startTelegramBotRegistration,
  telegramBotStartupActions,
  type TelegramBotApiPost,
} from '@/lib/telegram-bot-startup';

describe('telegram bot startup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the command menu whenever a bot token is present', () => {
    expect(
      telegramBotStartupActions({
        nodeEnv: 'development',
        botToken: 'token',
        webhookSecret: undefined,
        authUrl: undefined,
      }),
    ).toMatchObject({ commands: 'register', webhook: 'skip-non-production' });
    expect(
      telegramBotStartupActions({
        nodeEnv: 'production',
        botToken: undefined,
        webhookSecret: 'secret',
        authUrl: 'https://app.test',
      }),
    ).toEqual({
      commands: 'skip-token',
      webhook: 'skip-missing',
      missingWebhook: ['TELEGRAM_BOT_TOKEN'],
    });
    expect(
      telegramBotStartupActions({
        nodeEnv: 'production',
        botToken: 'token',
        webhookSecret: 'secret',
        authUrl: 'https://app.test',
      }),
    ).toMatchObject({ commands: 'register', webhook: 'register' });
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

  it('re-applies the webhook secret when the URL is already registered', async () => {
    const logs: string[] = [];
    const warns: string[] = [];
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'getWebhookInfo') {
        return Promise.resolve({ url: 'https://app.test/api/telegram/webhook' });
      }
      if (method === 'setWebhook') return Promise.resolve(true);
      if (method === 'setMyCommands') return Promise.resolve(true);
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    const work = startTelegramBotRegistration(
      {
        nodeEnv: 'production',
        botToken: 'token',
        webhookSecret: 'rotated-secret',
        authUrl: 'https://app.test',
      },
      { log: (message) => logs.push(message), warn: (message) => warns.push(message) },
      postTelegram,
    );
    await Promise.all([work.commands, work.webhook]);
    expect(logs).toContain('[telegram-webhook] webhook already registered');
    expect(warns).toEqual([]);
    expect(postTelegram).toHaveBeenCalledWith('token', 'setWebhook', {
      url: 'https://app.test/api/telegram/webhook',
      secret_token: 'rotated-secret',
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      drop_pending_updates: false,
    });
  });

  it('still re-applies setWebhook after getWebhookInfo already matches the target URL', async () => {
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'getWebhookInfo') {
        return Promise.resolve({ url: 'https://app.test/api/telegram/webhook' });
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

  it('warns with cause details after retries and notes the bot may still work', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const warns: string[] = [];
    const cause = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      errno: -104,
      syscall: 'read',
      address: '149.154.166.110',
    });
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'setMyCommands') return Promise.resolve(true);
      return Promise.reject(new TypeError('fetch failed', { cause }));
    });
    const work = startTelegramBotRegistration(
      {
        nodeEnv: 'production',
        botToken: 'token',
        webhookSecret: 'secret',
        authUrl: 'https://app.test',
      },
      { log: (message) => logs.push(message), warn: (message) => warns.push(message) },
      postTelegram,
    );
    await vi.runAllTimersAsync();
    await Promise.all([work.commands, work.webhook]);
    vi.useRealTimers();
    expect(warns.some((line) => line.includes('[telegram-webhook] error: setWebhook failed'))).toBe(
      true,
    );
    expect(warns.some((line) => line.includes('code=ECONNRESET'))).toBe(true);
    expect(warns.some((line) => line.includes('syscall=read'))).toBe(true);
    expect(warns.some((line) => line.includes('address=149.154.166.110'))).toBe(true);
    expect(
      warns.some((line) =>
        line.includes('The bot may still work if the webhook was registered earlier'),
      ),
    ).toBe(true);
    expect(postTelegram.mock.calls.filter(([, method]) => method === 'setWebhook').length).toBe(3);
  });

  it('registers commands in development without touching the webhook', async () => {
    const logs: string[] = [];
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'setMyCommands') return Promise.resolve(true);
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    const work = startTelegramBotRegistration(
      {
        nodeEnv: 'development',
        botToken: 'token',
        webhookSecret: 'secret',
        authUrl: 'https://app.test',
      },
      { log: (message) => logs.push(message), warn: (message) => logs.push(message) },
      postTelegram,
    );
    await Promise.all([work.commands, work.webhook]);
    expect(logs).toEqual([
      '[telegram-commands] registered: scopes=default,all_private_chats,all_group_chats',
    ]);
    expect(postTelegram.mock.calls.every(([, method]) => method === 'setMyCommands')).toBe(true);
  });

  it('registers commands and the webhook together in production', async () => {
    const logs: string[] = [];
    let registered = false;
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'setMyCommands') return Promise.resolve(true);
      if (method === 'setWebhook') {
        registered = true;
        return Promise.resolve(true);
      }
      if (method === 'getWebhookInfo') {
        return Promise.resolve({
          url: registered ? 'https://app.test/api/telegram/webhook' : '',
          pending_update_count: 0,
        });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    const work = startTelegramBotRegistration(
      {
        nodeEnv: 'production',
        botToken: 'token',
        webhookSecret: 'secret',
        authUrl: 'https://app.test',
      },
      { log: (message) => logs.push(message), warn: (message) => logs.push(message) },
      postTelegram,
    );
    await Promise.all([work.commands, work.webhook]);
    expect(logs).toHaveLength(2);
    expect(logs).toContain(
      '[telegram-commands] registered: scopes=default,all_private_chats,all_group_chats',
    );
    expect(logs).toContain(
      '[telegram-webhook] registered: url=https://app.test/api/telegram/webhook pending=0',
    );
  });
});
