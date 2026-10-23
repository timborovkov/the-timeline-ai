import type { QdrantClient, QdrantPointRecord } from '#src/qdrant/client.js';

const DEFAULT_COPY_PAGE_SIZE = 64;

export interface CopyCollectionPointsInput {
  source: QdrantClient;
  target: QdrantClient;
  pageSize?: number;
  dryRun?: boolean;
}

export interface CopyCollectionPointsResult {
  sourceCollection: string;
  targetCollection: string;
  scanned: number;
  upserted: number;
  skipped: number;
  dryRun: boolean;
}

export interface VerifyCollectionCountsResult {
  sourceCollection: string;
  targetCollection: string;
  sourceCount: number;
  targetCount: number;
  matched: boolean;
}

export function denseVectorFromUnknown(value: unknown, expectedSize?: number): number[] | null {
  if (Array.isArray(value)) {
    if (!value.every((item): item is number => typeof item === 'number' && Number.isFinite(item))) {
      return null;
    }
    if (expectedSize !== undefined && value.length !== expectedSize) return null;
    return value;
  }
  if (value && typeof value === 'object') {
    const named = Object.values(value).find((candidate) => Array.isArray(candidate));
    return denseVectorFromUnknown(named, expectedSize);
  }
  return null;
}

/**
 * Copy every point (id + vector + payload) from one collection into another
 * without re-embedding. Source is scrolled; target is upserted with
 * `wait=true`. Re-running is idempotent because point ids are preserved.
 */
export async function copyCollectionPoints(
  input: CopyCollectionPointsInput,
): Promise<CopyCollectionPointsResult> {
  const pageSize = input.pageSize ?? DEFAULT_COPY_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Qdrant copy page size must be a positive integer');
  }
  const sourceCollection = input.source.collectionName();
  const targetCollection = input.target.collectionName();
  if (sourceCollection === targetCollection) {
    throw new Error('Qdrant copy requires distinct --source-collection and --target-collection');
  }

  let scanned = 0;
  let upserted = 0;
  let skipped = 0;
  let offset: unknown;

  for (;;) {
    const page = await input.source.scrollPoints({
      limit: pageSize,
      offset,
      withPayload: true,
      withVector: true,
    });
    const batch: QdrantPointRecord[] = [];
    for (const point of page.points) {
      scanned += 1;
      const vector = denseVectorFromUnknown(point.vector);
      if (!vector || vector.length === 0 || !point.payload) {
        skipped += 1;
        continue;
      }
      batch.push({
        id: point.id,
        vector,
        payload: point.payload,
      });
    }
    if (!input.dryRun && batch.length > 0) {
      await input.target.upsertPoints(batch);
    }
    upserted += batch.length;
    offset = page.nextOffset;
    if (offset === undefined || offset === null) break;
  }

  return {
    sourceCollection,
    targetCollection,
    scanned,
    upserted,
    skipped,
    dryRun: input.dryRun === true,
  };
}

export async function verifyCollectionCounts(
  source: QdrantClient,
  target: QdrantClient,
): Promise<VerifyCollectionCountsResult> {
  const sourceCount = await source.countAllPoints();
  const targetCount = await target.countAllPoints();
  return {
    sourceCollection: source.collectionName(),
    targetCollection: target.collectionName(),
    sourceCount,
    targetCount,
    matched: sourceCount === targetCount,
  };
}
