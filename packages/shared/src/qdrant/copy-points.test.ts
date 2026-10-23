import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  createQdrantClient,
  resetQdrantClientCacheForTests,
  type QdrantPayload,
} from '#src/qdrant/client.js';
import {
  canonicalPayloadJson,
  copyCollectionPoints,
  denseVectorFromUnknown,
  listCollectionTeamIds,
  teamIdScrollFilter,
  unionTeamIds,
  verifyCollectionCounts,
  verifyCollectionIdentity,
} from '#src/qdrant/copy-points.js';

const ENV_BACKUP = { ...process.env };

const payload: QdrantPayload = {
  team_id: 'team-A',
  source_kind: 'raw_event',
  event_id: 'ev-1',
  fact_id: null,
  object_id: null,
  note_id: null,
  change_id: null,
  entity_id: null,
  entity_ids: [],
  occurred_at: '2026-05-20T00:00:00.000Z',
  author_user_id: 'user-1',
  visibility_owner_user_id: 'user-1',
  source: 'web',
  visibility: 'team',
  visibility_user_ids: null,
  embedding_model: 'openai/text-embedding-3-small',
  source_scope: 'event',
  source_id: 'ev-1',
  chunk_index: 0,
  document_id: null,
  document_version_id: null,
  document_chunk_id: null,
  folder_id: null,
  owner_user_id: null,
  updated_at: null,
  meeting_id: null,
  meeting_chunk_id: null,
  speaker: null,
};

interface StoredPoint {
  id: string;
  vector: number[];
  payload: QdrantPayload;
}

const TEAM_IDS = [payload.team_id];

function applyTeamFilter(points: StoredPoint[], filter: unknown): StoredPoint[] {
  const record = filter && typeof filter === 'object' ? (filter as { must?: unknown }) : null;
  const must = Array.isArray(record?.must) ? record.must : [];
  const teamClause = must.find(
    (clause): clause is { key: string; match: { value: string } } =>
      Boolean(clause) &&
      typeof clause === 'object' &&
      (clause as { key?: string }).key === 'team_id',
  );
  if (!teamClause) return points;
  return points.filter((point) => point.payload.team_id === teamClause.match.value);
}

function memoryQdrant(initial: Record<string, StoredPoint[]>): {
  fetcher: typeof fetch;
  store: Record<string, StoredPoint[]>;
} {
  const store: Record<string, StoredPoint[]> = Object.fromEntries(
    Object.entries(initial).map(([name, points]) => [name, [...points]]),
  );

  const fetcher: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const collectionMatch = /\/collections\/([^/]+)/.exec(url);
    const collection = collectionMatch ? decodeURIComponent(collectionMatch[1] ?? '') : '';
    store[collection] ??= [];

    if (method === 'GET' && /\/collections\/[^/]+$/.exec(url)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              points_count: store[collection].length,
              config: { params: { vectors: { size: 4, distance: 'Cosine' } } },
              payload_schema: {
                team_id: { data_type: 'keyword', params: { is_tenant: true } },
              },
            },
          }),
          { status: 200 },
        ),
      );
    }
    if (method === 'POST' && url.endsWith('/points/scroll')) {
      const req = (body ?? {}) as { offset?: string; limit?: number; filter?: unknown };
      const points = applyTeamFilter(store[collection] ?? [], req.filter);
      const start = req.offset ? points.findIndex((point) => point.id === req.offset) + 1 : 0;
      const slice = points.slice(start, start + (req.limit ?? 64));
      const last = slice[slice.length - 1];
      const more = start + slice.length < points.length;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              points: slice,
              next_page_offset: more ? last?.id : null,
            },
          }),
          { status: 200 },
        ),
      );
    }
    if (method === 'PUT' && url.includes('/points?wait=true')) {
      const req = (body ?? {}) as { points?: StoredPoint[] };
      for (const point of req.points ?? []) {
        const list: StoredPoint[] = store[collection] ?? [];
        const index = list.findIndex((existing) => existing.id === point.id);
        if (index >= 0) list[index] = point;
        else list.push(point);
        store[collection] = list;
      }
      return Promise.resolve(
        new Response(JSON.stringify({ result: { status: 'completed' } }), { status: 200 }),
      );
    }
    if (method === 'POST' && url.endsWith('/points/count')) {
      const req = (body ?? {}) as { filter?: unknown };
      const points = applyTeamFilter(store[collection] ?? [], req.filter);
      return Promise.resolve(
        new Response(JSON.stringify({ result: { count: points.length } }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response('unhandled', { status: 500 }));
  };

  return { fetcher, store };
}

beforeEach(() => {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    QDRANT_URL: 'http://qdrant.test:6333',
    QDRANT_COLLECTION: 'events',
  };
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
  resetQdrantClientCacheForTests();
});

