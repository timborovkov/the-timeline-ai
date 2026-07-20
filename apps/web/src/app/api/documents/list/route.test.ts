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
  fakeListDocumentsWithProvenancePage: vi.fn(),
  fakeIsPinnedMany: vi.fn(),
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
    documents: { listDocumentsWithProvenancePage: fakes.fakeListDocumentsWithProvenancePage },
    pins: { isPinnedMany: fakes.fakeIsPinnedMany },
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
  fakes.fakeIsPinnedMany.mockResolvedValue({});
  fakes.fakeListDocumentsWithProvenancePage.mockResolvedValue({
    items: [
      {
        id: 'doc-1',
        fileKind: 'document',
        name: 'Plan.pdf',
        metadata: {},
        visibility: 'team',
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        ownerUserId: USER_ID,
        currentVersion: {
          id: 'version-1',
          version: 1,
          byteSize: 1024,
          contentType: 'application/pdf',
          processingStatus: 'embedded',
          sourceEventId: '44444444-4444-4444-8444-444444444444',
          createdAt: new Date('2026-06-01T09:55:00.000Z'),
        },
        provenance: {
          source: 'telegram',
          sourceEventId: '44444444-4444-4444-8444-444444444444',
          parentEventId: '55555555-5555-4555-8555-555555555555',
          occurredAt: new Date('2026-06-01T09:54:00.000Z'),
          summary: 'Uploaded Plan.pdf from Telegram',
          metadata: {
            source: 'telegram',
            tg_file_id: 'upstream-file-id',
            parent_raw_event_id: '55555555-5555-4555-8555-555555555555',
          },
        },
        description: 'Extracted plan summary',
        presentation: {
          displayTitle: 'Plan.pdf',
          storedName: 'Plan.pdf',
          suggestedTitle: null,
          isGeneratedName: false,
          fallbackTitle: 'PDF attachment',
        },
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
    expect(fakes.fakeListDocumentsWithProvenancePage).not.toHaveBeenCalled();
  });

  it('propagates membership failures before listing documents', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('not member'));

    await expect(GET(request())).rejects.toThrow('not member');
    expect(fakes.fakeListDocumentsWithProvenancePage).not.toHaveBeenCalled();
  });

  it('forwards folder and cursor filters, caches by caller, and serializes dates', async () => {
    const response = await GET(request(`/api/documents/list?folder=${FOLDER_ID}&cursor=abc`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: 'doc-1',
          fileKind: 'document',
          name: 'Plan.pdf',
          metadata: {},
          visibility: 'team',
          updatedAt: '2026-06-01T10:00:00.000Z',
          ownerUserId: USER_ID,
          pinned: false,
          currentVersion: {
            id: 'version-1',
            version: 1,
            byteSize: 1024,
            contentType: 'application/pdf',
            processingStatus: 'embedded',
            sourceEventId: '44444444-4444-4444-8444-444444444444',
            createdAt: '2026-06-01T09:55:00.000Z',
          },
          provenance: {
            source: 'telegram',
            sourceEventId: '44444444-4444-4444-8444-444444444444',
            parentEventId: '55555555-5555-4555-8555-555555555555',
            occurredAt: '2026-06-01T09:54:00.000Z',
            summary: 'Uploaded Plan.pdf from Telegram',
          },
          description: 'Extracted plan summary',
          presentation: {
            displayTitle: 'Plan.pdf',
            storedName: 'Plan.pdf',
            suggestedTitle: null,
            isGeneratedName: false,
            fallbackTitle: 'PDF attachment',
          },
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
    expect(fakes.fakeListDocumentsWithProvenancePage).toHaveBeenCalledWith({
      folderId: FOLDER_ID,
      cursor: 'abc',
      limit: 30,
    });
  });

  it('treats malformed folder ids as the root folder', async () => {
    await GET(request('/api/documents/list?folder=not-a-uuid'));

    expect(fakes.fakeListDocumentsWithProvenancePage).toHaveBeenCalledWith({
      folderId: null,
      cursor: null,
      limit: 30,
    });
  });
});
