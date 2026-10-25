import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getIntegration: vi.fn(),
  recordAudit: vi.fn(),
  requireRedisQueue: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
  adminResumeIntegrationHealth: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: fakes.requireRedisQueue }));
vi.mock('@timeline/shared/integrations', () => ({
  adminResumeIntegrationHealth: fakes.adminResumeIntegrationHealth,
}));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ info: fakes.loggerInfo, warn: vi.fn(), error: vi.fn() }),
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
  fakes.recordAudit.mockResolvedValue(undefined);
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
  });
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
  fakes.adminResumeIntegrationHealth.mockResolvedValue({
    resumed: true,
    previousKind: 'access_revoked',
    previousError: 'GitHub GET /repos/acme/app: 403 forbidden',
    firstFailedAt: new Date('2026-06-25T12:00:00.000Z'),
    pausedAt: new Date('2026-06-28T12:00:00.000Z'),
  });
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

  it('resumes a health-paused integration, audits the cause, and enqueues backfill', async () => {
    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, resumed: true });
    expect(fakes.adminResumeIntegrationHealth).toHaveBeenCalledWith({}, INTEGRATION_ID);
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'sync_resumed:health',
      expect.objectContaining({
        actor: USER_ID,
        provider: 'github',
        previousKind: 'access_revoked',
        cause: 'GitHub GET /repos/acme/app: 403 forbidden',
        providerConnectionId: CONNECTION_ID,
      }),
      INTEGRATION_ID,
    );
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
  });

  it('does not enqueue backfill when the integration is not health-paused', async () => {
    fakes.adminResumeIntegrationHealth.mockResolvedValueOnce({
      resumed: false,
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
  });
});
