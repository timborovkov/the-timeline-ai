import { TELEGRAM_BOT_COMMAND_REGISTRATIONS } from '@timeline/shared/telegram/commands';
import { describe, expect, it, vi } from 'vitest';

import {
  registerTelegramCommandMenu,
  registerTelegramWebhook,
  startTelegramBotRegistration,
  telegramBotStartupActions,
  type TelegramBotApiPost,
} from '@/lib/telegram-bot-startup';

describe('telegram bot startup', () => {
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
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'setWebhook') return Promise.resolve(true);
      if (method === 'getWebhookInfo') {
        return Promise.resolve({
          url: 'https://app.test/api/telegram/webhook',
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
    const postTelegram = vi.fn<TelegramBotApiPost>((_token, method) => {
      if (method === 'setMyCommands' || method === 'setWebhook') return Promise.resolve(true);
      if (method === 'getWebhookInfo') {
        return Promise.resolve({
          url: 'https://app.test/api/telegram/webhook',
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
