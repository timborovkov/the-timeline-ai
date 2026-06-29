import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Disconnect must be boring even when provider-side webhook cleanup is not.
 * We try to deprovision provider-managed subscriptions before deletion, but a
 * failed provider cleanup should be audited and must not trap the user with a
 * connection they asked to remove.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  recordAudit: vi.fn(),
  adminDeprovisionIntegrationWebhookSubscriptions: vi.fn(),
  loggerWarn: vi.fn(),
  reportCaughtError: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('@timeline/shared/integrations', () => ({
  adminDeprovisionIntegrationWebhookSubscriptions:
    fakes.adminDeprovisionIntegrationWebhookSubscriptions,
}));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ warn: fakes.loggerWarn, error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    integrations: {
      getIntegration: fakes.getIntegration,
      deleteIntegration: fakes.deleteIntegration,
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
    provider: 'monday',
  });
  fakes.deleteIntegration.mockResolvedValue(undefined);
  fakes.recordAudit.mockResolvedValue(undefined);
  fakes.adminDeprovisionIntegrationWebhookSubscriptions.mockResolvedValue({
    deprovisioned: 2,
    skipped: false,
  });
});

describe('/api/integrations/manage/[id]/disconnect', () => {
  it('requires authentication and admin membership', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await POST(new Request('https://timeline.test'), params());
    expect(unauthenticated.status).toBe(401);

    fakes.auth.mockResolvedValueOnce({ user: { id: USER_ID } });
    fakes.requireMembership.mockRejectedValueOnce(new Error('forbidden'));
    const forbidden = await POST(new Request('https://timeline.test'), params());
    expect(forbidden.status).toBe(403);
    expect(fakes.getIntegration).not.toHaveBeenCalled();
    expect(fakes.deleteIntegration).not.toHaveBeenCalled();
  });

  it('returns not found without attempting provider cleanup', async () => {
    fakes.getIntegration.mockResolvedValueOnce(null);

    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(404);
    expect(fakes.adminDeprovisionIntegrationWebhookSubscriptions).not.toHaveBeenCalled();
    expect(fakes.deleteIntegration).not.toHaveBeenCalled();
  });

  it('deprovisions provider webhooks before deleting the integration', async () => {
    const callOrder: string[] = [];
    fakes.adminDeprovisionIntegrationWebhookSubscriptions.mockImplementationOnce(() => {
      callOrder.push('deprovision');
      return Promise.resolve({ deprovisioned: 2, skipped: false });
    });
    fakes.deleteIntegration.mockImplementationOnce(() => {
      callOrder.push('delete');
      return Promise.resolve();
    });

    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.adminDeprovisionIntegrationWebhookSubscriptions).toHaveBeenCalledWith(
      {},
      INTEGRATION_ID,
    );
    expect(fakes.deleteIntegration).toHaveBeenCalledWith(INTEGRATION_ID);
    expect(fakes.recordAudit).toHaveBeenCalledWith('disconnect', { provider: 'monday' }, null);
    expect(callOrder).toEqual(['deprovision', 'delete']);
  });

  it('audits webhook cleanup failures but still disconnects', async () => {
    fakes.adminDeprovisionIntegrationWebhookSubscriptions.mockRejectedValueOnce(
      new Error('Monday delete_webhook failed'),
    );

    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'webhook_deprovision_failed',
      {
        provider: 'monday',
        error: 'Monday delete_webhook failed',
      },
      INTEGRATION_ID,
    );
    expect(fakes.deleteIntegration).toHaveBeenCalledWith(INTEGRATION_ID);
    expect(fakes.recordAudit).toHaveBeenCalledWith('disconnect', { provider: 'monday' }, null);
  });

  it('returns a JSON error when disconnect deletion fails', async () => {
    const error = new Error('database unavailable');
    fakes.deleteIntegration.mockRejectedValueOnce(error);

    const response = await POST(new Request('https://timeline.test'), params());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'disconnect_failed' });
    expect(fakes.loggerWarn).toHaveBeenCalledWith(
      { err: error, integrationId: INTEGRATION_ID, provider: 'monday' },
      'disconnect failed',
    );
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(error, {
      surface: 'api',
      operation: 'integration_disconnect',
      tags: { provider: 'monday' },
    });
    expect(fakes.recordAudit).toHaveBeenCalledWith(
      'disconnect_failed',
      {
        provider: 'monday',
        error: 'database unavailable',
      },
      INTEGRATION_ID,
    );
  });
});
