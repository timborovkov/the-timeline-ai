import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  createQdrantClient,
  getQdrantClient,
  resetQdrantClientCacheForTests,
  type QdrantPayload,
} from '#src/qdrant/client.js';

const ENV_BACKUP = { ...process.env };

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
}

function makeFetcher(
  initial: {
    collectionExists?: boolean;
    vectorSize?: number;
    teamIndexExists?: boolean;
    teamIndexIsTenant?: boolean;
  } = {},
): {
  fetcher: typeof fetch;
  calls: CapturedCall[];
  setSearchResult: (hits: { id: string; score: number; payload: QdrantPayload }[]) => void;
} {
  const calls: CapturedCall[] = [];
  let collectionExists = initial.collectionExists ?? false;
  let teamIndexExists = initial.teamIndexExists ?? collectionExists;
  let teamIndexIsTenant = initial.teamIndexIsTenant ?? teamIndexExists;
  const collectionVectorSize = initial.vectorSize ?? TIMELINE_MODELS.embedding.embeddingDimensions;
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
          new Response(
            JSON.stringify({
              result: {
                status: 'green',
                config: { params: { vectors: { size: collectionVectorSize, distance: 'Cosine' } } },
                payload_schema: teamIndexExists
                  ? { team_id: { data_type: 'keyword', params: { is_tenant: teamIndexIsTenant } } }
                  : {},
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    // PUT /collections/<name> — create
    if (method === 'PUT' && /\/collections\/[^/]+$/.exec(url)) {
      collectionExists = true;
      return Promise.resolve(new Response(JSON.stringify({ result: true }), { status: 200 }));
    }
    // PUT /collections/<name>/index — payload index creation
    if (method === 'PUT' && url.endsWith('/index')) {
      teamIndexExists = true;
      teamIndexIsTenant = true;
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
    // POST /collections/<name>/points/scroll
    if (method === 'POST' && url.endsWith('/points/scroll')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              points: searchResult.map((hit) => ({ id: hit.id, payload: hit.payload })),
              next_page_offset: null,
            },
          }),
          { status: 200 },
        ),
      );
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
  visibility_owner_user_id: 'user-1',
  source: 'web',
  visibility: 'team',
  visibility_user_ids: null,
  embedding_model: 'openai/text-embedding-3-small',
  source_scope: 'event',
  source_id: 'ev-1',
  chunk_index: 0,
  // Phase 9 per-kind doc fields — null on non-doc_chunk points.
  document_id: null,
  document_version_id: null,
  document_chunk_id: null,
  folder_id: null,
  owner_user_id: null,
  updated_at: null,
  // Phase 10 meeting-chunk fields.
  meeting_id: null,
  meeting_chunk_id: null,
  speaker: null,
};

describe('createQdrantClient', () => {
  it('bootstraps the collection on first use (idempotent: skips create if exists)', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: false });
    const client = createQdrantClient({ fetcher, vectorSize: 4 });
    await client.upsertVector('id-1', [0.1, 0.2, 0.3, 0.4], samplePayload);
    const creates = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_test'),
    );
    expect(creates).toHaveLength(1);
    const indexes = calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/index'));
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.body).toEqual({
      field_name: 'team_id',
      field_schema: { type: 'keyword', on_disk: false, is_tenant: true },
    });

    // Second call must NOT re-create.
    await client.upsertVector('id-2', [0.1, 0.2, 0.3, 0.4], samplePayload);
    const createsAfter = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_test'),
    );
    expect(createsAfter).toHaveLength(1);
    const indexesAfter = calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/index'));
    expect(indexesAfter).toHaveLength(1);
  });

  it('skips collection creation when HEAD returns 200', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true, vectorSize: 4 });
    const client = createQdrantClient({ fetcher, vectorSize: 4 });
    await client.upsertVector('id-1', [0.1, 0.2, 0.3, 0.4], samplePayload);
    const creates = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_test'),
    );
    expect(creates).toHaveLength(0);
    const indexes = calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/index'));
    expect(indexes).toHaveLength(0);
  });

  it('repairs a matching existing collection that is missing the team tenant index', async () => {
    const { fetcher, calls } = makeFetcher({
      collectionExists: true,
      vectorSize: 4,
      teamIndexExists: false,
    });
    const client = createQdrantClient({ fetcher, vectorSize: 4 });
    await client.upsertVector('id-1', [0.1, 0.2, 0.3, 0.4], samplePayload);

    const creates = calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/collections/events_test'),
    );
    expect(creates).toHaveLength(0);
    const indexes = calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/index'));
    expect(indexes).toHaveLength(1);
  });

  it('repairs a plain team_id payload index that is not marked as tenant-optimized', async () => {
    const { fetcher, calls } = makeFetcher({
      collectionExists: true,
      vectorSize: 4,
      teamIndexExists: true,
      teamIndexIsTenant: false,
    });
    const client = createQdrantClient({ fetcher, vectorSize: 4 });
    await client.upsertVector('id-1', [0.1, 0.2, 0.3, 0.4], samplePayload);

    const indexes = calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/index'));
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.body).toEqual({
      field_name: 'team_id',
      field_schema: { type: 'keyword', on_disk: false, is_tenant: true },
    });
  });

  it('rejects an existing collection with the wrong vector dimension', async () => {
    const { fetcher } = makeFetcher({ collectionExists: true, vectorSize: 2560 });
    const client = createQdrantClient({ fetcher, vectorSize: 1536 });
    await expect(client.ensureCollection()).rejects.toThrow(/vector size 2560/);
  });

  it('rejects vectors that disagree with the collection dimension', async () => {
    const { fetcher } = makeFetcher({ collectionExists: true, vectorSize: 4 });
    const client = createQdrantClient({ fetcher, vectorSize: 4 });
    await expect(client.upsertVector('id-1', [0.1, 0.2, 0.3], samplePayload)).rejects.toThrow(
      /vector length/,
    );
  });

  it('deletes all chunk points for a source by payload filter', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });

    await client.deletePointsForSource({
      teamId: 'team-A',
      scope: 'event',
      sourceId: 'ev-1',
      model: 'openai/text-embedding-3-small',
    });

    const del = calls.find((c) => c.url.endsWith('/points/delete'));
    expect(del?.body).toEqual({
      filter: {
        must: [
          { key: 'team_id', match: { value: 'team-A' } },
          { key: 'embedding_model', match: { value: 'openai/text-embedding-3-small' } },
          { key: 'source_scope', match: { value: 'event' } },
          { key: 'source_id', match: { value: 'ev-1' } },
        ],
      },
    });
  });

  it('deletes only stale tail chunks for a source by payload range filter', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });

    await client.deletePointsForSourceFromChunk({
      teamId: 'team-A',
      scope: 'event',
      sourceId: 'ev-1',
      model: 'openai/text-embedding-3-small',
      minChunkIndex: 3,
    });

    const del = calls.find((c) => c.url.endsWith('/points/delete'));
    expect(del?.body).toEqual({
      filter: {
        must: [
          { key: 'team_id', match: { value: 'team-A' } },
          { key: 'embedding_model', match: { value: 'openai/text-embedding-3-small' } },
          { key: 'source_scope', match: { value: 'event' } },
          { key: 'source_id', match: { value: 'ev-1' } },
          { key: 'chunk_index', range: { gte: 3 } },
        ],
      },
    });
  });

  it('counts distinct source ids instead of raw chunk points', async () => {
    const { fetcher, setSearchResult } = makeFetcher({ collectionExists: true });
    setSearchResult([
      { id: 'p1', score: 1, payload: { ...samplePayload, source_id: 'ev-1', chunk_index: 0 } },
      { id: 'p2', score: 1, payload: { ...samplePayload, source_id: 'ev-1', chunk_index: 1 } },
      { id: 'p3', score: 1, payload: { ...samplePayload, source_id: 'ev-2', chunk_index: 0 } },
    ]);
    const client = createQdrantClient({ fetcher });

    await expect(client.countDistinctSources('team-A', { sourceKind: 'raw_event' })).resolves.toBe(
      2,
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
    expect(body.filter.should).toHaveLength(4);
    // Branch 2: private + own author
    expect(body.filter.should[1]).toMatchObject({
      must: [
        { key: 'visibility', match: { value: 'private' } },
        { key: 'author_user_id', match: { value: 'user-1' } },
      ],
    });
    // Branch 3: private + visibility owner
    expect(body.filter.should[2]).toMatchObject({
      must: [
        { key: 'visibility', match: { value: 'private' } },
        { key: 'visibility_owner_user_id', match: { value: 'user-1' } },
      ],
    });
    // Branch 4: specific_users contains userId
    expect(body.filter.should[3]).toMatchObject({
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

  it('forwards semantic pagination offsets to Qdrant', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });

    await client.search('team-A', 'user-1', [0, 0, 0, 0], { limit: 100, offset: 200 });

    const search = calls.find((call) => call.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    expect(search.body).toMatchObject({ limit: 100, offset: 200 });
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

  // ---------------------------------------------------------------------------
  // Phase 9 — source_kind discriminator for doc_chunk. The default
  // (timeline-flavoured) search MUST NOT see doc_chunk points;
  // searchDocumentChunks opts in via sourceKind='doc_chunk'.
  // ---------------------------------------------------------------------------

  it('default search excludes doc_chunk points via must_not (timeline isolation)', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0]);
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as {
      filter: { must_not?: { key: string; match: { any: string[] } }[] };
    };
    expect(body.filter.must_not).toEqual([
      { key: 'source_kind', match: { any: ['doc_chunk', 'meeting_chunk'] } },
    ]);
  });

  it('sourceKind=doc_chunk search MUST source_kind and drops the must_not exclusion', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0], { sourceKind: 'doc_chunk' });
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as {
      filter: {
        must: unknown[];
        must_not?: unknown[];
      };
    };
    expect(body.filter.must_not).toBeUndefined();
    // sourceKind narrowing is implemented as `should: [match any kinds,
    // legacy-fallback branches]` so callers asking for doc_chunk alone
    // see a should-clause naming doc_chunk.
    const should = body.filter.must.find(
      (m): m is { should: { key: string; match: { any: string[] } }[] } =>
        (m as { should?: unknown }).should !== undefined,
    );
    expect(should?.should[0]).toEqual({
      key: 'source_kind',
      match: { any: ['doc_chunk'] },
    });
  });

  it('sourceKind=doc_chunk search threads documentId and folderIds into must', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0], {
      sourceKind: 'doc_chunk',
      documentId: 'doc-1',
      folderIds: ['folder-a', 'folder-b'],
    });
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as {
      filter: {
        must: unknown[];
      };
    };
    const should = body.filter.must.find(
      (m): m is { should: { must?: unknown[] }[] } =>
        (m as { should?: unknown }).should !== undefined,
    );
    const docBranch = should?.should.find((branch) => Array.isArray(branch.must));
    const must = docBranch?.must as { key: string; match: { value?: string; any?: string[] } }[];
    const docMust = must.find((m) => m.key === 'document_id');
    expect(docMust?.match.value).toBe('doc-1');
    const folderMust = must.find((m) => m.key === 'folder_id');
    expect(folderMust?.match.any).toEqual(['folder-a', 'folder-b']);
  });

  it('mixed timeline sourceKind narrows fileKind only on the doc_chunk branch', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0], {
      sourceKind: ['raw_event', 'fact', 'doc_chunk'],
      fileKinds: ['captured'],
    });
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as { filter: { must: unknown[] } };
    const topLevelFileKind = body.filter.must.find(
      (m): m is { key: string } => (m as { key?: string }).key === 'file_kind',
    );
    expect(topLevelFileKind).toBeUndefined();
    const should = body.filter.must.find(
      (m): m is { should: { key?: string; match?: unknown; must?: unknown[] }[] } =>
        (m as { should?: unknown }).should !== undefined,
    );
    expect(should?.should).toContainEqual({
      key: 'source_kind',
      match: { any: ['raw_event', 'fact'] },
    });
    expect(should?.should).toContainEqual({
      must: [
        { key: 'source_kind', match: { value: 'doc_chunk' } },
        { should: [{ key: 'file_kind', match: { any: ['captured'] } }] },
      ],
    });
  });

  it('document fileKind search admits legacy doc_chunk points without file_kind payloads', async () => {
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0], {
      sourceKind: 'doc_chunk',
      fileKinds: ['document'],
    });
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as { filter: { must: unknown[] } };
    const should = body.filter.must.find(
      (m): m is { should: { must?: unknown[] }[] } =>
        (m as { should?: unknown }).should !== undefined,
    );
    const docBranch = should?.should.find((branch) => Array.isArray(branch.must));
    expect(docBranch?.must).toContainEqual({
      should: [
        { key: 'file_kind', match: { any: ['document'] } },
        { is_empty: { key: 'file_kind' } },
      ],
    });
  });

  it('documentId / folderIds on a non-doc_chunk search are ignored (no leakage)', async () => {
    // Defense in depth: even if a caller passes documentId without
    // setting sourceKind='doc_chunk', the filter must NOT promote the
    // search into doc-chunk space (which would let timeline tools query
    // documents via a typo).
    const { fetcher, calls } = makeFetcher({ collectionExists: true });
    const client = createQdrantClient({ fetcher });
    await client.search('team-A', 'user-1', [0, 0, 0, 0], { documentId: 'doc-1' });
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    if (!search) throw new Error('no search call captured');
    const body = search.body as {
      filter: {
        must: { key: string }[];
        must_not?: unknown;
      };
    };
    const hasDocId = body.filter.must.some((m) => m.key === 'document_id');
    const hasFolder = body.filter.must.some((m) => m.key === 'folder_id');
    expect(hasDocId).toBe(false);
    expect(hasFolder).toBe(false);
    // must_not still excludes doc_chunk so the timeline-flavoured search
    // semantics are preserved.
    expect(body.filter.must_not).toBeDefined();
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
