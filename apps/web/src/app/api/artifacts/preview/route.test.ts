import { beforeEach, describe, expect, it, vi } from 'vitest';

const IDS = {
  team: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  event: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  object: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  task: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  note: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  document: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  version: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  chunk: '12121212-1212-4121-8121-121212121212',
  calendar: '34343434-3434-4343-8343-343434343434',
  board: '56565656-5656-4565-8565-565656565656',
  boardItem: '78787878-7878-4787-8787-787878787878',
  lane: '90909090-9090-4909-8909-909090909090',
};

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getEventsByIds: vi.fn(),
  getObject: vi.fn(),
  getObjectNotePreview: vi.fn(),
  getDocument: vi.fn(),
  getDocumentChunk: vi.fn(),
  listDocumentVersions: vi.fn(),
  getCalendarEvent: vi.fn(),
  getBoard: vi.fn(),
  getBoardItem: vi.fn(),
  getS3PresignClient: vi.fn(),
  getAudioBucket: vi.fn(),
  getSignedGetObjectUrl: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/s3', () => ({
  getAudioBucket: fakes.getAudioBucket,
  getS3PresignClient: fakes.getS3PresignClient,
  getSignedGetObjectUrl: fakes.getSignedGetObjectUrl,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    timeline: { getEventsByIds: fakes.getEventsByIds },
    objects: {
      getObject: fakes.getObject,
      getObjectNotePreview: fakes.getObjectNotePreview,
    },
    documents: {
      getDocument: fakes.getDocument,
      getDocumentChunk: fakes.getDocumentChunk,
      listDocumentVersions: fakes.listDocumentVersions,
    },
    calendar: { getCalendarEvent: fakes.getCalendarEvent },
    boards: {
      getBoard: fakes.getBoard,
      getBoardItem: fakes.getBoardItem,
    },
  }),
}));

const { POST } = await import('./route.js');

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/artifacts/preview', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

function object(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.object,
    type: 'person',
    canonicalName: 'Otto Silventola',
    status: 'active',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: false,
    archivedAt: null,
    aliases: ['Otto'],
    metadata: {},
    updatedAt: new Date('2026-06-14T10:00:00.000Z'),
    createdAt: new Date('2026-06-14T09:00:00.000Z'),
    notes: [],
    relationships: [],
    recentChanges: [],
    identityFacets: [],
    openTasks: [],
    newSinceLastVisit: 0,
    lastVisitedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: IDS.user } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: IDS.team } });
  fakes.getS3PresignClient.mockReturnValue({});
  fakes.getAudioBucket.mockReturnValue('audio');
  fakes.getSignedGetObjectUrl.mockResolvedValue('https://signed-audio.test/file.mp3');
  fakes.getEventsByIds.mockResolvedValue([
    {
      id: IDS.event,
      source: 'telegram',
      contentText: 'Otto mentioned the pilot.',
      contentAudioUrl: 'team/event.mp3',
      occurredAt: new Date('2026-06-14T12:00:00.000Z'),
      visibility: 'team',
    },
  ]);
  fakes.getObject.mockResolvedValue(object());
  fakes.getObjectNotePreview.mockResolvedValue({
    id: IDS.note,
    body: 'Otto owns the pilot follow-up.',
    authorUserId: IDS.user,
    createdAt: new Date('2026-06-14T12:00:00.000Z'),
    updatedAt: new Date('2026-06-14T12:30:00.000Z'),
    object: object(),
  });
  fakes.getDocument.mockResolvedValue({
    id: IDS.document,
    fileKind: 'document',
    name: 'Pilot Notes',
    folderId: null,
    currentVersionId: IDS.version,
    ownerUserId: IDS.user,
    visibility: 'team',
    visibilityUserIds: null,
    metadata: {},
    createdAt: new Date('2026-06-14T09:00:00.000Z'),
    updatedAt: new Date('2026-06-14T10:00:00.000Z'),
  });
  fakes.listDocumentVersions.mockResolvedValue([{ id: IDS.version, version: 2 }]);
  fakes.getDocumentChunk.mockResolvedValue({
    id: IDS.chunk,
    documentId: IDS.document,
    documentVersionId: IDS.version,
    chunkIndex: 0,
    representationKind: 'source_text',
    text: 'The pilot starts next week.',
    tokenCount: 12,
    pageNumber: 1,
    summary: 'Pilot timing',
    createdAt: new Date('2026-06-14T10:00:00.000Z'),
  });
  fakes.getCalendarEvent.mockResolvedValue({
    id: IDS.calendar,
    title: 'Pilot sync',
    description: 'Talk through launch blockers.',
    startAt: new Date('2026-06-15T09:00:00.000Z'),
    endAt: new Date('2026-06-15T09:30:00.000Z'),
    timezone: 'Europe/Helsinki',
    allDay: false,
    location: 'Meet',
    showAs: 'busy',
    visibility: 'team',
    rrule: null,
    redacted: false,
  });
  fakes.getBoard.mockResolvedValue({
    id: IDS.board,
    name: 'Pilot Board',
    purpose: 'Track pilot work.',
    templateKind: 'task_board',
    itemCount: 1,
    pinned: false,
    isShared: true,
    lanes: [{ id: IDS.lane, name: 'Doing', kind: 'active' }],
    items: [{ object: object({ type: 'task', canonicalName: 'Call Otto' }) }],
  });
  fakes.getBoardItem.mockResolvedValue({
    id: IDS.boardItem,
    boardId: IDS.board,
    entityId: IDS.task,
    laneId: IDS.lane,
    position: 1,
    responsibleUserId: IDS.user,
    dueAt: new Date('2026-06-16T12:00:00.000Z'),
    priority: 1,
    nextStep: 'Send the deck.',
    notes: 'Waiting on deck edits.',
    customFields: {},
    archivedAt: null,
    createdAt: new Date('2026-06-14T10:00:00.000Z'),
    updatedAt: new Date('2026-06-14T11:00:00.000Z'),
    object: object({ id: IDS.task, type: 'task', canonicalName: 'Send pilot deck' }),
  });
});

