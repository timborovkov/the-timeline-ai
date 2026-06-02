import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for `/api/documents/list`. The documents scope owns
 * visibility and pagination semantics; this route owns auth, active-team
 * scoping, folder/cursor parsing, cache inputs, and response serialization.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeListDocumentsPage: vi.fn(),
  fakeCacheKey: vi.fn((parts: unknown[]) => `cache:${parts.map((p) => String(p)).join('|')}`),
  fakeCachedJson: vi.fn((_key: string, _ttl: number, load: () => unknown) => load()),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/cache', () => ({
  cacheKey: fakes.fakeCacheKey,
  cachedJson: fakes.fakeCachedJson,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    documents: { listDocumentsPage: fakes.fakeListDocumentsPage },
  }),
}));

const { GET } = await import('./route.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const FOLDER_ID = '33333333-3333-4333-8333-333333333333';

function request(path = '/api/documents/list'): Request {
  return new Request(`https://timeline.test${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
  });
  fakes.fakeRequireMembership.mockResolvedValue('member');
  fakes.fakeListDocumentsPage.mockResolvedValue({
    items: [
      {
        id: 'doc-1',
        name: 'Plan.pdf',
        visibility: 'team',
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        ownerUserId: USER_ID,
      },
    ],
    nextCursor: 'next-docs',
  });
});

describe('GET /api/documents/list', () => {
  it('rejects unauthenticated users and no-active-team requests', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    const unauthenticated = await GET(request());
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthenticated' });

    fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    const noTeam = await GET(request());
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_active_team' });
    expect(fakes.fakeListDocumentsPage).not.toHaveBeenCalled();
  });

  it('propagates membership failures before listing documents', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('not member'));

    await expect(GET(request())).rejects.toThrow('not member');
    expect(fakes.fakeListDocumentsPage).not.toHaveBeenCalled();
  });

  it('forwards folder and cursor filters, caches by caller, and serializes dates', async () => {
    const response = await GET(request(`/api/documents/list?folder=${FOLDER_ID}&cursor=abc`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: 'doc-1',
          name: 'Plan.pdf',
          visibility: 'team',
          updatedAt: '2026-06-01T10:00:00.000Z',
          ownerUserId: USER_ID,
        },
      ],
      nextCursor: 'next-docs',
    });
    expect(fakes.fakeCacheKey).toHaveBeenCalledWith([
      'document-list',
      TEAM_ID,
      USER_ID,
      FOLDER_ID,
      'abc',
    ]);
    expect(fakes.fakeListDocumentsPage).toHaveBeenCalledWith({
      folderId: FOLDER_ID,
      cursor: 'abc',
      limit: 30,
    });
  });

  it('treats malformed folder ids as the root folder', async () => {
    await GET(request('/api/documents/list?folder=not-a-uuid'));

    expect(fakes.fakeListDocumentsPage).toHaveBeenCalledWith({
      folderId: null,
      cursor: null,
      limit: 30,
    });
  });
});