describe('copyCollectionPoints', () => {
  it('parses unnamed and named dense vectors', () => {
    expect(denseVectorFromUnknown([0.1, 0.2], 2)).toEqual([0.1, 0.2]);
    expect(denseVectorFromUnknown({ default: [1, 2, 3] }, 3)).toEqual([1, 2, 3]);
    expect(denseVectorFromUnknown([1, 2], 3)).toBeNull();
  });

  it('copies points via scroll+upsert without changing ids or vectors', async () => {
    const sourcePoints: StoredPoint[] = [
      { id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload },
      {
        id: 'p2',
        vector: [0.5, 0.6, 0.7, 0.8],
        payload: { ...payload, event_id: 'ev-2', source_id: 'ev-2' },
      },
    ];
    const { fetcher, store } = memoryQdrant({ events: sourcePoints, events_ondisk: [] });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });

    const copied = await copyCollectionPoints({
      source,
      target,
      teamIds: TEAM_IDS,
      pageSize: 1,
    });
    expect(copied).toMatchObject({
      scanned: 2,
      upserted: 2,
      skipped: 0,
      dryRun: false,
      resync: { scanned: 2, upserted: 2, skipped: 0 },
    });
    expect(store.events_ondisk).toEqual(sourcePoints);

    const counts = await verifyCollectionCounts(source, target, TEAM_IDS);
    expect(counts).toEqual({
      sourceCollection: 'events',
      targetCollection: 'events_ondisk',
      teamIds: TEAM_IDS,
      sourceCount: 2,
      targetCount: 2,
      matched: true,
    });
    const identity = await verifyCollectionIdentity(source, target, {
      teamIds: TEAM_IDS,
      pageSize: 1,
    });
    expect(identity.matched).toBe(true);
  });

  it('second pass copies points written during the first pass', async () => {
    const first: StoredPoint = { id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload };
    const late: StoredPoint = {
      id: 'p-late',
      vector: [0.9, 0.8, 0.7, 0.6],
      payload: { ...payload, event_id: 'ev-late', source_id: 'ev-late' },
    };
    const { fetcher, store } = memoryQdrant({ events: [first], events_ondisk: [] });
    let completedScrolls = 0;
    const wrappingFetcher: typeof fetch = async (input, init) => {
      const response = await fetcher(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/points/scroll')) {
        const clone = response.clone();
        const body = (await clone.json()) as { result?: { next_page_offset?: unknown } };
        if (body.result?.next_page_offset === undefined || body.result.next_page_offset === null) {
          completedScrolls += 1;
          if (completedScrolls === 1) {
            store.events = [...(store.events ?? []), late];
          }
        }
      }
      return response;
    };
    const source = createQdrantClient({
      fetcher: wrappingFetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher: wrappingFetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });

    const copied = await copyCollectionPoints({
      source,
      target,
      teamIds: TEAM_IDS,
      pageSize: 8,
    });
    expect(copied).toMatchObject({
      scanned: 1,
      upserted: 1,
      resync: { scanned: 2, upserted: 2 },
    });
    expect(store.events_ondisk?.map((point) => point.id)).toEqual(['p1', 'p-late']);
    await expect(
      verifyCollectionIdentity(source, target, { teamIds: TEAM_IDS }),
    ).resolves.toMatchObject({
      matched: true,
      sourceCount: 2,
      targetCount: 2,
    });
  });

  it('detects in-place vector updates that counts would miss', async () => {
    const { fetcher, store } = memoryQdrant({
      events: [{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload }],
      events_ondisk: [{ id: 'p1', vector: [0.9, 0.9, 0.9, 0.9], payload }],
    });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });
    await expect(verifyCollectionCounts(source, target, TEAM_IDS)).resolves.toMatchObject({
      matched: true,
    });
    await expect(
      verifyCollectionIdentity(source, target, { teamIds: TEAM_IDS }),
    ).resolves.toMatchObject({
      matched: false,
      vectorMismatches: ['p1'],
    });
    expect(store.events).toHaveLength(1);
  });

  it('dry-run scrolls without writing the target', async () => {
    const { fetcher, store } = memoryQdrant({
      events: [{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload }],
      events_ondisk: [],
    });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });

    const copied = await copyCollectionPoints({
      source,
      target,
      teamIds: TEAM_IDS,
      dryRun: true,
    });
    expect(copied.upserted).toBe(1);
    expect(copied.dryRun).toBe(true);
    expect(store.events_ondisk).toEqual([]);
  });

  it('skips points that lack a dense vector or payload', async () => {
    const { fetcher, store } = memoryQdrant({
      events: [
        { id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload },
        { id: 'empty-vector', vector: [], payload },
      ],
      events_ondisk: [],
    });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });
    const sourcePoints = store.events ?? [];
    sourcePoints.push({
      id: 'non-array-vector',
      vector: 'nope' as unknown as number[],
      payload,
    });
    store.events = sourcePoints;

    const copied = await copyCollectionPoints({ source, target, teamIds: TEAM_IDS });
    expect(copied).toMatchObject({ scanned: 3, upserted: 1, skipped: 2 });
    expect(store.events_ondisk).toEqual([{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload }]);

    const counts = await verifyCollectionCounts(source, target, TEAM_IDS);
    expect(counts.matched).toBe(false);
    expect(counts).toMatchObject({ sourceCount: 3, targetCount: 1 });
  });

  it('refuses to copy a collection onto itself', async () => {
    const { fetcher } = memoryQdrant({ events: [] });
    const client = createQdrantClient({ fetcher, collection: 'events', vectorSize: 4 });
    await expect(
      copyCollectionPoints({ source: client, target: client, teamIds: TEAM_IDS }),
    ).rejects.toThrow(/distinct/);
  });

  it('refuses a copy without team ids', async () => {
    const { fetcher } = memoryQdrant({ events: [] });
    const source = createQdrantClient({ fetcher, collection: 'events', vectorSize: 4 });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
    });
    await expect(copyCollectionPoints({ source, target, teamIds: [] })).rejects.toThrow(
      /at least one teamId/,
    );
  });

  it('copies only the requested team and leaves other tenants in the source', async () => {
    const otherPayload: QdrantPayload = { ...payload, team_id: 'team-B' };
    const { fetcher, store } = memoryQdrant({
      events: [
        { id: 'p-a', vector: [0.1, 0.2, 0.3, 0.4], payload },
        { id: 'p-b', vector: [0.5, 0.6, 0.7, 0.8], payload: otherPayload },
      ],
      events_ondisk: [],
    });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });

    const copied = await copyCollectionPoints({
      source,
      target,
      teamIds: ['team-A'],
      resync: false,
    });
    expect(copied.upserted).toBe(1);
    expect(store.events_ondisk?.map((point) => point.id)).toEqual(['p-a']);
    expect(teamIdScrollFilter('team-A')).toEqual({
      must: [{ key: 'team_id', match: { value: 'team-A' } }],
    });
  });

  it('discovers team ids then copies each tenant in a filtered loop', async () => {
    const otherPayload: QdrantPayload = { ...payload, team_id: 'team-B' };
    const { fetcher, store } = memoryQdrant({
      events: [
        { id: 'p-a', vector: [0.1, 0.2, 0.3, 0.4], payload },
        { id: 'p-b', vector: [0.5, 0.6, 0.7, 0.8], payload: otherPayload },
      ],
      events_ondisk: [],
    });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });

    const teamIds = await listCollectionTeamIds(source);
    expect(teamIds).toEqual(['team-A', 'team-B']);
    await copyCollectionPoints({ source, target, teamIds, resync: false });
    expect(store.events_ondisk?.map((point) => point.id).sort()).toEqual(['p-a', 'p-b']);
  });

  it('unions team ids from source and target so leftover tenants are verified', async () => {
    expect(unionTeamIds(['team-B', 'team-A'], ['team-A', 'team-C'])).toEqual([
      'team-A',
      'team-B',
      'team-C',
    ]);
    const leftover: QdrantPayload = { ...payload, team_id: 'team-B', source_id: 'ev-b' };
    const { fetcher } = memoryQdrant({
      events: [{ id: 'p-a', vector: [0.1, 0.2, 0.3, 0.4], payload }],
      events_ondisk: [
        { id: 'p-a', vector: [0.1, 0.2, 0.3, 0.4], payload },
        { id: 'p-b', vector: [0.5, 0.6, 0.7, 0.8], payload: leftover },
      ],
    });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });
    const sourceTeams = await listCollectionTeamIds(source);
    expect(sourceTeams).toEqual(['team-A']);
    await expect(
      verifyCollectionIdentity(source, target, { teamIds: sourceTeams }),
    ).resolves.toMatchObject({ matched: true });
    const verifyTeams = unionTeamIds(sourceTeams, await listCollectionTeamIds(target));
    expect(verifyTeams).toEqual(['team-A', 'team-B']);
    await expect(
      verifyCollectionIdentity(source, target, { teamIds: verifyTeams }),
    ).resolves.toMatchObject({
      matched: false,
      extraInTarget: ['p-b'],
    });
  });

  it('detects visibility and author payload drift that the old identity tuple missed', async () => {
    expect(canonicalPayloadJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    const drifted: QdrantPayload = {
      ...payload,
      visibility: 'specific_users',
      visibility_user_ids: ['user-2'],
      author_user_id: 'user-2',
      visibility_owner_user_id: 'user-2',
    };
    const { fetcher } = memoryQdrant({
      events: [{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload }],
      events_ondisk: [{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload: drifted }],
    });
    const source = createQdrantClient({
      fetcher,
      collection: 'events',
      vectorSize: 4,
      requireExisting: true,
    });
    const target = createQdrantClient({
      fetcher,
      collection: 'events_ondisk',
      vectorSize: 4,
      requireExisting: true,
    });
    await expect(verifyCollectionCounts(source, target, TEAM_IDS)).resolves.toMatchObject({
      matched: true,
    });
    await expect(
      verifyCollectionIdentity(source, target, { teamIds: TEAM_IDS }),
    ).resolves.toMatchObject({
      matched: false,
      payloadMismatches: ['p1'],
    });
  });
});