describe('POST /api/artifacts/preview', () => {
  it('requires authentication and active team context', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    expect((await POST(request({ ref: { kind: 'route', id: 'team' } }))).status).toBe(401);

    fakes.auth.mockResolvedValueOnce({ user: { id: IDS.user } });
    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    expect((await POST(request({ ref: { kind: 'route', id: 'team' } }))).status).toBe(400);
  });

  it('hydrates every supported preview shape', async () => {
    const cases = [
      [{ kind: 'timeline_event', id: IDS.event }, 'Timeline Event'],
      [{ kind: 'object', id: IDS.object }, 'Otto Silventola'],
      [{ kind: 'object_note', id: IDS.note }, 'Note on Otto Silventola'],
      [
        {
          kind: 'document_chunk',
          id: IDS.chunk,
          documentId: IDS.document,
          version: 2,
          chunkId: IDS.chunk,
        },
        'Pilot Notes',
      ],
      [{ kind: 'calendar_event', id: IDS.calendar }, 'Pilot sync'],
      [{ kind: 'board', id: IDS.board }, 'Pilot Board'],
      [{ kind: 'board_item', id: IDS.boardItem }, 'Send pilot deck'],
      [{ kind: 'task', id: IDS.task }, 'Send pilot deck'],
      [{ kind: 'route', id: 'team/invites' }, 'Invite Team Members'],
    ] as const;
    fakes.getObject.mockImplementation((id: string) =>
      Promise.resolve(
        id === IDS.task ? object({ id, type: 'task', canonicalName: 'Send pilot deck' }) : object(),
      ),
    );

    for (const [ref, title] of cases) {
      const response = await POST(request({ ref }));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ preview: { title } });
    }
  });

  it('returns generic not-found for invalid, missing, or mismatched refs', async () => {
    expect((await POST(request({ ref: { kind: 'route', id: 'Team Invites' } }))).status).toBe(404);

    fakes.getObject.mockResolvedValueOnce(null);
    const missing = await POST(request({ ref: { kind: 'object', id: IDS.object } }));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'not_found' });

    fakes.getObject.mockResolvedValueOnce(object({ type: 'person' }));
    expect((await POST(request({ ref: { kind: 'task', id: IDS.task } }))).status).toBe(404);
  });

  it('preserves document detail-read auditing by using getDocument default options', async () => {
    await POST(
      request({
        ref: {
          kind: 'document_chunk',
          id: IDS.chunk,
          documentId: IDS.document,
          version: 2,
          chunkId: IDS.chunk,
        },
      }),
    );

    expect(fakes.getDocument).toHaveBeenCalledWith(IDS.document);
  });
});
