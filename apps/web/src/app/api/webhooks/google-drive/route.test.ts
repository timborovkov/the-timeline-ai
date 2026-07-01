import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmailModule from '@timeline/shared/email';
import type * as IntegrationsModule from '@timeline/shared/integrations';
import type * as RateLimitModule from '@timeline/shared/rate-limit';

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

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(fakes.integrationRows)),
        })),
      })),
    })),
  },
}));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: fakes.requireRedisQueue,
}));

vi.mock('@timeline/shared/email', async () => {
  const actual = await vi.importActual<typeof EmailModule>('@timeline/shared/email');
  return { ...actual, clientIpFromHeaders: () => null };
});

vi.mock('@timeline/shared/integrations', async () => {
  const actual = await vi.importActual<typeof IntegrationsModule>('@timeline/shared/integrations');
  return {
    ...actual,
    recordWebhookDeliveryTargets: fakes.recordWebhookDeliveryTargets,
  };
});

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  };
});

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
