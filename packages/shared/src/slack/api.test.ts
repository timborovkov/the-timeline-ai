import { afterEach, describe, expect, it, vi } from 'vitest';

import { SlackApi } from '#src/slack/api.js';

describe('SlackApi file downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects files whose Content-Length exceeds the byte limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { headers: { 'content-length': '6' } }))),
    );

    await expect(
      new SlackApi('xoxb-test').downloadFile(
        { id: 'F1', url_private_download: 'https://files.example/large.bin' },
        5,
      ),
    ).rejects.toThrow('file_oversize');
  });

  it('rejects streamed files that exceed the byte limit without provider metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('123456')))),
    );

    await expect(
      new SlackApi('xoxb-test').downloadFile(
        { id: 'F1', url_private_download: 'https://files.example/large.bin' },
        5,
      ),
    ).rejects.toThrow('file_oversize');
  });
});
