import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Personal provider connection owners can browse live provider resources and
 * decide which sources are shared with the active team. These route tests cover
 * auth, owner-only access, provider validation, and the API contract used by the
 * source picker UI.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getProvider: vi.fn(),
  listSyncableResources: vi.fn(),
  getOwnedProviderConnection: vi.fn(),
  getProviderConnectionTokens: vi.fn(),
  listOwnedTeamResourceShares: vi.fn(),
  shareProviderResources: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/integrations', () => ({ getProvider: fakes.getProvider }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    integrations: {
      getOwnedProviderConnection: fakes.getOwnedProviderConnection,
      getProviderConnectionTokens: fakes.getProviderConnectionTokens,
      listOwnedTeamResourceShares: fakes.listOwnedTeamResourceShares,
      shareProviderResources: fakes.shareProviderResources,
    },
  }),
}));

const { GET, PUT } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';

const connection = {
  id: CONNECTION_ID,
  ownerUserId: USER_ID,
  provider: 'github',
  displayName: 'tim/github',
  externalAccountId: '42',
  scopes: ['repo'],
  lastError: null,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
};

function params() {
  return { params: Promise.resolve({ id: CONNECTION_ID }) };
}

function request(body: unknown): Request {
  return new Request(`https://timeline.test/api/connections/${CONNECTION_ID}/resources`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'member' } });
  fakes.getOwnedProviderConnection.mockResolvedValue(connection);
  fakes.getProviderConnectionTokens.mockResolvedValue({ accessToken: 'token' });
  fakes.getProvider.mockReturnValue({ listSyncableResources: fakes.listSyncableResources });
  fakes.listSyncableResources.mockResolvedValue([
    { kind: 'github.org', externalId: 'openai', label: 'OpenAI' },
    { kind: 'github.repo', externalId: 'openai/codex', label: 'openai/codex' },
  ]);
  fakes.listOwnedTeamResourceShares.mockResolvedValue([
    {
      connection,
      share: {
        id: '66666666-6666-4666-8666-666666666666',
        providerConnectionId: CONNECTION_ID,
        resourceKind: 'github.repo',
        resourceExternalId: 'openai/codex',
        resourceLabel: 'openai/codex',
        revokedAt: null,
      },
    },
    {
      connection: { ...connection, id: '77777777-7777-4777-8777-777777777777' },
      share: {
        id: '88888888-8888-4888-8888-888888888888',
        providerConnectionId: '77777777-7777-4777-8777-777777777777',
        resourceKind: 'github.repo',
        resourceExternalId: 'other/repo',
        resourceLabel: 'other/repo',
        revokedAt: null,
      },
    },
  ]);
  fakes.shareProviderResources.mockResolvedValue(undefined);
});

describe('/api/connections/[id]/resources', () => {
  it('guards authentication and owner-only connection access', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await GET(new Request('https://timeline.test'), params());
    expect(unauthenticated.status).toBe(401);

    fakes.getOwnedProviderConnection.mockResolvedValueOnce(null);
    const missing = await GET(new Request('https://timeline.test'), params());
    expect(missing.status).toBe(404);
  });

  it('lists live resources and only shares for the owned connection', async () => {
    const response = await GET(new Request('https://timeline.test'), params());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { resources: unknown[]; shares: unknown[] };
    expect(payload.resources).toEqual([
      { kind: 'github.org', externalId: 'openai', label: 'OpenAI' },
      { kind: 'github.repo', externalId: 'openai/codex', label: 'openai/codex' },
    ]);
    expect(payload.shares).toHaveLength(1);
    expect(payload.shares[0]).toMatchObject({
      resourceKind: 'github.repo',
      resourceExternalId: 'openai/codex',
    });
    expect(fakes.listSyncableResources).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONNECTION_ID,
        teamId: TEAM_ID,
        providerConnectionId: CONNECTION_ID,
      }),
      { accessToken: 'token' },
    );
  });

  it('validates selected resources before sharing them', async () => {
    const rejected = await PUT(
      request({
        resources: [{ kind: 'github.repo', externalId: 'missing/repo', label: 'Missing' }],
      }),
      params(),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: 'resource_not_in_scope' });
    expect(fakes.shareProviderResources).not.toHaveBeenCalled();

    const accepted = await PUT(
      request({
        resources: [{ kind: 'github.org', externalId: 'openai', label: 'OpenAI' }],
      }),
      params(),
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ ok: true });
    expect(fakes.shareProviderResources).toHaveBeenCalledWith(CONNECTION_ID, [
      { kind: 'github.org', externalId: 'openai', label: 'OpenAI' },
    ]);
  });
});
