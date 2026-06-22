import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for `/api/timeline`. Shared timeline scope tests own
 * database visibility semantics; this route owns auth, active-team scoping,
 * query parsing, cache inputs, response shaping, author hydration, and audio
 * URL signing behavior.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeListEventsPage: vi.fn(),
  fakeGetEventsByIds: vi.fn(),
  fakeListImpactItems: vi.fn(),
  fakeCacheKey: vi.fn((parts: unknown[]) => `cache:${parts.map((p) => String(p)).join('|')}`),
  fakeCachedJson: vi.fn((_key: string, _ttl: number, load: () => unknown) => load()),
  fakeGetS3PresignClient: vi.fn(),
  fakeGetAudioBucket: vi.fn(),
  fakeGetSignedGetObjectUrl: vi.fn(),
  fakeListTimelineCapturedFilesByEventId: vi.fn(),
  fakeDbSelect: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: { select: fakes.fakeDbSelect } }));
vi.mock('@/lib/timeline-captured-files', () => ({
  listTimelineCapturedFilesByEventId: fakes.fakeListTimelineCapturedFilesByEventId,
}));
vi.mock('@timeline/shared/cache', () => ({
  cacheKey: fakes.fakeCacheKey,
  cachedJson: fakes.fakeCachedJson,
}));
vi.mock('@timeline/shared/s3', () => ({
  getAudioBucket: fakes.fakeGetAudioBucket,
  getS3PresignClient: fakes.fakeGetS3PresignClient,
  getSignedGetObjectUrl: fakes.fakeGetSignedGetObjectUrl,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    timeline: {
      listEventsPage: fakes.fakeListEventsPage,
      getEventsByIds: fakes.fakeGetEventsByIds,
      listImpactItems: fakes.fakeListImpactItems,
    },
  }),
}));

const { GET } = await import('./route.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const AUTHOR_ID = '33333333-3333-4333-8333-333333333333';

function request(path = '/api/timeline'): Request {
  return new Request(`https://timeline.test${path}`);
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    teamId: TEAM_ID,
    authorUserId: AUTHOR_ID,
    source: 'web',
    contentText: 'Launch note',
    contentAudioUrl: null,
    occurredAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: null,
    sourceMetadata: {},
    ...overrides,
  };
}

function mockAuthorRows(rows: unknown[]): void {
  fakes.fakeDbSelect.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
  });
  fakes.fakeRequireMembership.mockResolvedValue('member');
  fakes.fakeListEventsPage.mockResolvedValue({ items: [event()], nextCursor: 'next-page' });
  fakes.fakeGetEventsByIds.mockResolvedValue([]);
  fakes.fakeListImpactItems.mockResolvedValue({
    'event-1': [{ kind: 'task', label: 'Follow up' }],
  });
  fakes.fakeGetS3PresignClient.mockReturnValue({ s3: true });
  fakes.fakeGetAudioBucket.mockReturnValue('audio-bucket');
  fakes.fakeGetSignedGetObjectUrl.mockResolvedValue('https://signed-audio.test/event-1');
  fakes.fakeListTimelineCapturedFilesByEventId.mockResolvedValue({});
  mockAuthorRows([{ id: AUTHOR_ID, name: 'Ada', email: 'ada@example.test' }]);
});

