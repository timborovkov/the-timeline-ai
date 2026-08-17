import { describe, expect, it, vi } from 'vitest';

import {
  registerTelegramBotCommands,
  TELEGRAM_BOT_COMMAND_REGISTRATIONS,
  TELEGRAM_DM_COMMANDS,
  TELEGRAM_DM_HELP,
  TELEGRAM_GROUP_COMMANDS,
  TELEGRAM_GROUP_HELP,
} from '#src/telegram/commands.js';

const COMMAND_NAME_RE = /^[a-z0-9_]{1,32}$/;

describe('Telegram bot command catalog', () => {
  it('uses Telegram-valid command names and descriptions', () => {
    for (const spec of [...TELEGRAM_DM_COMMANDS, ...TELEGRAM_GROUP_COMMANDS]) {
      expect(spec.command).toMatch(COMMAND_NAME_RE);
      expect(spec.description.length).toBeGreaterThanOrEqual(1);
      expect(spec.description.length).toBeLessThanOrEqual(256);
      expect(spec.helpLine.startsWith(`/${spec.command}`)).toBe(true);
    }
  });

  it('lists every DM and group command in /help', () => {
    for (const spec of TELEGRAM_DM_COMMANDS) {
      expect(TELEGRAM_DM_HELP).toContain(spec.helpLine);
    }
    for (const spec of TELEGRAM_GROUP_COMMANDS) {
      expect(TELEGRAM_GROUP_HELP).toContain(spec.helpLine);
    }
    expect(TELEGRAM_DM_HELP).toContain('/note');
    expect(TELEGRAM_DM_HELP).toContain('/new');
    expect(TELEGRAM_GROUP_HELP).not.toContain('/note');
    expect(TELEGRAM_GROUP_HELP).not.toContain('/new');
  });

  it('registers default, private, and group scopes for the / menu', () => {
    expect(TELEGRAM_BOT_COMMAND_REGISTRATIONS.map((entry) => entry.scope.type)).toEqual([
      'default',
      'all_private_chats',
      'all_group_chats',
    ]);
    const privateCommands = TELEGRAM_BOT_COMMAND_REGISTRATIONS.find(
      (entry) => entry.scope.type === 'all_private_chats',
    )?.commands;
    const groupCommands = TELEGRAM_BOT_COMMAND_REGISTRATIONS.find(
      (entry) => entry.scope.type === 'all_group_chats',
    )?.commands;
    expect(privateCommands?.map((command) => command.command)).toEqual(
      TELEGRAM_DM_COMMANDS.map((command) => command.command),
    );
    expect(groupCommands?.map((command) => command.command)).toEqual(
      TELEGRAM_GROUP_COMMANDS.map((command) => command.command),
    );
    expect(privateCommands?.some((command) => command.command === 'note')).toBe(true);
    expect(groupCommands?.some((command) => command.command === 'note')).toBe(false);
  });

  it('posts setMyCommands once per scope', async () => {
    const setMyCommands = vi.fn(
      (_registration: (typeof TELEGRAM_BOT_COMMAND_REGISTRATIONS)[number]) => Promise.resolve(),
    );
    await registerTelegramBotCommands(setMyCommands);
    expect(setMyCommands.mock.calls.map(([registration]) => registration.scope.type)).toEqual([
      'default',
      'all_private_chats',
      'all_group_chats',
    ]);
  });

  it('registers remaining scopes when one setMyCommands call fails', async () => {
    const setMyCommands = vi.fn(
      (registration: (typeof TELEGRAM_BOT_COMMAND_REGISTRATIONS)[number]) => {
        if (registration.scope.type === 'all_private_chats') {
          return Promise.reject(new Error('private scope rejected'));
        }
        return Promise.resolve();
      },
    );
    await expect(registerTelegramBotCommands(setMyCommands)).rejects.toThrow(
      /all_private_chats: private scope rejected/,
    );
    expect(setMyCommands).toHaveBeenCalledTimes(3);
  });
});
