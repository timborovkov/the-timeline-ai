import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for `/api/documents/search`. Shared document search owns
 * Qdrant and hydration semantics; this route owns auth/config/rate gates,
 * request validation, active-team scoping, cache inputs, defaults, and HTTP
 * status/header behavior.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeGetEnv: vi.fn(),
  fakeCheckRateLimit: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeSearchDocumentChunksPage: vi.fn(),
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
vi.mock('@timeline/shared/env', () => ({ getEnv: fakes.fakeGetEnv }));
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { search: { limit: 10, windowMs: 60_000 } },
  checkRateLimit: fakes.fakeCheckRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(':'),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    documents: { searchDocumentChunksPage: fakes.fakeSearchDocumentChunksPage },
  }),
}));

const { POST } = await import('./route.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';
const FOLDER_ID = '44444444-4444-4444-8444-444444444444';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/documents/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
  });
  fakes.fakeGetEnv.mockReturnValue({
    OPENROUTER_API_KEY: 'test-openrouter',
    QDRANT_URL: 'https://qdrant.test',
  });
  fakes.fakeCheckRateLimit.mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  fakes.fakeRequireMembership.mockResolvedValue('member');
  fakes.fakeSearchDocumentChunksPage.mockResolvedValue({
    items: [{ documentId: DOC_ID, chunkId: 'chunk-1', score: 0.9 }],
    nextOffset: 12,
  });
});

describe('POST /api/documents/search', () => {
  it('rejects unauthenticated users before config and rate-limit checks', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const response = await POST(request({ query: 'roadmap' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(fakes.fakeGetEnv).not.toHaveBeenCalled();
    expect(fakes.fakeCheckRateLimit).not.toHaveBeenCalled();
  });

  it('returns 503 when semantic document search is not configured', async () => {
    fakes.fakeGetEnv.mockReturnValue({ OPENROUTER_API_KEY: '', QDRANT_URL: 'https://qdrant.test' });

    const response = await POST(request({ query: 'roadmap' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'search_unconfigured' });
    expect(fakes.fakeCheckRateLimit).not.toHaveBeenCalled();
  });

  it('rate limits per signed-in user before parsing JSON', async () => {
    fakes.fakeCheckRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 2500 });

    const response = await POST(
      new Request('https://timeline.test/api/documents/search', { method: 'POST', body: '{' }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
  });

  it('validates malformed JSON and schema before resolving the active team', async () => {
    const badJson = await POST(
      new Request('https://timeline.test/api/documents/search', { method: 'POST', body: '{' }),
    );
    expect(badJson.status).toBe(400);

    const badSchema = await POST(request({ query: '', limit: 31 }));
    expect(badSchema.status).toBe(400);
    const payload = (await badSchema.json()) as { error: string };
    expect(payload.error).toBeTypeOf('string');

    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
  });

  it('rejects offsets beyond the bounded semantic search window', async () => {
    const response = await POST(request({ query: 'roadmap', limit: 12, offset: 501 }));

    expect(response.status).toBe(400);
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
    expect(fakes.fakeSearchDocumentChunksPage).not.toHaveBeenCalled();
  });

  it('returns no-active-team and propagates membership failures before searching', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    const noTeam = await POST(request({ query: 'roadmap' }));
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_active_team' });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValue(new Error('not member'));
    await expect(POST(request({ query: 'roadmap' }))).rejects.toThrow('not member');
    expect(fakes.fakeSearchDocumentChunksPage).not.toHaveBeenCalled();
  });

  it('applies defaults, builds cache key, and forwards validated search input', async () => {
    const response = await POST(
      request({
        query: 'roadmap',
        documentId: DOC_ID,
        folderIds: [FOLDER_ID],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ documentId: DOC_ID, chunkId: 'chunk-1', score: 0.9 }],
      nextOffset: 12,
    });
    expect(fakes.fakeCacheKey).toHaveBeenCalledWith([
      'document-search',
      TEAM_ID,
      USER_ID,
      'roadmap',
      DOC_ID,
      FOLDER_ID,
      0,
      12,
    ]);
    expect(fakes.fakeSearchDocumentChunksPage).toHaveBeenCalledWith({
      query: 'roadmap',
      documentId: DOC_ID,
      folderIds: [FOLDER_ID],
      offset: 0,
      limit: 12,
      maxOffset: 500,
    });
  });

  it('honors explicit offset and limit within bounds', async () => {
    await POST(request({ query: 'roadmap', offset: 24, limit: 5 }));

    expect(fakes.fakeSearchDocumentChunksPage).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 24, limit: 5, maxOffset: 500 }),
    );
  });
});
