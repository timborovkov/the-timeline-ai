import { describe, expect, it } from 'vitest';

import { readCappedTextBody } from '@/lib/request-body';

/** Public request bodies must be rejected while streaming, not after buffering. */
describe('readCappedTextBody', () => {
  it('rejects a declared oversized body before reading it', async () => {
    const request = new Request('https://app.test/webhook', {
      method: 'POST',
      headers: { 'content-length': '11' },
      body: 'small',
    });
    await expect(readCappedTextBody(request, 10)).resolves.toEqual({ tooLarge: true });
  });

  it('rejects chunked bodies as soon as the streaming cap is exceeded', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345678'));
        controller.enqueue(new TextEncoder().encode('abcdefgh'));
        controller.close();
      },
    });
    const request = new Request('https://app.test/webhook', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readCappedTextBody(request, 10)).resolves.toEqual({ tooLarge: true });
  });

  it('returns the exact raw text inside the byte limit', async () => {
    const request = new Request('https://app.test/webhook', {
      method: 'POST',
      body: 'signed payload',
    });
    await expect(readCappedTextBody(request, 32)).resolves.toEqual({
      tooLarge: false,
      text: 'signed payload',
    });
  });
});
