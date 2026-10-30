import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  integrationRows: [] as {
    id: string;
    teamId: string;
    externalAccountId: string | null;
    providerConnectionId: string | null;
  }[],
  enqueueIntegrationSyncJob: vi.fn(),
  enqueueWebhookDeliveryJob: vi.fn(),
  recordWebhookDeliveryTargets: vi.fn(),
  requireRedisQueue: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(fakes.integrationRows)),
          })),
        })),
      })),
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({
    requireRedisQueue: fakes.requireRedisQueue,
  }),
  () => import('@/lib/queue'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/email'),
  async () => {
    const actual = await import('@timeline/shared/email');
    return { ...actual, clientIpFromHeaders: () => null };
  },
  () => import('@timeline/shared/email'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/integrations'),
  async () => {
    const actual = await import('@timeline/shared/integrations');
    return {
      ...actual,
      recordWebhookDeliveryTargets: fakes.recordWebhookDeliveryTargets,
    };
  },
  () => import('@timeline/shared/integrations'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/rate-limit'),
  async () => {
    const actual = await import('@timeline/shared/rate-limit');
    return {
      ...actual,
      checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
    };
  },
  () => import('@timeline/shared/rate-limit'),
);

const { createHmac } = await import('node:crypto');
const { resetEnvForTests } = await import('@timeline/shared/env');

const { POST } = await import('./route.js');

function channelToken(integrationId: string, secret = 'drive-secret'): string {
  const sig = createHmac('sha256', secret).update(integrationId).digest('hex');
  return `${integrationId}.${sig}`;
}

beforeEach(() => {
  process.env.GOOGLE_DRIVE_WEBHOOK_SECRET = 'drive-secret';
  resetEnvForTests();
  fakes.integrationRows = [
    {
      id: 'integration-1',
      teamId: 'team-1',
      externalAccountId: 'google-sub-1',
      providerConnectionId: 'connection-1',
    },
  ];
  fakes.recordWebhookDeliveryTargets.mockResolvedValue({
    deliveryId: 'delivery-row-1',
    targetIds: ['target-row-1'],
  });
  vi.clearAllMocks();
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
    enqueueWebhookDeliveryJob: fakes.enqueueWebhookDeliveryJob,
  });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/webhooks/google-drive', () => {
  it('rejects missing and badly signed channel tokens', async () => {
    const missing = await POST(new Request('https://timeline.test/api/webhooks/google-drive'));
    expect(missing.status).toBe(200);
    await expect(missing.json()).resolves.toMatchObject({ reason: 'missing_token' });

    const bad = await POST(
      new Request('https://timeline.test/api/webhooks/google-drive', {
        headers: { 'x-goog-channel-token': 'integration-1.bad' },
      }),
    );
    expect(bad.status).toBe(200);
    await expect(bad.json()).resolves.toMatchObject({ reason: 'bad_signature' });
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('persists a delivery and enqueues webhook processing for a valid channel token', async () => {
    const response = await POST(
      new Request('https://timeline.test/api/webhooks/google-drive', {
        method: 'POST',
        headers: {
          'x-goog-channel-token': channelToken('integration-1'),
          'x-goog-channel-id': 'channel-1',
          'x-goog-message-number': '42',
          'x-goog-resource-id': 'resource-1',
          'x-goog-resource-state': 'change',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'google_drive',
        externalDeliveryId: '42',
        externalAccountId: 'google-sub-1',
        resourceKind: 'google_drive.channel',
        externalResourceId: 'channel-1',
        eventType: 'change',
        dedupKey: 'google_drive:channel:channel-1:message:42',
        targets: [
          {
            teamId: 'team-1',
            integrationId: 'integration-1',
            providerConnectionId: 'connection-1',
          },
        ],
      }),
    );
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('keeps persisted deliveries when Redis queue setup fails', async () => {
    fakes.requireRedisQueue.mockRejectedValue(new Error('REDIS_URL is required'));

    const response = await POST(
      new Request('https://timeline.test/api/webhooks/google-drive', {
        method: 'POST',
        headers: { 'x-goog-channel-token': channelToken('integration-1') },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      reason: 'enqueue_failed',
    });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('asks Google Drive to retry when delivery persistence fails', async () => {
    fakes.recordWebhookDeliveryTargets.mockRejectedValue(new Error('database down'));

    const response = await POST(
      new Request('https://timeline.test/api/webhooks/google-drive', {
        method: 'POST',
        headers: { 'x-goog-channel-token': channelToken('integration-1') },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: 'delivery_persist_failed',
    });
    expect(fakes.requireRedisQueue).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });
});
