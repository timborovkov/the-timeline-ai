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
});
