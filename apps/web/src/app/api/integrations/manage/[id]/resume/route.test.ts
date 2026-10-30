import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getIntegration: vi.fn(),
  resumeIntegrationHealth: vi.fn(),
  completeHealthResumeBackfill: vi.fn(),
  recordAudit: vi.fn(),
  requireRedisQueue: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
  loggerInfo: vi.fn(),
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
  import.meta.resolve('@timeline/shared/logger'),
  () => ({
    childLogger: () => ({ info: fakes.loggerInfo, warn: vi.fn(), error: vi.fn() }),
  }),
  () => import('@timeline/shared/logger'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.requireMembership,
      integrations: {
        getIntegration: fakes.getIntegration,
        resumeIntegrationHealth: fakes.resumeIntegrationHealth,
        completeHealthResumeBackfill: fakes.completeHealthResumeBackfill,
        recordAudit: fakes.recordAudit,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

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
    provider: 'github',
    providerConnectionId: CONNECTION_ID,
    lastError: 'GitHub GET /repos/acme/app: 403 forbidden',
  });
  fakes.resumeIntegrationHealth.mockResolvedValue({
    resumed: true,
    backfillPending: true,
    previousKind: 'access_revoked',
    previousError: 'GitHub GET /repos/acme/app: 403 forbidden',
    firstFailedAt: new Date('2026-06-25T12:00:00.000Z'),
    pausedAt: new Date('2026-06-28T12:00:00.000Z'),
  });
  fakes.completeHealthResumeBackfill.mockResolvedValue(undefined);
  fakes.recordAudit.mockResolvedValue(undefined);
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
  });
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
});

describe('/api/integrations/manage/[id]/resume', () => {
  it('requires authentication and admin membership', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await POST(new Request('https://timeline.test'), params());
    expect(unauthenticated.status).toBe(401);

    fakes.requireMembership.mockRejectedValueOnce(new Error('forbidden'));
    const forbidden = await POST(new Request('https://timeline.test'), params());
    expect(forbidden.status).toBe(403);
  });

  it('resumes a health-paused integration, audits the backfill, and enqueues catch-up', async () => {
    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, resumed: true });
    expect(fakes.resumeIntegrationHealth).toHaveBeenCalledWith(INTEGRATION_ID);
    expect(fakes.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: INTEGRATION_ID,
        previousKind: 'access_revoked',
        actor: USER_ID,
      }),
      expect.stringContaining('cause=GitHub GET /repos/acme/app: 403 forbidden'),
    );
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'backfill',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: USER_ID,
    });
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'backfill_requested',
      { actor: USER_ID, reason: 'health_resume' },
      INTEGRATION_ID,
    );
    expect(fakes.completeHealthResumeBackfill).toHaveBeenCalledWith(INTEGRATION_ID);
  });

  it('does not enqueue backfill when the integration is not paused and has no pending catch-up', async () => {
    fakes.resumeIntegrationHealth.mockResolvedValueOnce({
      resumed: false,
      backfillPending: false,
      previousKind: null,
      previousError: null,
      firstFailedAt: null,
      pausedAt: null,
    });

    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, resumed: false });
    expect(fakes.requireRedisQueue).not.toHaveBeenCalled();
    expect(fakes.recordAudit).not.toHaveBeenCalled();
    expect(fakes.completeHealthResumeBackfill).not.toHaveBeenCalled();
  });

  it('re-enqueues backfill when pause was already cleared but catch-up is still pending', async () => {
    fakes.resumeIntegrationHealth.mockResolvedValueOnce({
      resumed: false,
      backfillPending: true,
      previousKind: 'connectivity',
      previousError: 'fetch failed ETIMEDOUT',
      firstFailedAt: new Date('2026-06-25T12:00:00.000Z'),
      pausedAt: new Date('2026-06-28T12:00:00.000Z'),
    });

    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, resumed: true });
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'backfill',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: USER_ID,
    });
    expect(fakes.completeHealthResumeBackfill).toHaveBeenCalledWith(INTEGRATION_ID);
  });

  it('leaves pending catch-up in place when enqueue fails so a retry can recover', async () => {
    fakes.enqueueIntegrationSyncJob.mockRejectedValueOnce(new Error('redis down'));

    await expect(POST(new Request('https://timeline.test'), params())).rejects.toThrow(
      'redis down',
    );
    expect(fakes.resumeIntegrationHealth).toHaveBeenCalledWith(INTEGRATION_ID);
    expect(fakes.completeHealthResumeBackfill).not.toHaveBeenCalled();
  });
});
