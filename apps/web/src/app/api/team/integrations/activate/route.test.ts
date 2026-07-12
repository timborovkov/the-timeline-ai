import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Team integration activation is admin-only. This route turns previously shared
 * personal provider resources into active team source paths and records the
 * onboarding/analytics side effects users rely on.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  activateSharedResources: vi.fn(),
  recordAudit: vi.fn(),
  recordConnectionAttention: vi.fn(),
  resolveConnectionAttention: vi.fn(),
  adminReconcileIntegrationWebhookSubscriptions: vi.fn(),
  missingRequiredProviderScopes: vi.fn(),
  safeMarkOnboardingStep: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  requireRedisQueue: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/analytics', () => ({
  trackProductEventBestEffort: fakes.trackProductEventBestEffort,
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/onboarding', () => ({ safeMarkOnboardingStep: fakes.safeMarkOnboardingStep }));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: fakes.requireRedisQueue }));
vi.mock('@timeline/shared/integrations', () => ({
  adminReconcileIntegrationWebhookSubscriptions:
    fakes.adminReconcileIntegrationWebhookSubscriptions,
  missingRequiredProviderScopes: fakes.missingRequiredProviderScopes,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    integrations: {
      activateSharedResources: fakes.activateSharedResources,
      recordAudit: fakes.recordAudit,
      recordConnectionAttention: fakes.recordConnectionAttention,
      resolveConnectionAttention: fakes.resolveConnectionAttention,
    },
  }),
}));

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const SHARE_ID = '66666666-6666-4666-8666-666666666666';
const INTEGRATION_ID = '77777777-7777-4777-8777-777777777777';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/team/integrations/activate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'admin' } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.activateSharedResources.mockResolvedValue({
    id: INTEGRATION_ID,
    provider: 'github',
    providerConnectionId: CONNECTION_ID,
    addedSelectionCount: 1,
  });
  fakes.recordAudit.mockResolvedValue(undefined);
  fakes.recordConnectionAttention.mockResolvedValue(undefined);
  fakes.resolveConnectionAttention.mockResolvedValue(undefined);
  fakes.adminReconcileIntegrationWebhookSubscriptions.mockResolvedValue({
    active: 0,
    deprovisioned: 0,
    skipped: true,
  });
  fakes.missingRequiredProviderScopes.mockReturnValue([]);
  fakes.safeMarkOnboardingStep.mockResolvedValue(true);
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
  });
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
});

describe('POST /api/team/integrations/activate', () => {
  it('keeps activation admin-only', async () => {
    fakes.requireMembership.mockRejectedValueOnce(new Error('forbidden'));

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [] }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(fakes.activateSharedResources).not.toHaveBeenCalled();
  });

  it('validates and activates shared source ids', async () => {
    const badBody = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: ['nope'] }),
    );
    expect(badBody.status).toBe(400);

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [SHARE_ID] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      integrationId: INTEGRATION_ID,
      syncRequired: true,
      syncQueued: true,
    });
    expect(fakes.activateSharedResources).toHaveBeenCalledWith({
      providerConnectionId: CONNECTION_ID,
      resourceShareIds: [SHARE_ID],
    });
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
    expect(fakes.safeMarkOnboardingStep).toHaveBeenCalledWith(
      expect.any(Object),
      'first_integration',
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      USER_ID,
      'integration_connected',
      expect.objectContaining({
        teamId: TEAM_ID,
        integrationId: INTEGRATION_ID,
        provider: 'github',
      }),
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      USER_ID,
      'onboarding_step_completed',
      expect.objectContaining({ step: 'first_integration', source: 'automatic' }),
    );
  });

  it('keeps activation successful when webhook provisioning degrades and records attention', async () => {
    fakes.activateSharedResources.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: CONNECTION_ID,
      addedSelectionCount: 1,
    });
    fakes.adminReconcileIntegrationWebhookSubscriptions.mockRejectedValueOnce(
      new Error('MONDAY_WEBHOOK_SECRET not configured'),
    );

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [SHARE_ID] }),
    );

    expect(response.status).toBe(200);
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'webhook_provision_failed',
      expect.objectContaining({
        provider: 'monday',
        error: 'MONDAY_WEBHOOK_SECRET not configured',
      }),
      INTEGRATION_ID,
    );
    expect(fakes.recordConnectionAttention).toHaveBeenCalledTimes(1);
    const attentionInput = fakes.recordConnectionAttention.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(attentionInput).toMatchObject({
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      category: 'webhook_degraded',
    });
    expect(attentionInput?.summary).toEqual(
      expect.stringContaining('Webhook provisioning failed for monday'),
    );
  });

  it('does not enqueue another full backfill when active sources are unchanged', async () => {
    fakes.activateSharedResources.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: CONNECTION_ID,
      addedSelectionCount: 0,
    });

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [SHARE_ID] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      integrationId: INTEGRATION_ID,
      syncRequired: false,
      syncQueued: false,
    });
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('keeps saved sources retryable when the initial backfill cannot be queued', async () => {
    fakes.activateSharedResources.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: CONNECTION_ID,
      addedSelectionCount: 1,
    });
    fakes.enqueueIntegrationSyncJob.mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [SHARE_ID] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      integrationId: INTEGRATION_ID,
      syncQueued: false,
    });
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'backfill_enqueue_failed',
      expect.objectContaining({ provider: 'monday', error: 'redis unavailable' }),
      INTEGRATION_ID,
    );
    expect(fakes.recordConnectionAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: INTEGRATION_ID,
        category: 'sync_error',
      }),
    );
    expect(fakes.adminReconcileIntegrationWebhookSubscriptions).toHaveBeenCalledWith(
      {},
      INTEGRATION_ID,
    );
  });

  it('skips Monday webhook provisioning and records reconnect attention when legacy scopes are missing', async () => {
    fakes.activateSharedResources.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: CONNECTION_ID,
      scopes: ['boards:read', 'users:read', 'updates:read', 'docs:read'],
    });
    fakes.missingRequiredProviderScopes.mockReturnValueOnce([
      'account:read',
      'webhooks:read',
      'webhooks:write',
    ]);

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [SHARE_ID] }),
    );

    expect(response.status).toBe(200);
    expect(fakes.adminReconcileIntegrationWebhookSubscriptions).not.toHaveBeenCalled();
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'webhook_provision_skipped_missing_scopes',
      {
        provider: 'monday',
        missingScopes: ['account:read', 'webhooks:read', 'webhooks:write'],
      },
      INTEGRATION_ID,
    );
    expect(fakes.recordConnectionAttention).toHaveBeenCalledWith({
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      category: 'needs_reconnect',
      summary:
        'monday connection is missing required OAuth scopes (account:read, webhooks:read, webhooks:write); reconnect to enable webhook provisioning and account-scoped provider budgets.',
    });
  });

  it('resolves webhook degraded attention when provisioning succeeds', async () => {
    fakes.activateSharedResources.mockResolvedValueOnce({
      id: INTEGRATION_ID,
      provider: 'monday',
      providerConnectionId: CONNECTION_ID,
    });
    fakes.adminReconcileIntegrationWebhookSubscriptions.mockResolvedValueOnce({
      active: 2,
      deprovisioned: 1,
      skipped: false,
    });

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [SHARE_ID] }),
    );

    expect(response.status).toBe(200);
    expect(fakes.resolveConnectionAttention).toHaveBeenCalledWith({
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      categories: ['webhook_degraded'],
    });
  });
});
