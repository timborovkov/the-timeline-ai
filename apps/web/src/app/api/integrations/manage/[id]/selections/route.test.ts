import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  recordConnectionAttention: vi.fn(),
  resolveConnectionAttention: vi.fn(),
  getProvider: vi.fn(),
  adminReconcileIntegrationWebhookSubscriptions: vi.fn(),
  listSyncableResources: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/integrations', () => ({
  getProvider: fakes.getProvider,
  adminReconcileIntegrationWebhookSubscriptions:
    fakes.adminReconcileIntegrationWebhookSubscriptions,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    integrations: {
      getIntegration: fakes.getIntegration,
      getIntegrationTokens: fakes.getIntegrationTokens,
      listSelections: fakes.listSelections,
      setSelections: fakes.setSelections,
      recordAudit: fakes.recordAudit,
      recordConnectionAttention: fakes.recordConnectionAttention,
      resolveConnectionAttention: fakes.resolveConnectionAttention,
    },
  }),
}));

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
  fakes.recordConnectionAttention.mockResolvedValue(undefined);
  fakes.resolveConnectionAttention.mockResolvedValue(undefined);
  fakes.adminReconcileIntegrationWebhookSubscriptions.mockResolvedValue({
    active: 0,
    deprovisioned: 0,
    skipped: true,
  });
  fakes.getProvider.mockReturnValue({ listSyncableResources: fakes.listSyncableResources });
  fakes.listSyncableResources.mockResolvedValue([
    { kind: 'github.repo', externalId: 'acme/private' },
  ]);
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
      | Record<string, unknown>
      | undefined;
    expect(attentionInput).toMatchObject({
      providerConnectionId: null,
      integrationId: INTEGRATION_ID,
      category: 'webhook_degraded',
    });
    expect(attentionInput?.summary).toEqual(
      expect.stringContaining('Webhook provisioning failed for monday'),
    );
  });
});
