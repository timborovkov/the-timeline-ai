import { encryptJson, resetSecretsKeyCacheForTests } from '@timeline/shared/crypto';
import { resetEnvForTests } from '@timeline/shared/env';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { processChatDelivery } from '#src/workers/chatDelivery.js';

function job(body: unknown) {
  const encrypted = encryptJson(body);
  return {
    ciphertext: encrypted.ciphertext.toString('base64'),
    iv: encrypted.iv.toString('base64'),
    tag: encrypted.tag.toString('base64'),
  };
}

describe('deferred chat delivery', () => {
  beforeEach(() => {
    vi.stubEnv('REDIS_URL', undefined);
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', Buffer.alloc(32, 4).toString('base64'));
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });
  it('retains the provider retry deadline and sends only the stored message on resume', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ parameters: { retry_after: 90 } }), { status: 429 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: {} })));
    vi.stubGlobal('fetch', fetch);
    const data = job({
      provider: 'telegram',
      token: 'token',
      method: 'send',
      body: { chat_id: 123, text: 'Final answer' },
    });
    await expect(processChatDelivery(data)).rejects.toMatchObject({
      retryAt: expect.any(Date) as Date,
    });
    await processChatDelivery(data);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.telegram.org/bottoken/sendMessage',
      expect.objectContaining({ body: JSON.stringify({ chat_id: 123, text: 'Final answer' }) }),
    );
  });
  it('does not retry a non-idempotent send after a timeout', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      processChatDelivery(
        job({
          provider: 'telegram',
          token: 'token',
          method: 'send',
          body: { chat_id: 123, text: 'Final answer' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'delivery_outcome_unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a tampered encrypted envelope before making a provider request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const data = job({
      provider: 'telegram',
      token: 'token',
      method: 'send',
      body: { chat_id: 123, text: 'Final answer' },
    });
    await expect(
      processChatDelivery({ ...data, tag: Buffer.alloc(16).toString('base64') }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
