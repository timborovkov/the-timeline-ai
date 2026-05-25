import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '../env.js';

import {
  createQdrantClient,
  getQdrantClient,
  resetQdrantClientCacheForTests,
  type QdrantPayload,
} from './client.js';

const ENV_BACKUP = { ...process.env };

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
}

function makeFetcher(initial: { collectionExists?: boolean } = {}): {
  fetcher: typeof fetch;
  calls: CapturedCall[];
  setSearchResult: (hits: { id: string; score: number; payload: QdrantPayload }[]) => void;
} {
  const calls: CapturedCall[] = [];
  let collectionExists = initial.collectionExists ?? false;
  let searchResult: { id: string; score: number; payload: QdrantPayload }[] = [];

  const fetcher: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body });

    // GET /collections/<name>
    if (method === 'GET' && url.includes('/collections/')) {
      if (collectionExists) {
        return Promise.resolve(
          new Response(JSON.stringify({ result: { status: 'green' } }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    // PUT /collections/<name> — create
    if (method === 'PUT' && /\/collections\/[^/]+$/.exec(url)) {
      collectionExists = true;
      return Promise.resolve(new Response(JSON.stringify({ result: true }), { status: 200 }));
    }
    // PUT /collections/<name>/points — upsert
    if (method === 'PUT' && url.endsWith('/points')) {
      return Promise.resolve(
        new Response(JSON.stringify({ result: { operation_id: 1, status: 'acknowledged' } }), {
          status: 200,
        }),
      );
    }
    // POST /collections/<name>/points/search
    if (method === 'POST' && url.endsWith('/points/search')) {
      return Promise.resolve(
        new Response(JSON.stringify({ result: searchResult }), { status: 200 }),
      );
    }
    // POST /collections/<name>/points/delete
    if (method === 'POST' && url.endsWith('/points/delete')) {
      return Promise.resolve(new Response(JSON.stringify({ result: true }), { status: 200 }));
    }
    return Promise.resolve(new Response('unhandled', { status: 500 }));
  };

  return {
    fetcher,
    calls,
    setSearchResult: (hits) => {
      searchResult = hits;
    },
  };
}

beforeEach(() => {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    QDRANT_URL: 'http://qdrant.test:6333',
    QDRANT_API_KEY: 'test-key',
    QDRANT_COLLECTION: 'events_test',
    EMBEDDING_DIMENSIONS: '4',
  };
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
  resetQdrantClientCacheForTests();
});

const samplePayload: QdrantPayload = {
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
  source: 'web',
  visibility: 'team',
  visibility_user_ids: null,
  embedding_model: 'openai/text-embedding-3-small',
};

describe('createQdrantClient', () => {
  it('bootstraps the collection on first use (idempotent: skips create if exists)', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: false });
    const client = createQdrantClient({ fetcher });
    await client.upsertVector('id-1', [0.1, 0.2, 0.3, 0.4], samplePayload);
    const creates = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_test'),
    );
    expect(creates).toHaveLength(1);

    // Second call must NOT re-create.
    await client.upsertVector('id-2', [0.1, 0.2, 0.3, 0.4], samplePayload);
    const createsAfter = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_test'),
    );
    expect(createsAfter).toHaveLength(1);
  });

  it('skips collection creation when HEAD returns 200', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.upsertVector('id-1', [0.1, 0.2, 0.3, 0.4], samplePayload);
    const creates = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_test'),
    );
    expect(creates).toHaveLength(0);
  });

  it('rejects vectors that disagree with the collection dimension', async () => {
    const { fetcher } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await expect(client.upsertVector('id-1', [0.1, 0.2, 0.3], samplePayload)).rejects.toThrow(
      /vector length/,
    );
  });

  it('search filter ALWAYS includes team_id in must (load-bearing)', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0.1, 0.2, 0.3, 0.4]);
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as { filter: { must: { key: string; match: { value: string } }[] } };
    const teamFilter = body.filter.must.find((m) => m.key === 'team_id');
    expect(teamFilter).toEqual({ key: 'team_id', match: { value: 'team-A' } });
  });

  it('search filter includes the per-user visibility branches (must+should default semantic)', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0]);
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as {
      filter: { should: unknown[]; min_should?: unknown };
    };
    // Qdrant's documented must+should default already requires at least
    // one should-clause match when must is present. The bare integer
    // `min_should: 1` is not valid in Qdrant's API spec — verify it is
    // absent so a future version doesn't reject the filter.
    expect(body.filter.min_should).toBeUndefined();
    expect(body.filter.should).toHaveLength(3);
    // Branch 2: private + own author
    expect(body.filter.should[1]).toMatchObject({
      must: [
        { key: 'visibility', match: { value: 'private' } },
        { key: 'author_user_id', match: { value: 'user-1' } },
      ],
    });
    // Branch 3: specific_users contains userId
    expect(body.filter.should[2]).toMatchObject({
      must: [
        { key: 'visibility', match: { value: 'specific_users' } },
        { key: 'visibility_user_ids', match: { any: ['user-1'] } },
      ],
    });
  });

  it('throws when teamId or userId is empty (no silent cross-team query)', async () => {
    const { fetcher } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await expect(client.search('', 'user-1', [0, 0, 0, 0])).rejects.toThrow(/teamId/);
    await expect(client.search('team-A', '', [0, 0, 0, 0])).rejects.toThrow(/userId/);
  });

  it('appends optional must-filters (date range, source, entityIds) without dropping team_id', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0], {
      from: new Date('2026-05-01T00:00:00Z'),
      to: new Date('2026-05-21T00:00:00Z'),
      source: 'telegram',
      entityIds: ['ent-1', 'ent-2'],
      limit: 5,
    });
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as {
      filter: { must: { key: string; match?: unknown; range?: unknown }[] };
      limit: number;
    };
    expect(body.limit).toBe(5);
    const keys = body.filter.must.map((m) => m.key);
    expect(keys).toContain('team_id');
    expect(keys).toContain('occurred_at');
    expect(keys).toContain('source');
    expect(keys).toContain('entity_ids');
  });

  it('requireExisting throws on missing collection instead of auto-creating', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: false });
    const client = createQdrantClient({ fetcher, collection: 'events_v2', requireExisting: true });
    await expect(client.ensureCollection()).rejects.toThrow(/does not exist/);
    // Must NOT have attempted to PUT the collection.
    const creates = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_v2'),
    );
    expect(creates).toHaveLength(0);
  });

  it('honors a collection override (used by the re-embed script)', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher, collection: 'events_v2' });
    await client.search('team-A', 'user-1', [0, 0, 0, 0]);
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    expect(search.url).toContain('/collections/events_v2/points/search');
    expect(client.collectionName()).toBe('events_v2');
  });

  it('getQdrantClient memoizes by (collection, requireExisting) across calls', () => {
    // Without a custom fetcher, the cache should return the same instance.
    const a = getQdrantClient();
    const b = getQdrantClient();
    expect(a).toBe(b);
    // Different collection → different instance.
    const c = getQdrantClient({ collection: 'events_v2' });
    expect(c).not.toBe(a);
    // Same collection but requireExisting flips → different instance
    // (auto-create vs hard-error modes are structurally distinct).
    const d = getQdrantClient({ collection: 'events_v2', requireExisting: true });
    expect(d).not.toBe(c);
  });

  it('getQdrantClient bypasses the cache when a custom fetcher is injected (test isolation)', () => {
    const noopFetcher: typeof fetch = () => Promise.resolve(new Response('{}', { status: 200 }));
    const a = getQdrantClient({ fetcher: noopFetcher });
    const b = getQdrantClient({ fetcher: noopFetcher });
    expect(a).not.toBe(b);
  });

  it('sets the api-key header when QDRANT_API_KEY is configured', async () => {
    let capturedHeaders: Headers | undefined;
    const fetcher: typeof fetch = (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(
        new Response(JSON.stringify({ result: { status: 'green' } }), { status: 200 }),
      );
    };
    const client = createQdrantClient({ fetcher });
    await client.ensureCollection();
    expect(capturedHeaders?.get('api-key')).toBe('test-key');
  });
});
