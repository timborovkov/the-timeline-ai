import { describe, expect, it } from 'vitest';

import { readCappedBinaryBody, readCappedTextBody } from '@/lib/request-body';

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

  it('stops reading a chunked binary body as soon as the cap is exceeded', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(8).fill(1));
        if (pulls >= 4) controller.close();
      },
    });
    const request = new Request('https://app.test/webhook', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readCappedBinaryBody(request, 10)).resolves.toEqual({ tooLarge: true });
    expect(pulls).toBeLessThanOrEqual(2);
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
