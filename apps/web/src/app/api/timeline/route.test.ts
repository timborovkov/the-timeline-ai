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
  fakeGetCalendarSettings: vi.fn(),
  fakeListEvents: vi.fn(),
  fakeListEventsForMomentLookup: vi.fn(),
  fakeListEventsPage: vi.fn(),
  fakeGetEventsByIds: vi.fn(),
  fakeListImpactItems: vi.fn(),
  fakeListArtifactClusters: vi.fn(),
  fakeListMomentPresentations: vi.fn(),
  fakeRequireRedisQueue: vi.fn(),
  fakeEnqueueTimelineMomentPresentationJob: vi.fn(),
  fakeCacheKey: vi.fn((parts: unknown[]) => `cache:${parts.map((p) => String(p)).join('|')}`),
  fakeCachedJson: vi.fn((_key: string, _ttl: number, load: () => unknown) => load()),
  fakeGetS3PresignClient: vi.fn(),
  fakeGetAudioBucket: vi.fn(),
  fakeGetSignedGetObjectUrl: vi.fn(),
  fakeListTimelineCapturedFilesByEventId: vi.fn(),
  fakeTrackTimelineMomentsViewed: vi.fn(),
  fakeDbSelect: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: { select: fakes.fakeDbSelect } }));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: fakes.fakeRequireRedisQueue }));
