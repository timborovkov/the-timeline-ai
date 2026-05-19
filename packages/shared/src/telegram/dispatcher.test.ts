import { describe, expect, it } from 'vitest';

import { handleUpdate, parseCommand } from './dispatcher';
import { verifyWebhookSecret } from './secret';
import { tgUpdateSchema } from './types';

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
    };
    const result = await handleUpdate({ db: fakeDb, tg: fakeTg }, { not_an_update: true });
    expect(result.ok).toBe(false);
  });
});
