import type { QdrantClient, SearchHit } from '#src/qdrant/client.js';

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
  meanRecall: number;
  queriesCompared: number;
}

export function parsePrometheusGauges(text: string, collection: string): Record<string, number> {
  const gauges: Record<string, number> = {};
  const collectionToken = `collection="${collection}"`;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.includes(collectionToken) && !/memory|ram|resident/i.test(line)) continue;
    const match =
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)\{[^}]*\}\s+(\S+)/.exec(line) ??
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(\S+)/.exec(line);
    if (!match) continue;
    const name = match[1];
    const value = Number(match[2]);
    if (!name || !Number.isFinite(value)) continue;
    const collectionSpecific = line.includes(collectionToken);
    const memoryLike = /memory|ram|resident/i.test(name);
    if (!collectionSpecific && !memoryLike) continue;
    if (!name.endsWith('_bytes') && !memoryLike) continue;
    gauges[name] = value;
  }
  return gauges;
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

export function collectionRamSnapshotFromInfo(
  collection: string,
  info: unknown,
  metricsText: string,
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
    metricBytes: parsePrometheusGauges(metricsText, collection),
  };
}

export async function measureCollectionRam(client: QdrantClient): Promise<CollectionRamSnapshot> {
  const [info, metrics] = await Promise.all([client.collectionInfo(), client.metricsText()]);
  return collectionRamSnapshotFromInfo(client.collectionName(), info, metrics);
}

function hitIds(hits: SearchHit[], k: number): string[] {
  return hits.slice(0, k).map((hit) => hit.id);
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

/**
 * Compare quantized (or default) search against exact search on the same
 * collection. Exact search is the uncompressed ground truth; quantized
 * search with rescore is the production path after the storage-layout
 * migration.
 */
export async function measureQuantizedRecall(
  client: QdrantClient,
  opts: { sampleSize?: number; k?: number; teamId: string; userId: string },
): Promise<RecallAtKResult> {
  const sampleSize = opts.sampleSize ?? DEFAULT_RECALL_SAMPLE;
  const k = opts.k ?? DEFAULT_RECALL_K;
  const page = await client.scrollPoints({
    limit: sampleSize,
    withPayload: true,
    withVector: true,
  });
  const queries = page.points
    .map((point) => denseVectorFromUnknown(point.vector))
    .filter((vector): vector is number[] => vector !== null)
    .slice(0, sampleSize);

  let total = 0;
  let compared = 0;
  for (const vector of queries) {
    const [exactHits, quantizedHits] = await Promise.all([
      client.search(opts.teamId, opts.userId, vector, {
        limit: k,
        searchParams: { exact: true },
      }),
      client.search(opts.teamId, opts.userId, vector, { limit: k }),
    ]);
    if (exactHits.length === 0) continue;
    total += recallAtK(hitIds(exactHits, k), hitIds(quantizedHits, k), k);
    compared += 1;
  }

  return {
    collection: client.collectionName(),
    sampleSize: queries.length,
    k,
    meanRecall: compared === 0 ? 1 : total / compared,
    queriesCompared: compared,
  };
}
