import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  loadWebhookDeliveryWork: vi.fn(),
  markWebhookDeliveryStatus: vi.fn(),
  markWebhookDeliveryTargetProcessing: vi.fn(),
  markWebhookDeliveryTargetProcessed: vi.fn(),
  markWebhookDeliveryTargetIgnored: vi.fn(),
  markWebhookDeliveryTargetFailed: vi.fn(),
  markWebhookDeliveryDeadLettered: vi.fn(),
  adminRecordConnectionAttention: vi.fn(),
  getProvider: vi.fn(),
  isNativeProviderId: vi.fn(),
  providerSyncPolicy: vi.fn(),
  writeIntegrationEvents: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
}));

vi.mock('@timeline/shared', () => ({
  childLogger: () => ({ info: vi.fn(), error: vi.fn() }),
  integrations: {
    loadWebhookDeliveryWork: fakes.loadWebhookDeliveryWork,
    markWebhookDeliveryStatus: fakes.markWebhookDeliveryStatus,
    markWebhookDeliveryTargetProcessing: fakes.markWebhookDeliveryTargetProcessing,
    markWebhookDeliveryTargetProcessed: fakes.markWebhookDeliveryTargetProcessed,
    markWebhookDeliveryTargetIgnored: fakes.markWebhookDeliveryTargetIgnored,
    markWebhookDeliveryTargetFailed: fakes.markWebhookDeliveryTargetFailed,
    markWebhookDeliveryDeadLettered: fakes.markWebhookDeliveryDeadLettered,
    adminRecordConnectionAttention: fakes.adminRecordConnectionAttention,
    getProvider: fakes.getProvider,
    isNativeProviderId: fakes.isNativeProviderId,
    providerSyncPolicy: fakes.providerSyncPolicy,
    writeIntegrationEvents: fakes.writeIntegrationEvents,
  },
  queue: {
    QUEUE_NAMES: { webhookDelivery: 'webhook-delivery' },
    getRedisConnection: vi.fn(),
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
  },
}));

vi.mock('bullmq', () => ({ Worker: vi.fn() }));
vi.mock('#src/monitoring.js', () => ({ captureWorkerJobFailure: vi.fn() }));

const { deadLetterWebhookDeliveryJobIfExhausted, processWebhookDeliveryJob } =
  await import('#src/workers/webhookDelivery.js');

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const INTEGRATION_ID = '44444444-4444-4444-8444-444444444444';

const delivery = {
  id: DELIVERY_ID,
  provider: 'linear',
  payload: { type: 'Issue', data: { id: 'issue-1', updatedAt: '2026-06-28T00:00:00Z' } },
};

const target = {
  id: TARGET_ID,
  integrationId: INTEGRATION_ID,
  teamId: TEAM_ID,
};

const integration = {
  id: INTEGRATION_ID,
  teamId: TEAM_ID,
  provider: 'linear',
  providerConnectionId: null,
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.markWebhookDeliveryStatus.mockResolvedValue(undefined);
  fakes.markWebhookDeliveryTargetProcessing.mockResolvedValue(undefined);
  fakes.markWebhookDeliveryTargetProcessed.mockResolvedValue(undefined);
  fakes.markWebhookDeliveryTargetIgnored.mockResolvedValue(undefined);
  fakes.markWebhookDeliveryTargetFailed.mockResolvedValue(undefined);
  fakes.markWebhookDeliveryDeadLettered.mockResolvedValue(undefined);
  fakes.adminRecordConnectionAttention.mockResolvedValue(undefined);
  fakes.writeIntegrationEvents.mockResolvedValue(['raw-event-1']);
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
  fakes.isNativeProviderId.mockReturnValue(true);
  fakes.getProvider.mockReturnValue({
    handleWebhook: vi.fn().mockResolvedValue([
      {
        dedupKey: 'linear:issue:issue-1:2026-06-28T00:00:00Z',
        provider: 'linear',
      },
    ]),
  });
  fakes.providerSyncPolicy.mockReturnValue({
    supportsTargetedSync: false,
  });
});

