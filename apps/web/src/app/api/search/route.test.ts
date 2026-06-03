import { resetEnvForTests } from '@timeline/shared/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RateLimitModule from '@timeline/shared/rate-limit';

/**
 * Route-handler tests for `/api/search`. The shared search scope owns Qdrant
 * filtering and hydration; this route owns auth/config/rate gates, input
 * validation, active-team scoping, and HTTP status mapping.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeSearchEvents: vi.fn(),
  fakeCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    timeline: { searchEvents: fakes.fakeSearchEvents },
  }),
}));
vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return { ...actual, checkRateLimit: fakes.fakeCheckRateLimit };
});

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-2222-2222-222222222222';
const TEAM_ID = '11111111-1111-1111-1111-111111111111';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = 'test-secret-at-least-sixteen-characters';
  process.env.DATABASE_URL = 'postgres://placeholder@localhost:5432/placeholder';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.QDRANT_URL = 'https://qdrant.test';
  resetEnvForTests();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.fakeRequireMembership.mockResolvedValue('member');
  fakes.fakeSearchEvents.mockResolvedValue([{ id: 'event-1', score: 0.9 }]);
  fakes.fakeCheckRateLimit.mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 });
});

describe('POST /api/search', () => {
  it('rejects unauthenticated users before config, rate-limit, or scope work', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const response = await POST(request({ query: 'launch' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'unauthenticated' });
    expect(fakes.fakeCheckRateLimit).not.toHaveBeenCalled();
    expect(fakes.fakeSearchEvents).not.toHaveBeenCalled();
  });

  it('returns 503 when semantic search is not configured', async () => {
    delete process.env.QDRANT_URL;
    resetEnvForTests();

    const response = await POST(request({ query: 'launch' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'search_unconfigured' });
    expect(fakes.fakeCheckRateLimit).not.toHaveBeenCalled();
  });

  it('rate limits per signed-in user before parsing the JSON body', async () => {
    fakes.fakeCheckRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 2500 });

    const response = await POST(
      new Request('https://timeline.test/api/search', { method: 'POST', body: '{' }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'rate_limited' });
    expect(fakes.fakeSearchEvents).not.toHaveBeenCalled();
  });

  it('validates JSON and schema before resolving the active team', async () => {
    const badJson = await POST(
      new Request('https://timeline.test/api/search', { method: 'POST', body: '{' }),
    );
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toEqual({ ok: false, error: 'invalid_json' });

    const badSchema = await POST(request({ query: '', limit: 1000 }));
    expect(badSchema.status).toBe(400);
    const payload = (await badSchema.json()) as { ok: false; error: string };
    expect(payload.error).toBeTypeOf('string');

    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
  });

  it('forwards validated filters to the team-scoped search and returns count', async () => {
    const response = await POST(
      request({
        query: 'launch readiness',
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
        source: 'slack',
        entityIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        limit: 5,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      results: [{ id: 'event-1', score: 0.9 }],
      count: 1,
    });
    expect(fakes.fakeRequireMembership).toHaveBeenCalledOnce();
    expect(fakes.fakeSearchEvents).toHaveBeenCalledWith({
      query: 'launch readiness',
      from: new Date('2026-05-01T00:00:00.000Z'),
      to: new Date('2026-06-01T00:00:00.000Z'),
      source: 'slack',
      entityIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
      limit: 5,
    });
  });

  it('maps scoped search failures to a transient 502', async () => {
    fakes.fakeSearchEvents.mockRejectedValue(new Error('qdrant unavailable'));

    const response = await POST(request({ query: 'launch' }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'search_failed' });
  });
});
