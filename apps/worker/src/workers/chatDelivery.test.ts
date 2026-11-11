import { teams, teamBillingAccounts } from '@timeline/db';
import { encryptJson, resetSecretsKeyCacheForTests } from '@timeline/shared/crypto';
import { resetEnvForTests } from '@timeline/shared/env';
import { SlackApi } from '@timeline/shared/slack';
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
    vi.restoreAllMocks();
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
  it.each(['slack', 'telegram'] as const)(
    'rechecks %s recipient and workspace after rate-limit deferral',
    async (provider) => {
      const principal = {
        teamId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
      };
      let suspended = false;
      let teamSuspended = false;
      const db = {
        select: () => ({
          from: (table: unknown) => ({
            where: () =>
              Promise.resolve(
                table === teams
                  ? [{ disabledAt: teamSuspended ? new Date() : null }]
                  : table === teamBillingAccounts
                    ? [{ state: 'normal' }]
                    : [{ suspendedAt: suspended ? new Date() : null }],
              ),
          }),
        }),
      };
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} })));
      vi.stubGlobal('fetch', fetch);
      const send =
        provider === 'slack'
          ? vi.spyOn(SlackApi.prototype, 'postMessage').mockResolvedValue(undefined)
          : fetch;
      const data = {
        ...principal,
        ...job({
          principal,
          provider,
          token: 'token',
          method: 'send',
          body:
            provider === 'slack'
              ? { channel: 'C1', text: 'Digest' }
              : { chat_id: 123, text: 'Digest' },
        }),
      };
      await processChatDelivery(data, db as never);
      expect(send).toHaveBeenCalledTimes(1);
      suspended = true;
      await expect(processChatDelivery(data, db as never)).rejects.toThrow('Account is suspended');
      expect(send).toHaveBeenCalledTimes(1);
      suspended = false;
      teamSuspended = true;
      await expect(processChatDelivery(data, db as never)).rejects.toThrow(
        'Workspace is suspended',
      );
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

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
