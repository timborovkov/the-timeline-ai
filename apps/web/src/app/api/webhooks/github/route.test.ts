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

function signedRequest(payload: unknown, input: { signature?: boolean; event?: string } = {}) {
  const body = JSON.stringify(payload);
  const digest = createHmac('sha256', 'github-webhook-secret').update(body, 'utf8').digest('hex');
  return new Request('https://timeline.test/api/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': 'delivery-1',
      'x-github-event': input.event ?? 'pull_request',
      'x-github-hook-id': 'hook-1',
      'x-hub-signature-256': input.signature === false ? 'sha256=bad' : `sha256=${digest}`,
    },
    body,
  });
}

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = 'github-webhook-secret';
  resetEnvForTests();
  fakes.integrationRows = [
    {
      id: 'integration-1',
      teamId: 'team-1',
      externalAccountId: 'github-user-1',
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

describe('POST /api/webhooks/github', () => {
  it('rejects bad signatures before routing', async () => {
    const response = await POST(
      signedRequest({ repository: { full_name: 'acme/app' } }, { signature: false }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: 'bad_signature' });
    expect(fakes.recordWebhookDeliveryTargets).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('persists a selected repository delivery and enqueues webhook processing', async () => {
    const payload = {
      action: 'opened',
      repository: { full_name: 'acme/app' },
      pull_request: {
        id: 7,
        number: 7,
        title: 'Add webhook ingestion',
        html_url: 'https://github.com/acme/app/pull/7',
        state: 'open',
        updated_at: '2026-06-25T10:00:00Z',
        user: { login: 'alice' },
        base: { ref: 'main' },
        head: { ref: 'webhooks' },
      },
    };

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'github',
        externalDeliveryId: 'delivery-1',
        externalAccountId: 'acme',
        resourceKind: 'github.repo',
        externalResourceId: 'acme/app',
        eventType: 'pull_request',
        action: 'opened',
        dedupKey: 'github:delivery:delivery-1',
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

  it('records unmatched signed deliveries without cross-team fan-out', async () => {
    fakes.selectionRows = [];
    fakes.integrationRows = [];

    const response = await POST(
      signedRequest({ action: 'created', repository: { full_name: 'acme/new-repo' } }),
    );

    expect(response.status).toBe(200);
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalResourceId: 'acme/new-repo',
        targets: [],
      }),
    );
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('keeps persisted deliveries when Redis queue setup fails', async () => {
    fakes.requireRedisQueue.mockRejectedValue(new Error('REDIS_URL is required'));

    const response = await POST(
      signedRequest({ action: 'opened', repository: { full_name: 'acme/app' } }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, reason: 'enqueue_failed' });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('asks GitHub to retry when delivery persistence fails', async () => {
    fakes.recordWebhookDeliveryTargets.mockRejectedValue(new Error('database down'));

    const response = await POST(
      signedRequest({ action: 'opened', repository: { full_name: 'acme/app' } }),
    );

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
