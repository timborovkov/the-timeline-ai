import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpTelegramApi } from '#src/telegram/api.js';

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
});
