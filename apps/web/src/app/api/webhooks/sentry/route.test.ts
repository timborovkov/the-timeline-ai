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
  subscriptionIntegrationRows: [] as {
    id: string;
    teamId: string;
    externalAccountId: string | null;
    providerConnectionId: string | null;
  }[],
  selectionRows: [] as { integrationId: string; selectionKind: string; externalId: string }[],
  insertValues: vi.fn(),
  onConflictDoNothing: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
  enqueueWebhookDeliveryJob: vi.fn(),
  recordWebhookDeliveryTargets: vi.fn(),
  requireRedisQueue: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn((shape?: unknown) => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() =>
            Promise.resolve(
              fakes.subscriptionIntegrationRows.map((integration) => ({ integration })),
            ),
          ),
        })),
        where: vi.fn(() => {
          if (shape) return Promise.resolve(fakes.selectionRows);
          return Promise.resolve(fakes.integrationRows);
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: fakes.insertValues.mockImplementation(() => ({
        onConflictDoNothing: fakes.onConflictDoNothing.mockResolvedValue(undefined),
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

function signedRequest(payload: unknown, input: { signature?: boolean; requestId?: string } = {}) {
  const body = JSON.stringify(payload);
  const digest = createHmac('sha256', 'sentry-secret').update(body, 'utf8').digest('hex');
  return new Request('https://timeline.test/api/webhooks/sentry', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'request-id': input.requestId ?? 'request-1',
      'sentry-hook-resource': 'event_alert',
      'sentry-hook-timestamp': '2026-06-20T10:00:00Z',
      'sentry-hook-signature': input.signature === false ? 'bad' : digest,
    },
    body,
  });
}

beforeEach(() => {
  process.env.SENTRY_INTEGRATION_CLIENT_SECRET = 'sentry-secret';
  resetEnvForTests();
  fakes.integrationRows = [
    {
      id: 'integration-1',
      teamId: 'team-1',
      externalAccountId: 'acme',
      providerConnectionId: 'connection-1',
    },
  ];
  fakes.subscriptionIntegrationRows = [];
  fakes.selectionRows = [
    { integrationId: 'integration-1', selectionKind: 'sentry.project', externalId: 'acme/web' },
  ];
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

describe('POST /api/webhooks/sentry', () => {
  it('rejects bad signatures before routing', async () => {
    const response = await POST(signedRequest({ action: 'triggered' }, { signature: false }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: 'bad_signature' });
    expect(fakes.recordWebhookDeliveryTargets).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('routes selected project alerts to the matched integration', async () => {
    const payload = {
      action: 'triggered',
      installation: { uuid: 'installation-1' },
      data: {
        event: {
          issue_id: 'issue-1',
          title: 'Checkout failed',
          datetime: '2026-06-20T10:00:00Z',
          project_slug: 'web',
          web_url: 'https://sentry.io/organizations/acme/issues/issue-1/',
        },
      },
    };

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'sentry',
        externalDeliveryId: 'request-1',
        externalAccountId: 'acme',
        resourceKind: 'sentry.project',
        externalResourceId: 'acme/web',
        eventType: 'event_alert',
        action: 'triggered',
        dedupKey: 'sentry:delivery:request-1',
        targets: [
          {
            teamId: 'team-1',
            integrationId: 'integration-1',
            providerConnectionId: 'connection-1',
          },
        ],
      }),
    );
    expect(fakes.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        integrationId: 'integration-1',
        provider: 'sentry',
        externalSubscriptionId: 'installation-1',
        resourceKind: 'sentry.installation',
        externalResourceId: 'acme',
      }),
    ]);
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('routes issue lifecycle payloads by data.issue project identity', async () => {
    const payload = {
      action: 'resolved',
      installation: { uuid: 'installation-1' },
      organization: { slug: 'acme' },
      data: {
        issue: {
          id: 'issue-1',
          shortId: 'WEB-1',
          title: 'Checkout failed',
          status: 'resolved',
          permalink: 'https://sentry.io/organizations/acme/issues/issue-1/',
          project: { slug: 'web' },
        },
      },
    };

    const response = await POST(signedRequest(payload, { requestId: 'request-issue-1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'sentry',
        externalDeliveryId: 'request-issue-1',
        externalAccountId: 'acme',
        resourceKind: 'sentry.project',
        externalResourceId: 'acme/web',
        action: 'resolved',
        targets: [
          {
            teamId: 'team-1',
            integrationId: 'integration-1',
            providerConnectionId: 'connection-1',
          },
        ],
      }),
    );
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('routes release payloads by data.release project identity', async () => {
    const payload = {
      action: 'deployed',
      installation: { uuid: 'installation-1' },
      organization: { slug: 'acme' },
      data: {
        release: {
          version: 'web@1.2.4',
          dateReleased: '2026-06-20T12:00:00Z',
          url: 'https://sentry.io/organizations/acme/projects/web/releases/web@1.2.4/',
          projects: [{ slug: 'web' }],
        },
      },
    };

    const response = await POST(signedRequest(payload, { requestId: 'request-release-1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'sentry',
        externalDeliveryId: 'request-release-1',
        externalAccountId: 'acme',
        resourceKind: 'sentry.project',
        externalResourceId: 'acme/web',
        action: 'deployed',
        targets: [
          {
            teamId: 'team-1',
            integrationId: 'integration-1',
            providerConnectionId: 'connection-1',
          },
        ],
      }),
    );
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('routes alerts by remembered Sentry installation when the payload has no org slug', async () => {
    fakes.integrationRows = [];
    fakes.subscriptionIntegrationRows = [
      {
        id: 'integration-1',
        teamId: 'team-1',
        externalAccountId: 'acme',
        providerConnectionId: 'connection-1',
      },
    ];
    const payload = {
      action: 'triggered',
      installation: { uuid: 'installation-1' },
      data: {
        event: {
          issue_id: 'issue-1',
          title: 'Checkout failed',
          datetime: '2026-06-20T10:00:00Z',
        },
      },
    };

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalAccountId: 'installation-1',
        resourceKind: 'sentry.installation',
        externalResourceId: 'installation-1',
        targets: [
          {
            teamId: 'team-1',
            integrationId: 'integration-1',
            providerConnectionId: 'connection-1',
          },
        ],
      }),
    );
    expect(fakes.enqueueWebhookDeliveryJob).toHaveBeenCalledWith({ deliveryId: 'delivery-row-1' });
  });

  it('keeps persisted deliveries when Redis queue setup fails', async () => {
    fakes.requireRedisQueue.mockRejectedValue(new Error('REDIS_URL is required'));

    const response = await POST(
      signedRequest({
        action: 'triggered',
        data: {
          event: {
            issue_id: 'issue-1',
            project_slug: 'web',
            web_url: 'https://sentry.io/organizations/acme/issues/issue-1/',
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, reason: 'enqueue_failed' });
    expect(fakes.recordWebhookDeliveryTargets).toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });

  it('asks Sentry to retry when delivery persistence fails', async () => {
    fakes.recordWebhookDeliveryTargets.mockRejectedValue(new Error('database down'));

    const response = await POST(
      signedRequest({
        action: 'triggered',
        data: {
          event: {
            issue_id: 'issue-1',
            project_slug: 'web',
            web_url: 'https://sentry.io/organizations/acme/issues/issue-1/',
          },
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ reason: 'delivery_persist_failed' });
    expect(fakes.requireRedisQueue).not.toHaveBeenCalled();
    expect(fakes.enqueueWebhookDeliveryJob).not.toHaveBeenCalled();
  });
});
