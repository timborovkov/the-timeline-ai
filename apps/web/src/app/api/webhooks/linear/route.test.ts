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
    externalAccountId: string;
    providerConnectionId: string | null;
  }[],
  selectionRows: [] as { integrationId: string; externalId: string }[],
  handleWebhook: vi.fn(),
  writeIntegrationEvents: vi.fn(),
  recordWebhookDeliveryTargets: vi.fn(),
  requireRedisQueue: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
  enqueueWebhookDeliveryJob: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn((shape?: unknown) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(shape ? fakes.selectionRows : fakes.integrationRows)),
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

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  };
});

vi.mock('@timeline/shared/integrations', async () => {
  const actual = await vi.importActual<typeof IntegrationsModule>('@timeline/shared/integrations');
  return {
    ...actual,
    getProvider: () => ({ handleWebhook: fakes.handleWebhook }),
    writeIntegrationEvents: fakes.writeIntegrationEvents,
    recordWebhookDeliveryTargets: fakes.recordWebhookDeliveryTargets,
  };
});

const { POST } = await import('./route.js');

function signedRequest(payload: unknown, signature = true): Request {
  const body = JSON.stringify(payload);
  const digest = createHmac('sha256', 'linear-secret').update(body).digest('hex');
  return new Request('https://timeline.test/api/webhooks/linear', {
    method: 'POST',
    headers: { 'linear-signature': signature ? digest : 'bad' },
    body,
  });
}

beforeEach(() => {
  process.env.LINEAR_WEBHOOK_SECRET = 'linear-secret';
  resetEnvForTests();
  fakes.integrationRows = [
    {
      id: 'integration-1',
      teamId: 'team-1',
      externalAccountId: 'org-1',
      providerConnectionId: 'connection-1',
    },
  ];
  fakes.selectionRows = [{ integrationId: 'integration-1', externalId: 'team-linear-1' }];
  fakes.handleWebhook.mockResolvedValue([{ dedupKey: 'event-1' }]);
  fakes.recordWebhookDeliveryTargets.mockResolvedValue({
    deliveryId: 'delivery-row-1',
    targetIds: ['target-row-1'],
  });
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
    enqueueWebhookDeliveryJob: fakes.enqueueWebhookDeliveryJob,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/webhooks/linear', () => {
  it('rejects bad signatures before routing', async () => {
    const response = await POST(signedRequest({ organizationId: 'org-1' }, false));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: 'bad_signature' });
    expect(fakes.handleWebhook).not.toHaveBeenCalled();
    expect(fakes.recordWebhookDeliveryTargets).not.toHaveBeenCalled();
  });

  it('routes selected team webhooks to the matched integration', async () => {
    const response = await POST(
      signedRequest({
        organizationId: 'org-1',
        type: 'Issue',
        data: { team: { id: 'team-linear-1' } },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.handleWebhook).not.toHaveBeenCalled();
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'linear',
        externalAccountId: 'org-1',
        resourceKind: 'linear.team',
        externalResourceId: 'team-linear-1',
        eventType: 'Issue',
        dedupKey: expect.stringMatching(/^linear:body:/) as unknown as string,
        targets: [
          {
            teamId: 'team-1',
            integrationId: 'integration-1',
            providerConnectionId: 'connection-1',
          },
        ],
      }),
    );
    expect(fakes.writeIntegrationEvents).not.toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('keeps persisted webhook deliveries when Redis queue acquisition fails', async () => {
    fakes.requireRedisQueue.mockRejectedValue(new Error('redis down'));

    const response = await POST(
      signedRequest({
        organizationId: 'org-1',
        type: 'Issue',
        data: { teamId: 'team-linear-1' },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.handleWebhook).not.toHaveBeenCalled();
    expect(fakes.writeIntegrationEvents).not.toHaveBeenCalled();
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('asks the provider to retry when delivery persistence fails', async () => {
    fakes.recordWebhookDeliveryTargets.mockRejectedValue(new Error('database down'));

    const response = await POST(
      signedRequest({
        organizationId: 'org-1',
        type: 'Issue',
        data: { teamId: 'team-linear-1' },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ reason: 'delivery_persist_failed' });
    expect(fakes.requireRedisQueue).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });
});
