import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeListObjects: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: { listObjects: fakes.fakeListObjects },
  }),
}));

const { GET } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';

function request(path: string): Request {
  return new Request(`https://timeline.test${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
  });
  fakes.fakeListObjects.mockResolvedValue([
    {
      id: 'object-current',
      canonicalName: 'Current Object',
      type: 'project',
      aliases: [],
    },
    {
      id: 'object-acme',
      canonicalName: 'Acme Corporation',
      type: 'company',
      aliases: ['Acme Corp'],
    },
    {
      id: 'object-john',
      canonicalName: 'John Doe',
      type: 'person',
      aliases: ['JD'],
    },
  ]);
});

describe('GET /api/objects/search', () => {
  it('rejects unauthenticated users before resolving active team', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const response = await GET(request('/api/objects/search?q=acme'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
  });

  it('requires an active team before searching objects', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });

    const response = await GET(request('/api/objects/search?q=acme'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'no_active_team' });
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
  });

  it('searches active objects by name, alias, and type while excluding the current object', async () => {
    const response = await GET(
      request('/api/objects/search?q=acme%20company&exclude=object-current'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        {
          id: 'object-acme',
          canonicalName: 'Acme Corporation',
          type: 'company',
        },
      ],
    });
    expect(fakes.fakeResolveActiveTeam).toHaveBeenCalledWith(USER_ID);
    expect(fakes.fakeListObjects).toHaveBeenCalledWith({ archived: false, limit: 500 });
  });
});
