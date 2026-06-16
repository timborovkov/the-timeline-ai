import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for global search's federated product boundary.
 *
 * Callers should get useful, team-scoped results even when one source is
 * unavailable, and filters must not leak private calendar text or bypass
 * source/date constraints.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeSearchEvents: vi.fn(),
  fakeSearchDocumentChunksPage: vi.fn(),
  fakeSearchObjectNotes: vi.fn(),
  fakeSearchObjects: vi.fn(),
  fakeListReadyObjectSummaries: vi.fn(),
  fakeListObjects: vi.fn(),
  fakeListBoards: vi.fn(),
  fakeListCalendarEvents: vi.fn(),
  fakeCheckRateLimit: vi.fn(),
  fakeGetEnv: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/env', () => ({ getEnv: fakes.fakeGetEnv }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    timeline: {
      searchEvents: fakes.fakeSearchEvents,
      searchObjectNotes: fakes.fakeSearchObjectNotes,
    },
    documents: { searchDocumentChunksPage: fakes.fakeSearchDocumentChunksPage },
    objects: {
      listObjects: fakes.fakeListObjects,
      searchObjects: fakes.fakeSearchObjects,
      listReadyObjectSummaries: fakes.fakeListReadyObjectSummaries,
    },
    boards: { listBoards: fakes.fakeListBoards },
    calendar: { listCalendarEvents: fakes.fakeListCalendarEvents },
  }),
}));
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { search: { capacity: 30, refillPerSec: 0.5 } },
  rateLimitKey: (...parts: string[]) => parts.join(':'),
  checkRateLimit: fakes.fakeCheckRateLimit,
}));

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-2222-2222-222222222222';
const TEAM_ID = '11111111-1111-1111-1111-111111111111';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/search/global', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string): Request {
  return new Request('https://timeline.test/api/search/global', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = 'test-secret-at-least-sixteen-characters';
  process.env.DATABASE_URL = 'postgres://placeholder@localhost:5432/placeholder';
  fakes.fakeGetEnv.mockReturnValue({
    OPENROUTER_API_KEY: 'test-openrouter',
    QDRANT_URL: 'https://qdrant.test',
  });
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.fakeRequireMembership.mockResolvedValue('admin');
  fakes.fakeCheckRateLimit.mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  fakes.fakeSearchEvents.mockResolvedValue([
    {
      eventId: 'event-1',
      factIds: [],
      score: 0.7,
      occurredAt: '2026-06-01T00:00:00.000Z',
      source: 'slack',
      authorUserId: null,
      sender: null,
      resolvedSenderObject: null,
      senderResolutionStatus: 'unresolved',
      entityIds: [],
      snippet: 'GitHub came up in a meeting.',
    },
  ]);
  fakes.fakeSearchDocumentChunksPage.mockResolvedValue({
    items: [
      {
        documentId: 'doc-1',
        documentVersionId: 'version-1',
        documentChunkId: 'chunk-1',
        fileKind: 'document',
        representationKind: 'body_text',
        version: 1,
        chunkIndex: 0,
        pageNumber: null,
        text: 'Document text',
        summary: 'Document summary',
        documentName: 'Launch docs',
        folderId: null,
        sourceRawEventId: null,
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
        score: 0.8,
      },
    ],
    nextOffset: null,
  });
  fakes.fakeSearchObjectNotes.mockResolvedValue([]);
  fakes.fakeListReadyObjectSummaries.mockResolvedValue([]);
  fakes.fakeSearchObjects.mockResolvedValue([
    {
      id: 'object-1',
      type: 'person',
      canonicalName: 'Otto Silventola',
      status: 'open',
      stage: null,
      priority: null,
      ownerUserId: null,
      assigneeUserId: null,
      dueAt: null,
      agentSuggested: false,
      archivedAt: null,
      aliases: ['Otto'],
      metadata: {},
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  ]);
  fakes.fakeListBoards.mockResolvedValue([
    {
      id: 'board-1',
      name: 'Launch Board',
      slug: 'launch',
      purpose: 'Coordinate launch tasks',
      templateKind: 'project',
      recommendedObjectTypes: ['task'],
      filters: {},
      itemCount: 3,
      laneCounts: [],
      dueSoonCount: 0,
      overdueCount: 0,
      pinned: true,
      updatedAt: new Date('2026-06-11T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  ]);
  fakes.fakeListCalendarEvents.mockResolvedValue([
    {
      id: 'calendar-1',
      title: 'Launch planning',
      description: 'Discuss rollout',
      location: 'Room 4',
      source: 'google',
      timezone: 'Europe/Helsinki',
      showAs: 'busy',
      redacted: false,
      allDay: false,
      startAt: new Date('2026-06-20T10:00:00.000Z'),
      endAt: new Date('2026-06-20T11:00:00.000Z'),
      updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    },
  ]);
});

describe('POST /api/search/global', () => {
  it('rejects unauthenticated users', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const response = await POST(request({ query: 'github' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'unauthenticated' });
    expect(fakes.fakeCheckRateLimit).not.toHaveBeenCalled();
  });

  it('rate limits before parsing JSON or resolving team scope', async () => {
    fakes.fakeCheckRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 2500 });

    const response = await POST(rawRequest('{'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'rate_limited' });
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
  });

  it('returns no_active_team before constructing a scoped search', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });

    const response = await POST(request({ query: 'launch' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'no_active_team' });
    expect(fakes.fakeRequireMembership).not.toHaveBeenCalled();
  });

  it('returns preview results and ranks navigation intent', async () => {
    const response = await POST(request({ query: 'github', mode: 'preview' }));
    const data = (await response.json()) as { ok: true; results: { id: string }[] };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0]?.id).toBe('github-integration');
    expect(fakes.fakeSearchEvents).toHaveBeenCalled();
    expect(fakes.fakeSearchDocumentChunksPage).toHaveBeenCalled();
  });

  it('does not run semantic search for short preview queries', async () => {
    const response = await POST(request({ query: 'gi', mode: 'preview' }));
    const data = (await response.json()) as { ok: true; warnings: unknown[] };

    expect(response.status).toBe(200);
    expect(data.warnings).toEqual([]);
    expect(fakes.fakeSearchEvents).not.toHaveBeenCalled();
    expect(fakes.fakeSearchDocumentChunksPage).not.toHaveBeenCalled();
  });

  it('skips semantic sources when Qdrant is unconfigured but keeps lexical results', async () => {
    fakes.fakeGetEnv.mockReturnValue({ OPENROUTER_API_KEY: 'test-openrouter', QDRANT_URL: '' });

    const response = await POST(request({ query: 'Otto', mode: 'full' }));
    const data = (await response.json()) as {
      ok: true;
      results: { kind: string; title: string }[];
      warnings: { source: string }[];
    };

    expect(response.status).toBe(200);
    expect(
      data.results.some((item) => item.kind === 'object' && item.title === 'Otto Silventola'),
    ).toBe(true);
    expect(data.warnings).toContainEqual({
      source: 'semantic',
      message: 'Semantic search is not configured.',
    });
    expect(fakes.fakeSearchEvents).not.toHaveBeenCalled();
    expect(fakes.fakeSearchDocumentChunksPage).not.toHaveBeenCalled();
  });

  it('honors kind filters', async () => {
    fakes.fakeSearchObjectNotes.mockResolvedValue([
      {
        noteId: 'note-hidden',
        objectId: 'object-hidden',
        objectName: 'Hidden object note',
        objectType: 'person',
        body: 'This object note should not appear in document-only search.',
        score: 0.99,
        updatedAt: '2026-06-12T00:00:00.000Z',
      },
    ]);

    const response = await POST(
      request({ query: 'docs', mode: 'full', kinds: ['document_chunk'] }),
    );
    const data = (await response.json()) as { ok: true; results: { kind: string }[] };

    expect(response.status).toBe(200);
    expect(data.results.every((item) => item.kind === 'document_chunk')).toBe(true);
    expect(fakes.fakeSearchObjects).not.toHaveBeenCalled();
    expect(fakes.fakeListBoards).not.toHaveBeenCalled();
    expect(fakes.fakeSearchObjectNotes).not.toHaveBeenCalled();
  });

  it('uses scoped lexical object search instead of a recent object window', async () => {
    const response = await POST(request({ query: 'Otto', mode: 'full' }));

    expect(response.status).toBe(200);
    expect(fakes.fakeSearchObjects).toHaveBeenCalledWith({
      query: 'Otto',
      archived: false,
      limit: 300,
    });
    expect(fakes.fakeListObjects).not.toHaveBeenCalled();
  });

  it('uses ready object summaries for object search snippets and lexical matching', async () => {
    fakes.fakeListReadyObjectSummaries.mockResolvedValue([
      {
        entityId: 'object-1',
        plainText: 'DFK has a confirmed pilot discussion on June 30.',
        generatedAt: new Date('2026-06-15T00:00:00.000Z'),
      },
    ]);

    const response = await POST(request({ query: 'June 30', mode: 'full', kinds: ['object'] }));
    const data = (await response.json()) as {
      ok: true;
      results: { kind: string; title: string; snippet: string; metadata?: { summary?: boolean } }[];
    };

    expect(response.status).toBe(200);
    expect(fakes.fakeListReadyObjectSummaries).toHaveBeenCalledWith(['object-1']);
    const result = data.results.find((item) => item.kind === 'object');
    expect(result?.title).toBe('Otto Silventola');
    expect(result?.snippet).toBe('DFK has a confirmed pilot discussion on June 30.');
    expect(result?.metadata?.summary).toBe(true);
  });

  it('forwards timeline source and date filters to semantic timeline, document, and calendar search', async () => {
    const response = await POST(
      request({
        query: 'launch',
        mode: 'full',
        source: 'slack',
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-30T23:59:59.000Z',
      }),
    );

    expect(response.status).toBe(200);
    expect(fakes.fakeSearchEvents).toHaveBeenCalledWith({
      query: 'launch',
      limit: 10,
      source: 'slack',
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.000Z'),
    });
    expect(fakes.fakeListCalendarEvents).toHaveBeenCalledWith({
      limit: 240,
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.000Z'),
    });
    expect(fakes.fakeSearchDocumentChunksPage).toHaveBeenCalledWith({
      query: 'launch',
      limit: 10,
      maxOffset: 80,
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.000Z'),
    });
  });

  it('returns partial results and warnings when a lexical source fails', async () => {
    fakes.fakeSearchObjects.mockRejectedValue(new Error('postgres unavailable'));

    const response = await POST(request({ query: 'github', mode: 'full' }));
    const data = (await response.json()) as {
      ok: true;
      results: { id: string }[];
      warnings: { source: string; message: string }[];
    };

    expect(response.status).toBe(200);
    expect(data.results[0]?.id).toBe('github-integration');
    expect(data.warnings).toContainEqual({
      source: 'object',
      message: 'Object search is temporarily unavailable.',
    });
  });

  it('merges full-mode object note evidence into object ranking', async () => {
    fakes.fakeSearchObjectNotes.mockResolvedValue([
      {
        noteId: 'note-1',
        objectId: 'object-1',
        objectName: 'Otto Silventola',
        objectType: 'person',
        body: 'Otto mentioned the GitHub integration migration.',
        score: 0.95,
        updatedAt: '2026-06-12T00:00:00.000Z',
      },
    ]);

    const response = await POST(request({ query: 'Otto GitHub', mode: 'full' }));
    const data = (await response.json()) as {
      ok: true;
      results: { kind: string; title: string; score: number; scoreParts: { semantic?: number } }[];
    };

    expect(response.status).toBe(200);
    const object = data.results.find(
      (item) => item.kind === 'object' && item.title === 'Otto Silventola',
    );
    expect(object?.scoreParts.semantic).toBe(0.95);
    expect(object?.score).toBeGreaterThan(1);
  });

  it('classifies follow-up object-note hits as task results', async () => {
    fakes.fakeSearchObjects.mockResolvedValue([]);
    fakes.fakeSearchObjectNotes.mockResolvedValue([
      {
        noteId: 'note-follow-up',
        objectId: 'follow-up-1',
        objectName: 'Send launch recap',
        objectType: 'follow_up',
        body: 'Follow up with the launch recap after the GitHub rollout.',
        score: 0.91,
        updatedAt: '2026-06-12T00:00:00.000Z',
      },
    ]);

    const response = await POST(request({ query: 'launch recap', mode: 'full', kinds: ['task'] }));
    const data = (await response.json()) as {
      ok: true;
      results: { kind: string; title: string; metadata?: { type?: string } }[];
    };

    expect(response.status).toBe(200);
    const followUp = data.results.find((item) => item.title === 'Send launch recap');
    expect(followUp?.kind).toBe('task');
    expect(followUp?.metadata?.type).toBe('follow_up');
  });

  it('does not match or leak redacted calendar title, description, or location text', async () => {
    fakes.fakeListCalendarEvents.mockResolvedValue([
      {
        id: 'private-calendar',
        title: 'Secret acquisition meeting',
        description: 'Discuss hidden buyer',
        location: 'Private room',
        source: 'google',
        timezone: 'Europe/Helsinki',
        showAs: 'busy',
        redacted: true,
        allDay: false,
        startAt: new Date('2026-06-20T10:00:00.000Z'),
        endAt: new Date('2026-06-20T11:00:00.000Z'),
        updatedAt: new Date('2026-06-12T00:00:00.000Z'),
      },
    ]);

    const response = await POST(
      request({
        query: 'secret acquisition private room',
        mode: 'full',
        kinds: ['calendar_event'],
      }),
    );
    const data = (await response.json()) as { ok: true; results: unknown[] };

    expect(response.status).toBe(200);
    expect(data.results).toEqual([]);
  });

  it('validates input before resolving the active team', async () => {
    const response = await POST(request({ query: 'x', mode: 'nope' }));

    expect(response.status).toBe(400);
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
  });
});
