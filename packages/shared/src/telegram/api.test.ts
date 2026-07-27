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
});
