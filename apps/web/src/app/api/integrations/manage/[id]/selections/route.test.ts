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
  getProvider: vi.fn(),
  listSyncableResources: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/integrations', () => ({ getProvider: fakes.getProvider }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    integrations: {
      getIntegration: fakes.getIntegration,
      getIntegrationTokens: fakes.getIntegrationTokens,
      listSelections: fakes.listSelections,
      setSelections: fakes.setSelections,
      recordAudit: fakes.recordAudit,
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
});
