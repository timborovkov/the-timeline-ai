import { randomUUID } from 'node:crypto';

import { expect, vi } from '@timeline/test-support';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import IORedis from 'ioredis';

import type { ChatDeliveryJobData } from '#src/queue/queues.js';

import { deferChatDelivery } from '#src/conversation-surfaces/deferred-delivery.js';
import { decryptJson, resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';

const fake = vi.hoisted(() => ({ queue: null as Queue<ChatDeliveryJobData> | null }));
await vi.mock(
  import.meta.resolve('#src/queue/queues.js'),
  () => ({ getChatDeliveryQueue: () => fake.queue }),
  () => import('#src/queue/queues.js'),
);

describe.skipIf(!process.env.TEST_REDIS_URL)('durable quota-delayed chat', () => {
  const connection = new IORedis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  beforeAll(() => {
    vi.stubEnv('REDIS_URL', process.env.TEST_REDIS_URL);
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    fake.queue = new Queue(`test-chat-${randomUUID()}`, { connection });
  });
  afterAll(async () => {
    await fake.queue?.obliterate({ force: true });
    await fake.queue?.close();
    await connection.quit();
    vi.unstubAllEnvs();
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });
  it('coalesces edits but preserves distinct final sends, with encrypted queue data', async () => {
    const error = Object.assign(new Error('quota'), { retryAt: new Date(Date.now() + 60_000) });
    const base = {
      provider: 'telegram' as const,
      token: 'private-token',
      body: { chat_id: 1, message_id: 2, text: 'private-old' },
    };
    await deferChatDelivery({ ...base, method: 'edit' }, error);
    await deferChatDelivery(
      { ...base, method: 'edit', body: { ...base.body, text: 'private-new' } },
      error,
    );
    await deferChatDelivery({ ...base, method: 'send' }, error);
    await deferChatDelivery({ ...base, method: 'send' }, error);
    const jobs = await fake.queue?.getDelayed();
    expect(jobs).toHaveLength(3);
    expect(JSON.stringify(jobs?.map((job) => job.data))).not.toContain('private-');
    const payloads = jobs?.map((job) =>
      decryptJson({
        ciphertext: Buffer.from(job.data.ciphertext, 'base64'),
        iv: Buffer.from(job.data.iv, 'base64'),
        tag: Buffer.from(job.data.tag, 'base64'),
      }),
    );
    expect(payloads).toContainEqual(
      expect.objectContaining({
        method: 'edit',
        body: expect.objectContaining({ text: 'private-new' }) as Record<string, unknown>,
      }),
    );
    expect(payloads).not.toContainEqual(
      expect.objectContaining({
        method: 'edit',
        body: expect.objectContaining({ text: 'private-old' }) as Record<string, unknown>,
      }),
    );
  });
  it('does not schedule ambiguous writes for replay', async () => {
    expect(
      await deferChatDelivery(
        {
          provider: 'slack',
          token: 'token',
          method: 'send',
          body: { channel: 'C1', text: 'hello' },
        },
        Object.assign(new Error('timeout'), { code: 'delivery_outcome_unknown' }),
      ),
    ).toBe(false);
  });
});
