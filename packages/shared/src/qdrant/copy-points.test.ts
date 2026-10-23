import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  createQdrantClient,
  resetQdrantClientCacheForTests,
  type QdrantPayload,
} from '#src/qdrant/client.js';
import {
  copyCollectionPoints,
  denseVectorFromUnknown,
  verifyCollectionCounts,
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
      const req = (body ?? {}) as { offset?: string; limit?: number };
      const points = store[collection] ?? [];
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
      return Promise.resolve(
        new Response(JSON.stringify({ result: { count: store[collection].length } }), {
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

    const copied = await copyCollectionPoints({ source, target, pageSize: 1 });
    expect(copied).toMatchObject({ scanned: 2, upserted: 2, skipped: 0, dryRun: false });
    expect(store.events_ondisk).toEqual(sourcePoints);

    const counts = await verifyCollectionCounts(source, target);
    expect(counts).toEqual({
      sourceCollection: 'events',
      targetCollection: 'events_ondisk',
      sourceCount: 2,
      targetCount: 2,
      matched: true,
    });
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

    const copied = await copyCollectionPoints({ source, target, dryRun: true });
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

    const copied = await copyCollectionPoints({ source, target });
    expect(copied).toMatchObject({ scanned: 3, upserted: 1, skipped: 2 });
    expect(store.events_ondisk).toEqual([{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4], payload }]);

    const counts = await verifyCollectionCounts(source, target);
    expect(counts.matched).toBe(false);
    expect(counts).toMatchObject({ sourceCount: 3, targetCount: 1 });
  });

  it('refuses to copy a collection onto itself', async () => {
    const { fetcher } = memoryQdrant({ events: [] });
    const client = createQdrantClient({ fetcher, collection: 'events', vectorSize: 4 });
    await expect(copyCollectionPoints({ source: client, target: client })).rejects.toThrow(
      /distinct/,
    );
  });
});