describe('GET /api/timeline', () => {
  it('rejects unauthenticated users before active-team or scope work', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
    expect(fakes.fakeListEventsPage).not.toHaveBeenCalled();
  });

  it('returns no-active-team before constructing timeline scope', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });

    const response = await GET(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'no_active_team' });
    expect(fakes.fakeRequireMembership).not.toHaveBeenCalled();
  });

  it('propagates membership failures without fetching events', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('not member'));

    await expect(GET(request())).rejects.toThrow('not member');
    expect(fakes.fakeListEventsPage).not.toHaveBeenCalled();
  });

  it('forwards valid filters, serializes the page, hydrates authors, and signs audio URLs', async () => {
    fakes.fakeListEventsPage.mockResolvedValue({
      items: [event({ contentAudioUrl: 'audio/event-1.webm' })],
      nextCursor: null,
    });

    const response = await GET(
      request(
        `/api/timeline?author=${AUTHOR_ID}&cursor=abc&source=slack&impact=task&from=2026-06-01&to=2026-06-02`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'event-1',
          authorUserId: AUTHOR_ID,
          occurredAt: '2026-06-01T10:00:00.000Z',
        }),
      ],
      nextCursor: null,
      authors: { [AUTHOR_ID]: { id: AUTHOR_ID, name: 'Ada', email: 'ada@example.test' } },
      impactItems: { 'event-1': [{ kind: 'task', label: 'Follow up' }] },
      capturedFiles: {},
      audioUrls: { 'event-1': 'https://signed-audio.test/event-1' },
    });
    expect(fakes.fakeListEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUserId: AUTHOR_ID,
        from: new Date('2026-06-01'),
        to: new Date(new Date('2026-06-02').getTime() + 24 * 60 * 60 * 1000),
        source: ['slack'],
        cursor: 'abc',
      }),
    );
    const listEventsInput = fakes.fakeListEventsPage.mock.calls[0]?.[0] as
      | { limit?: unknown }
      | undefined;
    expect(typeof listEventsInput?.limit).toBe('number');
    expect(fakes.fakeCacheKey).toHaveBeenCalledWith(
      expect.arrayContaining([
        'timeline-page',
        TEAM_ID,
        USER_ID,
        AUTHOR_ID,
        'slack',
        'task',
        null,
        'abc',
      ]),
    );
    expect(fakes.fakeGetSignedGetObjectUrl).toHaveBeenCalledWith(
      { s3: true },
      'audio-bucket',
      'audio/event-1.webm',
      3600,
    );
  });

  it('ignores invalid author, source, impact, and dates', async () => {
    await GET(
      request('/api/timeline?author=bad&source=jira&impact=meeting&from=nope&to=also-nope'),
    );

    expect(fakes.fakeListEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUserId: undefined,
        from: undefined,
        to: undefined,
        source: undefined,
      }),
    );
    expect(fakes.fakeListImpactItems).toHaveBeenCalledWith(['event-1']);
  });

  it('expands grouped source filters before querying timeline events', async () => {
    await GET(request('/api/timeline?source=chat'));

    expect(fakes.fakeListEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ['telegram', 'slack'],
      }),
    );
  });

  it('omits audio URL when a single object signing call fails', async () => {
    fakes.fakeListEventsPage.mockResolvedValue({
      items: [event({ contentAudioUrl: 'audio/event-1.webm' })],
      nextCursor: null,
    });
    fakes.fakeGetSignedGetObjectUrl.mockRejectedValue(new Error('sign failed'));

    const response = await GET(request());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { audioUrls: Record<string, string> };
    expect(payload.audioUrls).toEqual({});
  });

  it('omits audio URLs when S3 signing is globally unavailable', async () => {
    fakes.fakeListEventsPage.mockResolvedValue({
      items: [event({ contentAudioUrl: 'audio/event-1.webm' })],
      nextCursor: null,
    });
    fakes.fakeGetS3PresignClient.mockImplementation(() => {
      throw new Error('missing s3 config');
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { audioUrls: Record<string, string> };
    expect(payload.audioUrls).toEqual({});
  });

  it('includes a focused event target even when it is outside the current page', async () => {
    const focusedId = '44444444-4444-4444-8444-444444444444';
    fakes.fakeListEventsPage.mockResolvedValue({
      items: [event({ id: 'event-1', contentText: 'Newest note' })],
      nextCursor: null,
    });
    fakes.fakeGetEventsByIds.mockResolvedValue([
      event({
        id: focusedId,
        contentText: 'Older evidence',
        occurredAt: new Date('2026-05-30T10:00:00.000Z'),
      }),
    ]);
    fakes.fakeListImpactItems.mockResolvedValue({});

    const response = await GET(request(`/api/timeline?event=${focusedId}`));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: { id: string; contentText: string | null }[];
    };
    expect(payload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: focusedId, contentText: 'Older evidence' }),
        expect.objectContaining({ id: 'event-1', contentText: 'Newest note' }),
      ]),
    );
    expect(fakes.fakeGetEventsByIds).toHaveBeenCalledWith([focusedId]);
  });

  it('does not re-inject the focused event on later cursor pages', async () => {
    const focusedId = '44444444-4444-4444-8444-444444444444';

    const response = await GET(request(`/api/timeline?cursor=next-page&event=${focusedId}`));

    expect(response.status).toBe(200);
    expect(fakes.fakeGetEventsByIds).not.toHaveBeenCalled();
  });
});
