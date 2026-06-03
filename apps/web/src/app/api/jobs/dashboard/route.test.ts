import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getDocumentVersion: vi.fn(),
  getEvent: vi.fn(),
  queue: {
    enqueueDocumentExtractJob: vi.fn(),
    enqueueTranscribeJob: vi.fn(),
    enqueueExtractJob: vi.fn(),
    enqueueEmbedJob: vi.fn(),
  },
  countRows: [] as number[],
}));

vi.mock('@timeline/db', () => ({
  documentVersions: {
    teamId: 'team_id',
    processingStatus: 'processing_status',
    createdAt: 'created_at',
  },
  facts: { rawEventId: 'raw_event_id' },
  integrations: { teamId: 'team_id', lastError: 'last_error' },
  meetings: { teamId: 'team_id', status: 'status' },
  rawEvents: {
    id: 'id',
    teamId: 'team_id',
    contentAudioUrl: 'content_audio_url',
    contentText: 'content_text',
    createdAt: 'created_at',
    sourceMetadata: 'source_metadata',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  count: () => ({ op: 'count' }),
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  isNotNull: (arg: unknown) => ({ op: 'isNotNull', arg }),
  lt: (...args: unknown[]) => ({ op: 'lt', args }),
  notExists: (arg: unknown) => ({ op: 'notExists', arg }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', strings, values }),
}));
vi.mock('@timeline/shared/cache', () => ({
  cacheKey: (parts: unknown[]) => parts.join(':'),
  cachedJson: async (_key: string, _ttl: number, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: vi.fn(() => Promise.resolve(fakes.queue)) }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    documents: { getDocumentVersion: fakes.getDocumentVersion },
    timeline: { getEvent: fakes.getEvent },
  }),
}));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const count = fakes.countRows.shift() ?? 0;
          return Promise.resolve([{ count }]);
        },
      }),
    }),
  },
}));

const { GET, POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';

function post(body: unknown): Request {
  return new Request('https://timeline.test/api/jobs/dashboard', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.getDocumentVersion.mockResolvedValue({ id: VERSION_ID });
  fakes.getEvent.mockResolvedValue({ id: EVENT_ID, contentAudioUrl: 'audio/key.webm' });
  fakes.countRows = [1, 2, 999, 3, 4, 5, 6, 7, 8];
});

describe('/api/jobs/dashboard', () => {
  it('guards auth, active team, and admin membership', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(401);

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    expect((await POST(post({ kind: 'embedding', id: EVENT_ID }))).status).toBe(400);

    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    await expect(GET()).rejects.toThrow('member');
  });

  it('serializes dashboard summary counts from scoped queries', async () => {
    fakes.countRows = [1, 2, 999, 3, 4, 5, 6, 7, 8];
    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      summaries: { kind: string; needsAttention: number }[];
    };
    expect(body.summaries.map((item) => [item.kind, item.needsAttention])).toEqual([
      ['transcription', 2],
      ['extraction', 3],
      ['embedding', 4],
      ['document_processing', 11],
      ['meeting_finalization', 7],
      ['integration_sync', 8],
      ['dead_lettered', 1],
    ]);
  });

  it('retries document, transcription, extraction, and embedding jobs through queue wrappers', async () => {
    expect((await POST(post({ kind: 'document_processing', id: VERSION_ID }))).status).toBe(200);
    expect(fakes.queue.enqueueDocumentExtractJob).toHaveBeenCalledWith({
      documentVersionId: VERSION_ID,
      teamId: TEAM_ID,
    });

    expect((await POST(post({ kind: 'transcription', id: EVENT_ID }))).status).toBe(200);
    expect(fakes.queue.enqueueTranscribeJob).toHaveBeenCalledWith({
      rawEventId: EVENT_ID,
      teamId: TEAM_ID,
      audioKey: 'audio/key.webm',
    });

    expect((await POST(post({ kind: 'extraction', id: EVENT_ID }))).status).toBe(200);
    expect(fakes.queue.enqueueExtractJob).toHaveBeenCalledWith({
      rawEventId: EVENT_ID,
      teamId: TEAM_ID,
    });

    expect((await POST(post({ kind: 'embedding', id: EVENT_ID }))).status).toBe(200);
    expect(fakes.queue.enqueueEmbedJob).toHaveBeenCalledWith({
      rawEventId: EVENT_ID,
      teamId: TEAM_ID,
    });
  });

  it('rejects invalid retry input, missing records, and non-audio transcription retries', async () => {
    expect((await POST(post({ kind: 'unknown', id: EVENT_ID }))).status).toBe(400);

    fakes.getDocumentVersion.mockResolvedValueOnce(null);
    expect((await POST(post({ kind: 'document_processing', id: VERSION_ID }))).status).toBe(404);

    fakes.getEvent.mockResolvedValueOnce(null);
    expect((await POST(post({ kind: 'embedding', id: EVENT_ID }))).status).toBe(404);

    fakes.getEvent.mockResolvedValueOnce({ id: EVENT_ID, contentAudioUrl: null });
    expect((await POST(post({ kind: 'transcription', id: EVENT_ID }))).status).toBe(400);
  });
});