vi.mock('@/lib/timeline-captured-files', () => ({
  listTimelineCapturedFilesByEventId: fakes.fakeListTimelineCapturedFilesByEventId,
}));
vi.mock('@/lib/timeline-observability', () => ({
  trackTimelineMomentsViewed: fakes.fakeTrackTimelineMomentsViewed,
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
    calendar: {
      getCalendarSettings: fakes.fakeGetCalendarSettings,
    },
    timeline: {
      listEvents: fakes.fakeListEvents,
      listEventsForMomentLookup: fakes.fakeListEventsForMomentLookup,
      listEventsPage: fakes.fakeListEventsPage,
      getEventsByIds: fakes.fakeGetEventsByIds,
      listImpactItems: fakes.fakeListImpactItems,
      listArtifactClusters: fakes.fakeListArtifactClusters,
      listMomentPresentations: fakes.fakeListMomentPresentations,
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
  fakes.fakeGetCalendarSettings.mockResolvedValue({ defaultTimezone: 'Europe/Helsinki' });
  fakes.fakeListEvents.mockResolvedValue([]);
  fakes.fakeListEventsForMomentLookup.mockResolvedValue([]);
  fakes.fakeListEventsPage.mockResolvedValue({ items: [event()], nextCursor: 'next-page' });
  fakes.fakeGetEventsByIds.mockResolvedValue([]);
  fakes.fakeListImpactItems.mockResolvedValue({
    'event-1': [{ kind: 'task', label: 'Follow up' }],
  });
  fakes.fakeListArtifactClusters.mockResolvedValue({});
  fakes.fakeListMomentPresentations.mockResolvedValue({});
  fakes.fakeEnqueueTimelineMomentPresentationJob.mockResolvedValue({ enqueued: true });
  fakes.fakeRequireRedisQueue.mockResolvedValue({
    enqueueTimelineMomentPresentationJob: fakes.fakeEnqueueTimelineMomentPresentationJob,
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
    const body: unknown = await response.json();
    expect(body).toEqual({
      version: 'timeline_moments_page.v1',
      groupingVersion: 'timeline_grouping.v1',
      mode: 'moments',
      moments: [
        expect.objectContaining({
          version: 'timeline_moment.v1',
          title: 'Launch note',
          rawEventIds: ['event-1'],
        }),
      ],
      rawEventsById: {
        'event-1': {
          id: 'event-1',
          teamId: TEAM_ID,
          authorUserId: AUTHOR_ID,
          source: 'web',
          contentText: 'Launch note',
          contentAudioUrl: 'audio/event-1.webm',
          occurredAt: '2026-06-01T10:00:00.000Z',
          createdAt: '2026-06-01T10:00:00.000Z',
          visibility: 'team',
          visibilityUserIds: null,
          visibilityOwnerUserId: null,
          sourceMetadata: {},
        },
      },
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
      artifactClusters: {},
      capturedFiles: {},
      audioUrls: { 'event-1': 'https://signed-audio.test/event-1' },
    });
    expect(body).not.toHaveProperty('__timelineObservability');
    expect(fakes.fakeTrackTimelineMomentsViewed).toHaveBeenCalledOnce();
    expect(fakes.fakeTrackTimelineMomentsViewed.mock.calls[0]?.[0]).toMatchObject({
      teamId: TEAM_ID,
      userId: USER_ID,
      surface: 'api',
      filters: {
        author: AUTHOR_ID,
        source: 'slack',
        impact: 'task',
        cursor: 'abc',
      },
      diagnostics: {
        mode: 'moments',
        returnedRawEventCount: 1,
        returnedMomentCount: 1,
      },
      presentationCacheStats: {
        missCount: 1,
        visibilityPartitionCount: 1,
      },
    });
    expect(fakes.fakeListEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUserId: AUTHOR_ID,
        from: new Date('2026-05-31T21:00:00.000Z'),
        to: new Date('2026-06-02T21:00:00.000Z'),
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
        'Europe/Helsinki',
        'abc',
        false,
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
    expect(fakes.fakeListArtifactClusters).toHaveBeenCalledWith(['event-1']);
  });

  it('expands grouped source filters before querying timeline events', async () => {
    await GET(request('/api/timeline?source=chat'));

    expect(fakes.fakeListEventsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ['telegram', 'slack'],
      }),
    );
  });

  it('keeps source-event mode raw and cache-separated from moment mode', async () => {
    const response = await GET(request('/api/timeline?mode=events'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: 'timeline_moments_page.v1',
      groupingVersion: 'timeline_grouping.v1',
      mode: 'events',
      moments: [],
      rawEventsById: {},
    });
    expect(fakes.fakeListEventsPage).toHaveBeenCalledTimes(1);
    expect(fakes.fakeCacheKey).toHaveBeenCalledWith(
      expect.arrayContaining(['events', 'Europe/Helsinki', null, false]),
    );
  });

  it('returns moment diagnostics only when explicitly requested', async () => {
    fakes.fakeListEventsPage.mockResolvedValue({ items: [event()], nextCursor: null });
    const normal = await GET(request('/api/timeline'));
    await expect(normal.json()).resolves.not.toHaveProperty('diagnostics');

    const debug = await GET(request('/api/timeline?debug=moment_diagnostics'));

    expect(debug.status).toBe(200);
    await expect(debug.json()).resolves.toMatchObject({
      diagnostics: {
        mode: 'moments',
        scannedPageCount: 1,
        scannedRawEventCount: 1,
        returnedRawEventCount: 1,
        returnedMomentCount: 1,
        maxScanPagesReached: false,
        boundaryCursorAdjusted: false,
        providerMetadata: {
          total: 0,
          affectedEventCount: 0,
          byProvider: {},
          diagnostics: [],
        },
      },
    });
    expect(fakes.fakeCacheKey).toHaveBeenCalledWith(expect.arrayContaining([true]));
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

  it('hydrates visible deterministic siblings for a focused moment target', async () => {
    const focusedId = '44444444-4444-4444-8444-444444444444';
    const siblingId = '55555555-5555-4555-8555-555555555555';
    fakes.fakeListEventsPage.mockResolvedValue({
      items: [event({ id: 'event-1', contentText: 'Newest note' })],
      nextCursor: null,
    });
    fakes.fakeGetEventsByIds.mockResolvedValue([
      event({
        id: focusedId,
        source: 'email',
        contentText: 'Older evidence',
        occurredAt: new Date('2026-05-30T10:00:00.000Z'),
        sourceMetadata: { thread_root_id: 'thread-1' },
      }),
    ]);
    fakes.fakeListEvents.mockResolvedValue([
      event({
        id: focusedId,
        source: 'email',
        contentText: 'Older evidence',
        occurredAt: new Date('2026-05-30T10:00:00.000Z'),
        sourceMetadata: { thread_root_id: 'thread-1' },
      }),
      event({
        id: siblingId,
        source: 'email',
        contentText: 'Same email thread',
        occurredAt: new Date('2026-05-29T10:00:00.000Z'),
        sourceMetadata: { thread_root_id: 'thread-1' },
      }),
      event({
        id: '66666666-6666-4666-8666-666666666666',
        source: 'email',
        contentText: 'Different thread',
        occurredAt: new Date('2026-05-29T09:00:00.000Z'),
        sourceMetadata: { thread_root_id: 'thread-2' },
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
        expect.objectContaining({ id: siblingId, contentText: 'Same email thread' }),
        expect.objectContaining({ id: 'event-1', contentText: 'Newest note' }),
      ]),
    );
    expect(payload.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '66666666-6666-4666-8666-666666666666' }),
      ]),
    );
    expect(fakes.fakeListEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'email',
        limit: 100,
      }),
    );
  });

  it('hydrates a focused moment id through bounded visible-event lookup', async () => {
    const focusMomentId = 'moment:telegram:chat-a:2026-06-27:18:00';
    fakes.fakeListEventsPage.mockResolvedValue({
      items: [event({ id: 'event-1', contentText: 'Newest note' })],
      nextCursor: null,
    });
    fakes.fakeListEventsForMomentLookup.mockResolvedValue([
      event({
        id: 'message-a',
        source: 'telegram',
        contentText: 'First focused message',
        occurredAt: new Date('2026-06-27T15:08:00.000Z'),
        sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Tim' },
      }),
      event({
        id: 'message-b',
        source: 'telegram',
        contentText: 'Second focused message',
        occurredAt: new Date('2026-06-27T15:03:00.000Z'),
        sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Mikael' },
      }),
      event({
        id: 'message-other-bucket',
        source: 'telegram',
        contentText: 'Different bucket',
        occurredAt: new Date('2026-06-27T15:30:00.000Z'),
        sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Otto' },
      }),
    ]);
    fakes.fakeListImpactItems.mockResolvedValue({});

    const response = await GET(
      request(`/api/timeline?moment=${encodeURIComponent(focusMomentId)}`),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: { id: string; contentText: string | null }[];
      moments: { id: string; rawEventIds: string[] }[];
    };
    expect(payload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'message-a' }),
        expect.objectContaining({ id: 'message-b' }),
        expect.objectContaining({ id: 'event-1' }),
      ]),
    );
    expect(payload.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'message-other-bucket' })]),
    );
    expect(payload.moments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: focusMomentId, rawEventIds: ['message-a', 'message-b'] }),
      ]),
    );
    expect(fakes.fakeListEventsForMomentLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'telegram',
        from: new Date('2026-06-27T12:00:00.000Z'),
        to: new Date('2026-06-29T00:00:00.000Z'),
        limit: 300,
      }),
    );
    expect(fakes.fakeCacheKey).toHaveBeenCalledWith(expect.arrayContaining([focusMomentId]));
  });

  it('does not re-inject the focused event on later cursor pages', async () => {
    const focusedId = '44444444-4444-4444-8444-444444444444';

    const response = await GET(request(`/api/timeline?cursor=next-page&event=${focusedId}`));

    expect(response.status).toBe(200);
    expect(fakes.fakeGetEventsByIds).not.toHaveBeenCalled();
  });

  it('does not re-inject a focused moment id on later cursor pages', async () => {
    const focusMomentId = 'moment:telegram:chat-a:2026-06-27:18:00';

    const response = await GET(
      request(`/api/timeline?cursor=next-page&moment=${encodeURIComponent(focusMomentId)}`),
    );

    expect(response.status).toBe(200);
    expect(fakes.fakeListEventsForMomentLookup).not.toHaveBeenCalled();
  });
});
