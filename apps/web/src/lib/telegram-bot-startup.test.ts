import { TELEGRAM_BOT_COMMAND_REGISTRATIONS } from '@timeline/shared/telegram/commands';
import { describe, expect, it, vi } from 'vitest';

import {
  registerTelegramCommandMenu,
  registerTelegramWebhook,
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
});
