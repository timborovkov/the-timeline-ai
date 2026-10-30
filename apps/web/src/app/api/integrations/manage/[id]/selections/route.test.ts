import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
/**
 * Legacy integration selection management predates person-owned provider
 * connections. Provider-connection-backed integrations must stay on the shared
 * source path so admins cannot browse or add resources the owner never shared.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getIntegration: vi.fn(),
  getIntegrationTokens: vi.fn(),
  listSelections: vi.fn(),
  setSelections: vi.fn(),
  recordAudit: vi.fn(),
  recordError: vi.fn(),
  recordConnectionAttention: vi.fn(),
  resolveConnectionAttention: vi.fn(),
  listConnectionAttention: vi.fn(),
  getProvider: vi.fn(),
  adminReconcileIntegrationWebhookSubscriptions: vi.fn(),
  adminRecordPendingIntegrationSyncContinuations: vi.fn(),
  listSyncableResources: vi.fn(),
  requireRedisQueue: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({ requireRedisQueue: fakes.requireRedisQueue }),
  () => import('@/lib/queue'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/integrations'),
  () => ({
    ProviderRateLimitError: class ProviderRateLimitError extends Error {
      retryAt: Date;
      constructor(input: { message?: string; retryAt: Date }) {
        super(input.message);
        this.retryAt = input.retryAt;
      }
    },
    getProvider: fakes.getProvider,
    adminReconcileIntegrationWebhookSubscriptions:
      fakes.adminReconcileIntegrationWebhookSubscriptions,
    adminRecordPendingIntegrationSyncContinuations:
      fakes.adminRecordPendingIntegrationSyncContinuations,
  }),
  () => import('@timeline/shared/integrations'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.requireMembership,
      integrations: {
        getIntegration: fakes.getIntegration,
        getIntegrationTokens: fakes.getIntegrationTokens,
        listSelections: fakes.listSelections,
        setSelections: fakes.setSelections,
        recordAudit: fakes.recordAudit,
        recordError: fakes.recordError,
        recordConnectionAttention: fakes.recordConnectionAttention,
        resolveConnectionAttention: fakes.resolveConnectionAttention,
        listConnectionAttention: fakes.listConnectionAttention,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);

const { GET, PUT } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

function params() {
  return { params: Promise.resolve({ id: INTEGRATION_ID }) };
}

function request(body: unknown): Request {
  return new Request(`https://timeline.test/api/integrations/manage/${INTEGRATION_ID}/selections`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'admin' } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.getIntegration.mockResolvedValue({
    id: INTEGRATION_ID,
    provider: 'github',
    providerConnectionId: CONNECTION_ID,
  });
  fakes.getIntegrationTokens.mockResolvedValue({ accessToken: 'token' });
  fakes.listSelections.mockResolvedValue([]);
  fakes.setSelections.mockResolvedValue(undefined);
  fakes.recordAudit.mockResolvedValue(undefined);
  fakes.recordError.mockResolvedValue(undefined);
  fakes.recordConnectionAttention.mockResolvedValue(undefined);
  fakes.resolveConnectionAttention.mockResolvedValue(undefined);
  fakes.listConnectionAttention.mockResolvedValue([]);
  fakes.adminReconcileIntegrationWebhookSubscriptions.mockResolvedValue({
    active: 0,
    deprovisioned: 0,
    skipped: true,
  });
  fakes.adminRecordPendingIntegrationSyncContinuations.mockResolvedValue(undefined);
  fakes.getProvider.mockReturnValue({ listSyncableResources: fakes.listSyncableResources });
  fakes.listSyncableResources.mockResolvedValue([
    { kind: 'github.repo', externalId: 'acme/private' },
  ]);
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
  });
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
});

describe('/api/integrations/manage/[id]/selections', () => {
  it('does not list provider resources for provider-connection-backed integrations', async () => {
    const response = await GET(new Request('https://timeline.test'), params());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'provider_connection_scoped',
    });
    expect(fakes.getIntegrationTokens).not.toHaveBeenCalled();
    expect(fakes.listSyncableResources).not.toHaveBeenCalled();
  });

  it('does not mutate selections for provider-connection-backed integrations', async () => {
    const response = await PUT(
      request({
        selections: [{ kind: 'github.repo', externalId: 'acme/private', label: 'acme/private' }],
      }),
      params(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'provider_connection_scoped',
    });
    expect(fakes.getIntegrationTokens).not.toHaveBeenCalled();
    expect(fakes.setSelections).not.toHaveBeenCalled();
  });

  it('reconciles legacy integration webhooks after validated selection changes', async () => {
    fakes.getIntegration.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: null,
    });
    fakes.listSyncableResources.mockResolvedValueOnce([
      { kind: 'monday.board', externalId: 'board-1' },
    ]);

    const response = await PUT(
      request({
        selections: [{ kind: 'monday.board', externalId: 'board-1', label: 'Launch' }],
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(fakes.setSelections).toHaveBeenCalledWith(INTEGRATION_ID, [
      { kind: 'monday.board', externalId: 'board-1', label: 'Launch' },
    ]);
    expect(fakes.adminReconcileIntegrationWebhookSubscriptions).toHaveBeenCalledWith(
      {},
      INTEGRATION_ID,
    );
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'backfill',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: USER_ID,
    });
  });

  it('records degraded webhook attention when legacy selection provisioning fails', async () => {
    fakes.getIntegration.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: null,
    });
    fakes.listSyncableResources.mockResolvedValueOnce([
      { kind: 'monday.board', externalId: 'board-1' },
    ]);
    fakes.adminReconcileIntegrationWebhookSubscriptions.mockRejectedValueOnce(
      new Error('MONDAY_WEBHOOK_SECRET not configured'),
    );

    const response = await PUT(
      request({
        selections: [{ kind: 'monday.board', externalId: 'board-1', label: 'Launch' }],
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(fakes.recordConnectionAttention).toHaveBeenCalledTimes(1);
    const attentionInput = fakes.recordConnectionAttention.mock.calls[0]?.[0] as
      Record<string, unknown> | undefined;
    expect(attentionInput).toMatchObject({
      providerConnectionId: null,
      integrationId: INTEGRATION_ID,
      category: 'webhook_degraded',
    });
    expect(attentionInput?.summary).toEqual(
      expect.stringContaining('Webhook provisioning failed for monday'),
    );
  });

  it('stages retryable Monday webhook setup after a provider limit', async () => {
    const { ProviderRateLimitError } = await import('@timeline/shared/integrations');
    const retryAt = new Date(Date.now() + 60_000);
    fakes.getIntegration.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: null,
    });
    fakes.listSyncableResources.mockResolvedValueOnce([
      { kind: 'monday.board', externalId: 'board-1' },
    ]);
    fakes.adminReconcileIntegrationWebhookSubscriptions.mockRejectedValueOnce(
      new ProviderRateLimitError({
        provider: 'monday',
        retryAt,
        retryAfterSeconds: 60,
        scope: 'daily',
        reason: 'daily_limit_exceeded',
      }),
    );

    const response = await PUT(
      request({ selections: [{ kind: 'monday.board', externalId: 'board-1' }] }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(fakes.recordError).toHaveBeenCalledWith(INTEGRATION_ID, expect.any(String));
    expect(fakes.adminRecordPendingIntegrationSyncContinuations).toHaveBeenCalledWith(
      {},
      INTEGRATION_ID,
      [{ resourceType: 'monday.webhook', externalId: INTEGRATION_ID, retryAt }],
    );
  });

  it('retries a failed legacy backfill when selections are unchanged', async () => {
    fakes.getIntegration.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: null,
    });
    fakes.listSyncableResources.mockResolvedValueOnce([
      { kind: 'monday.board', externalId: 'board-1' },
    ]);
    fakes.listSelections.mockResolvedValueOnce([
      { selectionKind: 'monday.board', externalId: 'board-1' },
    ]);
    fakes.listConnectionAttention.mockResolvedValueOnce([
      { integrationId: INTEGRATION_ID, category: 'sync_error' },
    ]);

    const response = await PUT(
      request({
        selections: [{ kind: 'monday.board', externalId: 'board-1', label: 'Launch' }],
      }),
      params(),
    );

    await expect(response.json()).resolves.toMatchObject({ syncQueued: true });
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'backfill', integrationId: INTEGRATION_ID }),
    );
    expect(fakes.resolveConnectionAttention).toHaveBeenCalledWith({
      providerConnectionId: null,
      integrationId: INTEGRATION_ID,
      categories: ['sync_error'],
    });
  });
});
