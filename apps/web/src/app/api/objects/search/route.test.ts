import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeListObjects: vi.fn(),
  fakeSearchObjects: vi.fn(),
  fakeCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { search: { capacity: 30, refillPerSec: 0.5 } },
  checkRateLimit: fakes.fakeCheckRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(':'),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: {
      listObjects: fakes.fakeListObjects,
      searchObjects: fakes.fakeSearchObjects,
    },
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
  fakes.fakeCheckRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
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
  fakes.fakeSearchObjects.mockResolvedValue([
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
  ]);
});

describe('GET /api/objects/search', () => {
  it('rejects unauthenticated users before resolving active team', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const response = await GET(request('/api/objects/search?q=acme'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
    expect(fakes.fakeCheckRateLimit).not.toHaveBeenCalled();
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
    expect(fakes.fakeSearchObjects).not.toHaveBeenCalled();
  });

  it('rate limits before resolving the active team', async () => {
    fakes.fakeCheckRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 2500 });

    const response = await GET(request('/api/objects/search?q=acme'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
    expect(fakes.fakeSearchObjects).not.toHaveBeenCalled();
  });

  it('requires an active team before searching objects', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });

    const response = await GET(request('/api/objects/search?q=acme'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'no_active_team' });
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
    expect(fakes.fakeSearchObjects).not.toHaveBeenCalled();
  });

  it('uses indexed object search for non-empty queries while excluding the current object', async () => {
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
    expect(fakes.fakeSearchObjects).toHaveBeenCalledWith({
      query: 'acme company',
      archived: false,
      limit: 13,
    });
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
  });

  it('rejects overlong queries before hitting object search', async () => {
    const response = await GET(request(`/api/objects/search?q=${'a'.repeat(201)}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'query_too_long' });
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
    expect(fakes.fakeSearchObjects).not.toHaveBeenCalled();
  });

  it('lists recent active objects for an empty query', async () => {
    const response = await GET(request('/api/objects/search?q='));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        { id: 'object-current', canonicalName: 'Current Object', type: 'project' },
        { id: 'object-acme', canonicalName: 'Acme Corporation', type: 'company' },
        { id: 'object-john', canonicalName: 'John Doe', type: 'person' },
      ],
    });
    expect(fakes.fakeListObjects).toHaveBeenCalledWith({ archived: false, limit: 13 });
    expect(fakes.fakeSearchObjects).not.toHaveBeenCalled();
  });
});
