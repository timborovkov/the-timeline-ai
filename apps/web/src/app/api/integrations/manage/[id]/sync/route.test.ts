import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getIntegration: vi.fn(),
  recordAudit: vi.fn(),
  requireRedisQueue: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
  adminLoadIntegrationSyncPause: vi.fn(),
  adminLoadProviderBudgetPause: vi.fn(),
  providerBudgetKeyForIntegration: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: fakes.requireRedisQueue }));
vi.mock('@timeline/shared/integrations', () => ({
  adminLoadIntegrationSyncPause: fakes.adminLoadIntegrationSyncPause,
  adminLoadProviderBudgetPause: fakes.adminLoadProviderBudgetPause,
  providerBudgetKeyForIntegration: fakes.providerBudgetKeyForIntegration,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    integrations: {
      getIntegration: fakes.getIntegration,
      recordAudit: fakes.recordAudit,
    },
  }),
}));

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';

function params() {
  return { params: Promise.resolve({ id: INTEGRATION_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'admin' } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.getIntegration.mockResolvedValue({
    id: INTEGRATION_ID,
    teamId: TEAM_ID,
    provider: 'monday',
    externalAccountId: 'acct-1',
  });
  fakes.recordAudit.mockResolvedValue(undefined);
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
  });
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
  fakes.adminLoadIntegrationSyncPause.mockResolvedValue(null);
  fakes.adminLoadProviderBudgetPause.mockResolvedValue(null);
  fakes.providerBudgetKeyForIntegration.mockReturnValue({
    provider: 'monday',
    appKey: 'monday-client',
    externalAccountId: 'acct-1',
    scope: 'requests',
  });
});

describe('/api/integrations/manage/[id]/sync', () => {
  it('enqueues a manual backfill when no provider budget pause is active', async () => {
    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    expect(fakes.requireRedisQueue).toHaveBeenCalledOnce();
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'backfill',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: USER_ID,
    });
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'backfill_requested',
      { actor: USER_ID },
      INTEGRATION_ID,
    );
  });

  it('does not enqueue manual sync while the provider budget is paused', async () => {
    const retryAt = new Date('2026-06-28T12:00:00.000Z');
    fakes.adminLoadProviderBudgetPause.mockResolvedValueOnce({
      retryAt,
      reason: 'daily_limit_exceeded',
      scope: 'daily',
    });

    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: 'provider_budget_paused',
      reason: 'daily_limit_exceeded',
      retryAt: retryAt.toISOString(),
      scope: 'daily',
    });
    expect(fakes.requireRedisQueue).not.toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'backfill_skipped:provider_budget',
      {
        actor: USER_ID,
        provider: 'monday',
        reason: 'daily_limit_exceeded',
        scope: 'daily',
        retryAt: retryAt.toISOString(),
      },
      INTEGRATION_ID,
    );
  });
});
