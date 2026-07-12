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
  selectionRows: [] as { integrationId: string }[],
  enqueueIntegrationSyncJob: vi.fn(),
  enqueueWebhookDeliveryJob: vi.fn(),
  recordWebhookDeliveryTargets: vi.fn(),
  requireRedisQueue: vi.fn(),
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

function request(payload: unknown, token = 'monday-webhook-secret') {
  return new Request(`https://timeline.test/api/webhooks/monday?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function mondayEvent() {
  return {
    event: {
      userId: 9603417,
      boardId: 1771812698,
      pulseId: 1771812728,
      pulseName: 'Launch checklist',
      columnId: 'status',
      columnType: 'color',
      columnTitle: 'Status',
      value: { label: 'Done' },
      previousValue: { label: 'Working on it' },
      type: 'update_column_value',
      triggerTime: '2026-06-25T09:15:03.429Z',
      subscriptionId: 73760484,
      triggerUuid: '645fc8d8709d35718f1ae00ceded91e9',
    },
  };
}

beforeEach(() => {
  process.env.MONDAY_WEBHOOK_SECRET = 'monday-webhook-secret';
  resetEnvForTests();
  fakes.integrationRows = [
    {
      id: 'integration-1',
      teamId: 'team-1',
      externalAccountId: 'monday-account-1',
      providerConnectionId: 'connection-1',
    },
  ];
  fakes.selectionRows = [{ integrationId: 'integration-1' }];
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

describe('POST /api/webhooks/monday', () => {
  it('echoes monday.com URL verification challenges after token verification', async () => {
    const response = await POST(request({ challenge: 'challenge-token' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: 'challenge-token' });
    expect(fakes.recordWebhookDeliveryTargets).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('rejects bad tokens before challenge or routing', async () => {
    const response = await POST(request({ challenge: 'challenge-token' }, 'bad-token'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: 'bad_token' });
    expect(fakes.recordWebhookDeliveryTargets).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('persists selected board deliveries and enqueues webhook processing', async () => {
    const response = await POST(request(mondayEvent()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'monday',
        externalDeliveryId: '645fc8d8709d35718f1ae00ceded91e9',
        resourceKind: 'monday.board',
        externalResourceId: '1771812698',
        eventType: 'update_column_value',
        action: 'update_column_value',
        dedupKey: 'monday:delivery:645fc8d8709d35718f1ae00ceded91e9',
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

  it('routes classic subitem deliveries through the selected parent board', async () => {
    const payload = mondayEvent();
    payload.event.boardId = 1999999999;
    Object.assign(payload.event, {
      parentItemBoardId: 1771812698,
      parentItemId: 1771812700,
      type: 'create_pulse',
    });

    const response = await POST(request(payload));

    expect(response.status).toBe(200);
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalResourceId: '1771812698',
        eventType: 'create_pulse',
        targets: [
          {
            teamId: 'team-1',
            integrationId: 'integration-1',
            providerConnectionId: 'connection-1',
          },
        ],
      }),
    );
  });

  it('records unmatched board deliveries without cross-team fan-out', async () => {
    fakes.selectionRows = [];
    fakes.integrationRows = [];

    const response = await POST(request(mondayEvent()));

    expect(response.status).toBe(200);
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalResourceId: '1771812698',
        targets: [],
      }),
    );
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('keeps persisted deliveries when Redis queue setup fails', async () => {
    fakes.requireRedisQueue.mockRejectedValue(new Error('REDIS_URL is required'));

    const response = await POST(request(mondayEvent()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, reason: 'enqueue_failed' });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('asks monday.com to retry when delivery persistence fails', async () => {
    fakes.recordWebhookDeliveryTargets.mockRejectedValue(new Error('database down'));

    const response = await POST(request(mondayEvent()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ reason: 'delivery_persist_failed' });
    expect(fakes.requireRedisQueue).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });
});

describe('payload size limit', () => {
  it('rejects an oversized body before authentication or parsing', async () => {
    const response = await POST(
      new Request('http://test/webhook', {
        method: 'POST',
        headers: { 'content-length': String(1024 * 1024 + 1) },
        body: '{}',
      }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ reason: 'payload_too_large' });
  });
});
