import type { QdrantClient, SearchHit } from '#src/qdrant/client.js';

import { QDRANT_EXACT_SEARCH_PARAMS } from '#src/qdrant/collection-config.js';
import { denseVectorFromUnknown } from '#src/qdrant/copy-points.js';

const DEFAULT_RECALL_SAMPLE = 32;
const DEFAULT_RECALL_K = 10;

export interface CollectionRamSnapshot {
  collection: string;
  pointsCount: number | null;
  indexedVectorsCount: number | null;
  segmentsCount: number | null;
  vectorsOnDisk: boolean | null;
  onDiskPayload: boolean | null;
  quantization: string | null;
  metricBytes: Record<string, number>;
}

export interface RecallAtKResult {
  collection: string;
  sampleSize: number;
  k: number;
  meanRecall: number | null;
  queriesCompared: number;
  status: 'ok' | 'no_data';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function nested(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function quantizationLabel(config: unknown): string | null {
  const record = asRecord(config);
  if (!record) return null;
  if (record.scalar) return 'scalar';
  if (record.binary) return 'binary';
  if (record.product) return 'product';
  return null;
}

const MEMORY_USAGE_KEYS = [
  'ram_bytes',
  'disk_bytes',
  'cached_bytes',
  'expected_cache_bytes',
] as const;

function metricUsage(component: unknown): Record<string, number> {
  const record = asRecord(component);
  if (!record) return {};
  const usage: Record<string, number> = {};
  for (const key of MEMORY_USAGE_KEYS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
  }
  return usage;
}

function addUsage(
  target: Record<string, number>,
  usage: Record<string, number>,
  prefix: string,
): void {
  for (const [key, value] of Object.entries(usage)) {
    const labeled = `${prefix}_${key}`;
    target[labeled] = (target[labeled] ?? 0) + value;
  }
}

/**
 * Parse GET /collections/{name}/memory. Qdrant 1.18+ returns MetricUsage
 * objects (`ram_bytes`, `disk_bytes`, `cached_bytes`, `expected_cache_bytes`).
 * Vector breakdown is an array of `{ storage, index }` entries; a flat
 * `{ ram_bytes }` object is still accepted for tests.
 */
export function collectionMemoryBytesFromResponse(memory: unknown): Record<string, number> {
  const result = nested(memory, ['result']) ?? memory;
  const record = asRecord(result);
  const bytes: Record<string, number> = {};
  if (!record) return bytes;
  addUsage(bytes, metricUsage(record.total), 'total');
  addUsage(bytes, metricUsage(record.payload), 'payload');
  if (Array.isArray(record.vectors)) {
    for (const entry of record.vectors) {
      const item = asRecord(entry);
      addUsage(bytes, metricUsage(item?.storage), 'vectors');
      addUsage(bytes, metricUsage(item?.index), 'vectors_index');
    }
  } else {
    addUsage(bytes, metricUsage(record.vectors), 'vectors');
  }
  return bytes;
}

export function collectionRamSnapshotFromInfo(
  collection: string,
  info: unknown,
  memory: unknown,
): CollectionRamSnapshot {
  const result = nested(info, ['result']) ?? info;
  const params = nested(result, ['config', 'params']);
  const vectors = nested(params, ['vectors']);
  const vectorsRecord = asRecord(vectors);
  const resultRecord = asRecord(result);
  return {
    collection,
    pointsCount: typeof resultRecord?.points_count === 'number' ? resultRecord.points_count : null,
    indexedVectorsCount:
      typeof resultRecord?.indexed_vectors_count === 'number'
        ? resultRecord.indexed_vectors_count
        : null,
    segmentsCount:
      typeof resultRecord?.segments_count === 'number' ? resultRecord.segments_count : null,
    vectorsOnDisk: typeof vectorsRecord?.on_disk === 'boolean' ? vectorsRecord.on_disk : null,
    onDiskPayload:
      typeof nested(params, ['on_disk_payload']) === 'boolean'
        ? (nested(params, ['on_disk_payload']) as boolean)
        : null,
    quantization: quantizationLabel(
      nested(result, ['config', 'quantization_config']) ?? nested(params, ['quantization_config']),
    ),
    metricBytes: collectionMemoryBytesFromResponse(memory),
  };
}

export async function measureCollectionRam(client: QdrantClient): Promise<CollectionRamSnapshot> {
  const [info, memory] = await Promise.all([client.collectionInfo(), client.collectionMemory()]);
  return collectionRamSnapshotFromInfo(client.collectionName(), info, memory);
}

function hitIds(hits: SearchHit[], k: number): string[] {
  return hits.slice(0, k).map((hit) => hit.id);
}

export function hitsWithoutId(hits: SearchHit[], excludedId: string, k: number): SearchHit[] {
  return hits.filter((hit) => hit.id !== excludedId).slice(0, k);
}

export function collectionIndexReady(info: unknown): boolean {
  const result = nested(info, ['result']) ?? info;
  const record = asRecord(result);
  const points = record?.points_count;
  if (typeof points !== 'number' || points === 0) return true;
  if (record?.optimizer_status !== undefined && record.optimizer_status !== 'ok') return false;
  const indexed = record?.indexed_vectors_count;
  return typeof indexed === 'number' && indexed >= points;
}

export async function waitForQuantizedIndex(
  client: QdrantClient,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  // Qdrant 1.19.2 rejects full_scan_threshold < 10. indexing_threshold 0
  // disables indexing; 1 KB is enough to force HNSW on a demo-sized corpus.
  await client.patchOptimizers({ indexingThreshold: 1, fullScanThreshold: 10 });
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollMs = opts.pollMs ?? 200;
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  for (;;) {
    const info = await client.collectionInfo();
    if (collectionIndexReady(info)) return;
    if (now() - started >= timeoutMs) {
      throw new Error(
        'Qdrant collection did not finish indexing/quantization before recall measure',
      );
    }
    await sleep(pollMs);
  }
}

export function recallAtK(baselineIds: string[], candidateIds: string[], k: number): number {
  if (k <= 0) return 1;
  const baseline = new Set(baselineIds.slice(0, k));
  if (baseline.size === 0) return 1;
  let overlap = 0;
  for (const id of candidateIds.slice(0, k)) {
    if (baseline.has(id)) overlap += 1;
  }
  return overlap / baseline.size;
}

export function teamScopedScrollFilter(teamId: string, userId: string): Record<string, unknown> {
  if (!teamId) throw new Error('Qdrant recall sample requires teamId');
  if (!userId) throw new Error('Qdrant recall sample requires userId');
  return {
    must: [{ key: 'team_id', match: { value: teamId } }],
    should: [
      { key: 'visibility', match: { value: 'team' } },
      {
        must: [
          { key: 'visibility', match: { value: 'private' } },
          { key: 'author_user_id', match: { value: userId } },
        ],
      },
      {
        must: [
          { key: 'visibility', match: { value: 'private' } },
          { key: 'visibility_owner_user_id', match: { value: userId } },
        ],
      },
      {
        must: [
          { key: 'visibility', match: { value: 'specific_users' } },
          { key: 'visibility_user_ids', match: { any: [userId] } },
        ],
      },
    ],
  };
}

/**
 * Compare quantized (or default) search against exact search on the same
 * collection. Exact search with quantization.ignore is the uncompressed
 * ground truth; quantized search with rescore is the production path after
 * the storage-layout migration.
 */
export async function measureQuantizedRecall(
  client: QdrantClient,
  opts: {
    sampleSize?: number;
    k?: number;
    teamId: string;
    userId: string;
    wait?: Parameters<typeof waitForQuantizedIndex>[1];
  },
): Promise<RecallAtKResult> {
  const sampleSize = opts.sampleSize ?? DEFAULT_RECALL_SAMPLE;
  const k = opts.k ?? DEFAULT_RECALL_K;
  await waitForQuantizedIndex(client, opts.wait);
  const page = await client.scrollPoints({
    limit: sampleSize,
    withPayload: true,
    withVector: true,
    filter: teamScopedScrollFilter(opts.teamId, opts.userId),
  });
  const queries = page.points
    .map((point) => {
      const vector = denseVectorFromUnknown(point.vector);
      if (!vector) return null;
      return { id: String(point.id), vector };
    })
    .filter((query): query is { id: string; vector: number[] } => query !== null)
    .slice(0, sampleSize);

  let total = 0;
  let compared = 0;
  for (const query of queries) {
    const [exactHits, quantizedHits] = await Promise.all([
      client.search(opts.teamId, opts.userId, query.vector, {
        limit: k + 1,
        searchParams: { ...QDRANT_EXACT_SEARCH_PARAMS },
      }),
      client.search(opts.teamId, opts.userId, query.vector, { limit: k + 1 }),
    ]);
    const exact = hitsWithoutId(exactHits, query.id, k);
    const quantized = hitsWithoutId(quantizedHits, query.id, k);
    if (exact.length === 0) continue;
    total += recallAtK(hitIds(exact, k), hitIds(quantized, k), k);
    compared += 1;
  }

  if (compared === 0) {
    return {
      collection: client.collectionName(),
      sampleSize: queries.length,
      k,
      meanRecall: null,
      queriesCompared: 0,
      status: 'no_data',
    };
  }

  return {
    collection: client.collectionName(),
    sampleSize: queries.length,
    k,
    meanRecall: total / compared,
    queriesCompared: compared,
    status: 'ok',
  };
}
