import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('#src/logger.js', () => ({
  childLogger: () => log,
  logger: log,
}));

import type { TelegramApi } from '#src/telegram/api.js';

import {
  handleUpdate,
  resetTelegramUnboundGroupLogForTests,
  telegramChatFingerprint,
} from '#src/telegram/dispatcher.js';
import { applyDbMigrations } from '#src/test/pglite.js';

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

describe('telegram dispatcher logging', () => {
  let pg: PGlite;

  beforeEach(async () => {
    log.debug.mockReset();
    log.info.mockReset();
    log.warn.mockReset();
    log.error.mockReset();
    resetTelegramUnboundGroupLogForTests();
    pg = new PGlite();
    await applyDbMigrations(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('fingerprints chat ids without echoing the raw id', () => {
    const fingerprint = telegramChatFingerprint(-1001234567890);
    expect(fingerprint).toMatch(/^[0-9a-f]{12}$/u);
    expect(fingerprint).not.toContain('1001234567890');
    expect(telegramChatFingerprint(-1001234567890)).toBe(fingerprint);
  });

  it('logs chat type without message content and rate-limits unbound group drops', async () => {
    const db = drizzle(pg);
    const payload = {
      update_id: 91,
      message: {
        message_id: 1,
        date: 1_700_000_000,
        chat: { id: -10042, type: 'supergroup' as const, title: 'Secret standup notes' },
        from: { id: 7, username: 'alice' },
        text: 'do not log this secret',
      },
    };

    await handleUpdate({ db: db as never, tg: fakeTg }, payload);
    await handleUpdate({ db: db as never, tg: fakeTg }, { ...payload, update_id: 92 });

    const debugLine = log.debug.mock.calls.find((call) => call[1] === 'telegram webhook update');
    expect(debugLine?.[0]).toMatchObject({
      chatType: 'supergroup',
      chatFingerprint: telegramChatFingerprint(-10042),
    });
    expect(JSON.stringify(log.debug.mock.calls)).not.toContain('do not log this secret');
    expect(JSON.stringify(log.debug.mock.calls)).not.toContain('Secret standup notes');

    const ignored = log.info.mock.calls.filter(
      (call) => call[1] === 'telegram group message ignored: chat not linked',
    );
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.[0]).toMatchObject({
      chatType: 'supergroup',
      chatFingerprint: telegramChatFingerprint(-10042),
    });
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('do not log this secret');

    const events = await pg.query('SELECT id FROM raw_events');
    expect(events.rows).toEqual([]);
  });
});