describe('webhook delivery worker', () => {
  it('normalizes each pending target, writes events, and enqueues catch-up sync', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery,
      targets: [{ target, integration }],
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toEqual({
      deliveryId: DELIVERY_ID,
      processed: 1,
      ignored: 0,
      failed: 0,
    });

    expect(fakes.markWebhookDeliveryStatus).toHaveBeenNthCalledWith(
      1,
      {},
      DELIVERY_ID,
      'processing',
    );
    expect(fakes.markWebhookDeliveryTargetProcessing).toHaveBeenCalledWith({}, TARGET_ID);
    expect(fakes.writeIntegrationEvents).toHaveBeenCalledWith({
      db: {},
      integration,
      events: [
        {
          dedupKey: 'linear:issue:issue-1:2026-06-28T00:00:00Z',
          provider: 'linear',
        },
      ],
    });
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'webhook',
    });
    expect(fakes.markWebhookDeliveryTargetProcessed).toHaveBeenCalledWith({}, TARGET_ID, {
      eventDedupKeys: ['linear:issue:issue-1:2026-06-28T00:00:00Z'],
    });
    expect(fakes.markWebhookDeliveryStatus).toHaveBeenLastCalledWith({}, DELIVERY_ID, 'processed');
  });

  it('enqueues provider-supplied targeted sync tasks instead of a full catch-up', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery: {
        ...delivery,
        provider: 'github',
        payload: { repository: { full_name: 'acme/app' } },
      },
      targets: [{ target, integration: { ...integration, provider: 'github' } }],
    });
    fakes.getProvider.mockReturnValueOnce({
      handleWebhook: vi.fn().mockResolvedValue({
        events: [
          {
            dedupKey: 'github:commit:sha-1',
            provider: 'github',
          },
        ],
        syncTasks: [
          {
            integrationId: INTEGRATION_ID,
            teamId: TEAM_ID,
            triggeredBy: 'webhook',
            resourceType: 'github.repo',
            externalId: 'acme/app',
            reason: 'github_repo_webhook',
          },
        ],
      }),
    });
    fakes.providerSyncPolicy.mockReturnValueOnce({
      supportsTargetedSync: true,
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toMatchObject({
      processed: 1,
      ignored: 0,
      failed: 0,
    });

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'webhook',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      reason: 'github_repo_webhook',
    });
  });

  it('falls back to broad catch-up when a provider returns targeted tasks without targeted support', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery: {
        ...delivery,
        provider: 'linear',
        payload: { type: 'Issue', data: { id: 'issue-1' } },
      },
      targets: [{ target, integration }],
    });
    fakes.getProvider.mockReturnValueOnce({
      handleWebhook: vi.fn().mockResolvedValue({
        events: [],
        syncTasks: [
          {
            integrationId: INTEGRATION_ID,
            teamId: TEAM_ID,
            triggeredBy: 'webhook',
            resourceType: 'linear.issue',
            externalId: 'issue-1',
            reason: 'linear_issue_webhook',
          },
        ],
      }),
    });
    fakes.providerSyncPolicy.mockReturnValueOnce({
      supportsTargetedSync: false,
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toMatchObject({
      processed: 1,
      ignored: 0,
      failed: 0,
    });

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'webhook',
    });
  });

  it('marks deliveries with no pending targets as ignored', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery,
      targets: [],
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toEqual({
      deliveryId: DELIVERY_ID,
      processed: 0,
      ignored: 0,
      failed: 0,
    });

    expect(fakes.markWebhookDeliveryStatus).toHaveBeenLastCalledWith({}, DELIVERY_ID, 'ignored');
    expect(fakes.getProvider).not.toHaveBeenCalled();
  });

  it('leaves terminal deliveries unchanged when a duplicate webhook redelivery has no pending targets', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery: { ...delivery, status: 'processed' },
      targets: [],
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toEqual({
      deliveryId: DELIVERY_ID,
      processed: 0,
      ignored: 0,
      failed: 0,
      skipped: true,
    });

    expect(fakes.markWebhookDeliveryStatus).not.toHaveBeenCalled();
    expect(fakes.getProvider).not.toHaveBeenCalled();
  });

  it('ignores non-native provider deliveries before provider dispatch', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery: { ...delivery, provider: 'mcp' },
      targets: [{ target, integration: { ...integration, provider: 'mcp' } }],
    });
    fakes.isNativeProviderId.mockReturnValueOnce(false);

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toEqual({
      deliveryId: DELIVERY_ID,
      processed: 0,
      ignored: 0,
      failed: 0,
    });

    expect(fakes.markWebhookDeliveryStatus).toHaveBeenLastCalledWith(
      {},
      DELIVERY_ID,
      'ignored',
      'provider_not_native',
    );
    expect(fakes.getProvider).not.toHaveBeenCalled();
  });

  it('ignores disabled integrations without calling the provider', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery,
      targets: [{ target, integration: { ...integration, enabled: false } }],
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toMatchObject({
      processed: 0,
      ignored: 1,
      failed: 0,
    });

    expect(fakes.markWebhookDeliveryTargetIgnored).toHaveBeenCalledWith(
      {},
      TARGET_ID,
      'integration_disabled',
    );
    expect(fakes.writeIntegrationEvents).not.toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('processes wake-up deliveries with no direct events and still enqueues catch-up sync', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery: {
        ...delivery,
        provider: 'google_drive',
        payload: { headers: { resourceState: 'change' } },
      },
      targets: [
        {
          target,
          integration: { ...integration, provider: 'google_drive' },
        },
      ],
    });
    fakes.getProvider.mockReturnValueOnce({
      handleWebhook: vi.fn().mockResolvedValue([]),
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).resolves.toEqual({
      deliveryId: DELIVERY_ID,
      processed: 1,
      ignored: 0,
      failed: 0,
    });

    expect(fakes.writeIntegrationEvents).not.toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'webhook',
    });
    expect(fakes.markWebhookDeliveryTargetProcessed).toHaveBeenCalledWith({}, TARGET_ID, {
      eventDedupKeys: [],
    });
    expect(fakes.markWebhookDeliveryStatus).toHaveBeenLastCalledWith({}, DELIVERY_ID, 'processed');
  });

  it('marks failed targets and throws so BullMQ retries the delivery', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery,
      targets: [{ target, integration }],
    });
    fakes.getProvider.mockReturnValueOnce({
      handleWebhook: vi.fn().mockRejectedValue(new Error('provider parse failed')),
    });

    await expect(
      processWebhookDeliveryJob({ db: {} as never }, { deliveryId: DELIVERY_ID }),
    ).rejects.toThrow('webhook_delivery_failed');

    expect(fakes.markWebhookDeliveryTargetFailed).toHaveBeenCalledWith(
      {},
      TARGET_ID,
      'provider parse failed',
    );
    expect(fakes.markWebhookDeliveryStatus).toHaveBeenLastCalledWith(
      {},
      DELIVERY_ID,
      'failed',
      expect.stringContaining('provider parse failed'),
    );
  });

  it('dead-letters exhausted jobs and surfaces webhook degradation attention', async () => {
    fakes.loadWebhookDeliveryWork.mockResolvedValueOnce({
      delivery: { ...delivery, status: 'failed' },
      targets: [{ target, integration }],
    });

    await deadLetterWebhookDeliveryJobIfExhausted(
      { db: {} as never },
      {
        data: { deliveryId: DELIVERY_ID },
        attemptsMade: 5,
        opts: { attempts: 5 },
      } as never,
      new Error('provider parse failed'),
    );

    expect(fakes.markWebhookDeliveryDeadLettered).toHaveBeenCalledWith(
      {},
      DELIVERY_ID,
      'provider parse failed',
    );
    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith({}, TEAM_ID, {
      integrationId: INTEGRATION_ID,
      providerConnectionId: null,
      category: 'webhook_degraded',
      summary:
        'linear webhook delivery could not be processed after repeated retries. Reconciliation remains active while webhook delivery is repaired.',
    });
  });

  it('does not dead-letter before BullMQ attempts are exhausted', async () => {
    await deadLetterWebhookDeliveryJobIfExhausted(
      { db: {} as never },
      {
        data: { deliveryId: DELIVERY_ID },
        attemptsMade: 2,
        opts: { attempts: 5 },
      } as never,
      new Error('provider parse failed'),
    );

    expect(fakes.loadWebhookDeliveryWork).not.toHaveBeenCalled();
    expect(fakes.markWebhookDeliveryDeadLettered).not.toHaveBeenCalled();
    expect(fakes.adminRecordConnectionAttention).not.toHaveBeenCalled();
  });
});
