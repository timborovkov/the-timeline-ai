import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getObjectSectionPage: vi.fn(),
  cacheInputs: [] as unknown[],
}));

vi.mock('@timeline/shared/cache', () => ({
  cacheKey: (parts: unknown[]) => {
    fakes.cacheInputs.push(parts);
    return parts.join(':');
  },
  cachedJson: async (_key: string, _ttl: number, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    objects: { getObjectSectionPage: fakes.getObjectSectionPage },
  }),
}));

const { GET } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.cacheInputs = [];
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('member');
  fakes.getObjectSectionPage.mockResolvedValue({
    items: [{ id: 'item-1', createdAt: new Date('2026-06-01T10:00:00.000Z') }],
    nextCursor: 'cursor-2',
  });
});

describe('/api/objects/[id]/sections', () => {
  it('guards auth and active team before scoped lookup', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    expect(
      (
        await GET(
          new Request(`https://timeline.test/api/objects/${OBJECT_ID}/sections?section=events`),
          {
            params: Promise.resolve({ id: OBJECT_ID }),
          },
        )
      ).status,
    ).toBe(401);

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    expect(
      (
        await GET(
          new Request(`https://timeline.test/api/objects/${OBJECT_ID}/sections?section=events`),
          {
            params: Promise.resolve({ id: OBJECT_ID }),
          },
        )
      ).status,
    ).toBe(400);
  });

  it('validates object id and section names', async () => {
    expect(
      (
        await GET(
          new Request('https://timeline.test/api/objects/not-a-uuid/sections?section=events'),
          {
            params: Promise.resolve({ id: 'not-a-uuid' }),
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await GET(
          new Request(`https://timeline.test/api/objects/${OBJECT_ID}/sections?section=bad`),
          {
            params: Promise.resolve({ id: OBJECT_ID }),
          },
        )
      ).status,
    ).toBe(400);
    expect(fakes.getObjectSectionPage).not.toHaveBeenCalled();
  });

  it('returns serialized section pages and includes cursor in the cache key', async () => {
    const response = await GET(
      new Request(
        `https://timeline.test/api/objects/${OBJECT_ID}/sections?section=facts&cursor=c1`,
      ),
      { params: Promise.resolve({ id: OBJECT_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'item-1', createdAt: '2026-06-01T10:00:00.000Z' }],
      nextCursor: 'cursor-2',
    });
    expect(fakes.getObjectSectionPage).toHaveBeenCalledWith(OBJECT_ID, 'facts', {
      cursor: 'c1',
      limit: 20,
    });
    expect(fakes.cacheInputs[0]).toEqual([
      'object-section',
      TEAM_ID,
      USER_ID,
      OBJECT_ID,
      'facts',
      'c1',
    ]);
  });

  it('returns not_found when the scoped object section is missing', async () => {
    fakes.getObjectSectionPage.mockResolvedValueOnce(null);

    const response = await GET(
      new Request(`https://timeline.test/api/objects/${OBJECT_ID}/sections?section=events`),
      { params: Promise.resolve({ id: OBJECT_ID }) },
    );

    expect(response.status).toBe(404);
  });
});
