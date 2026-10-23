import { describe, expect, it, vi } from 'vitest';

import type { QdrantClient, SearchHit } from '#src/qdrant/client.js';

import { QDRANT_EXACT_SEARCH_PARAMS } from '#src/qdrant/collection-config.js';
import {
  collectionMemoryBytesFromResponse,
  collectionRamSnapshotFromInfo,
  measureQuantizedRecall,
  recallAtK,
  teamScopedScrollFilter,
} from '#src/qdrant/measure.js';

const TEAM = 'team-A';
const USER = 'user-1';

function hit(id: string): SearchHit {
  return { id, score: 1, payload: { team_id: TEAM } as SearchHit['payload'] };
}

function mockMeasureClient(input: {
  points?: { id: string; vector: number[] }[];
  exactHits?: SearchHit[];
  quantizedHits?: SearchHit[];
}): {
  client: QdrantClient;
  search: ReturnType<typeof vi.fn>;
  scrollPoints: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(
    (_teamId: string, _userId: string, _vector: number[], opts?: { searchParams?: unknown }) => {
      if (opts?.searchParams) return input.exactHits ?? [hit('p1'), hit('p2')];
      return input.quantizedHits ?? [hit('p1'), hit('p2')];
    },
  );
  const scrollPoints = vi.fn().mockResolvedValue({
    points: (input.points ?? [{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4] }]).map((point) => ({
      ...point,
      payload: { team_id: TEAM, visibility: 'team' },
    })),
    nextOffset: null,
  });
  const client = {
    collectionName: () => 'events_ondisk',
    scrollPoints,
    search,
  } as unknown as QdrantClient;
  return { client, search, scrollPoints };
}

describe('qdrant RAM and recall helpers', () => {
  it('reads collection RAM bytes from the /memory response', () => {
    expect(
      collectionMemoryBytesFromResponse({
        result: {
          total: { ram_bytes: 123, disk_bytes: 999 },
          vectors: { ram_bytes: 80 },
          payload: { ram_bytes: 20 },
        },
      }),
    ).toEqual({
      total_ram_bytes: 123,
      total_disk_bytes: 999,
      vectors_ram_bytes: 80,
      payload_ram_bytes: 20,
    });
  });

  it('sums Qdrant 1.19 vector storage array entries from /memory', () => {
    expect(
      collectionMemoryBytesFromResponse({
        result: {
          total: { ram_bytes: 409576, disk_bytes: 153301772, expected_cache_bytes: 69202132 },
          vectors: [
            {
              name: '',
              storage: {
                ram_bytes: 0,
                disk_bytes: 69202132,
                expected_cache_bytes: 69202132,
              },
              index: { ram_bytes: 0, disk_bytes: 0 },
            },
          ],
          payload: { ram_bytes: 0, disk_bytes: 69272164 },
        },
      }),
    ).toMatchObject({
      total_ram_bytes: 409576,
      total_expected_cache_bytes: 69202132,
      vectors_expected_cache_bytes: 69202132,
      payload_disk_bytes: 69272164,
    });
  });

  it('reads on-disk and quantization flags from collection info plus /memory', () => {
    const snapshot = collectionRamSnapshotFromInfo(
      'events_ondisk',
      {
        result: {
          points_count: 12,
          indexed_vectors_count: 12,
          segments_count: 1,
          config: {
            params: {
              on_disk_payload: true,
              vectors: { size: 4, distance: 'Cosine', on_disk: true },
            },
            quantization_config: { scalar: { type: 'int8' } },
          },
        },
      },
      { result: { total: { ram_bytes: 42 } } },
    );
    expect(snapshot).toMatchObject({
      collection: 'events_ondisk',
      pointsCount: 12,
      vectorsOnDisk: true,
      onDiskPayload: true,
      quantization: 'scalar',
      metricBytes: { total_ram_bytes: 42 },
    });
  });

  it('computes overlap-at-k against the baseline ranking', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'c', 'd'], 2)).toBe(0.5);
    expect(recallAtK(['a', 'b'], ['b', 'a'], 2)).toBe(1);
    expect(recallAtK([], ['a'], 10)).toBe(1);
  });

  it('scopes recall samples to the requested team and visibility', () => {
    expect(teamScopedScrollFilter(TEAM, USER)).toEqual({
      must: [{ key: 'team_id', match: { value: TEAM } }],
      should: [
        { key: 'visibility', match: { value: 'team' } },
        {
          must: [
            { key: 'visibility', match: { value: 'private' } },
            { key: 'author_user_id', match: { value: USER } },
          ],
        },
        {
          must: [
            { key: 'visibility', match: { value: 'private' } },
            { key: 'visibility_owner_user_id', match: { value: USER } },
          ],
        },
        {
          must: [
            { key: 'visibility', match: { value: 'specific_users' } },
            { key: 'visibility_user_ids', match: { any: [USER] } },
          ],
        },
      ],
    });
    expect(() => teamScopedScrollFilter('', USER)).toThrow(/teamId/);
  });

  it('sends exact + quantization.ignore for the uncompressed baseline', async () => {
    const { client, search, scrollPoints } = mockMeasureClient({});
    const result = await measureQuantizedRecall(client, {
      teamId: TEAM,
      userId: USER,
      sampleSize: 1,
      k: 2,
    });
    expect(result).toMatchObject({ status: 'ok', meanRecall: 1, queriesCompared: 1 });
    expect(search).toHaveBeenCalledWith(
      TEAM,
      USER,
      [0.1, 0.2, 0.3, 0.4],
      expect.objectContaining({
        searchParams: { ...QDRANT_EXACT_SEARCH_PARAMS },
      }),
    );
    expect(scrollPoints).toHaveBeenCalledWith(
      expect.objectContaining({ filter: teamScopedScrollFilter(TEAM, USER) }),
    );
  });

  it('reports no_data instead of 100% when no comparable queries exist', async () => {
    const { client } = mockMeasureClient({ points: [], exactHits: [] });
    await expect(
      measureQuantizedRecall(client, { teamId: TEAM, userId: USER, sampleSize: 8, k: 10 }),
    ).resolves.toEqual({
      collection: 'events_ondisk',
      sampleSize: 0,
      k: 10,
      meanRecall: null,
      queriesCompared: 0,
      status: 'no_data',
    });
  });

  it('skips empty exact rankings so a zero-hit sample is no_data', async () => {
    const { client } = mockMeasureClient({
      points: [{ id: 'p1', vector: [0.1, 0.2, 0.3, 0.4] }],
      exactHits: [],
      quantizedHits: [hit('p1')],
    });
    await expect(
      measureQuantizedRecall(client, { teamId: TEAM, userId: USER, k: 10 }),
    ).resolves.toMatchObject({ status: 'no_data', meanRecall: null, queriesCompared: 0 });
  });
});
