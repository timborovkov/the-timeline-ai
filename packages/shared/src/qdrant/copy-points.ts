import type { QdrantClient, QdrantPayload, QdrantPointRecord } from '#src/qdrant/client.js';

const DEFAULT_COPY_PAGE_SIZE = 64;
const IDENTITY_MISMATCH_CAP = 32;

export interface CopyCollectionPointsInput {
  source: QdrantClient;
  target: QdrantClient;
  pageSize?: number;
  dryRun?: boolean;
  /**
   * Run a second full scroll+upsert after the first pass so points written
   * while the first pass was in flight are copied. Default true for live
   * copies; skipped on dry-run.
   */
  resync?: boolean;
}

export interface CopyPassStats {
  scanned: number;
  upserted: number;
  skipped: number;
}

export interface CopyCollectionPointsResult {
  sourceCollection: string;
  targetCollection: string;
  scanned: number;
  upserted: number;
  skipped: number;
  dryRun: boolean;
  resync: CopyPassStats | null;
}

export interface VerifyCollectionCountsResult {
  sourceCollection: string;
  targetCollection: string;
  sourceCount: number;
  targetCount: number;
  matched: boolean;
}

export interface VerifyCollectionIdentityResult {
  sourceCollection: string;
  targetCollection: string;
  sourceCount: number;
  targetCount: number;
  missingInTarget: string[];
  extraInTarget: string[];
  vectorMismatches: string[];
  payloadMismatches: string[];
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

function pointIdKey(id: string | number): string {
  return String(id);
}

function vectorFingerprint(vector: number[]): string {
  let sum = 0;
  let weighted = 0;
  let sumSq = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i] ?? 0;
    sum += value;
    weighted += value * (i + 1);
    sumSq += value * value;
  }
  return `${String(vector.length)}:${String(vector[0] ?? 0)}:${String(
    vector[vector.length - 1] ?? 0,
  )}:${String(sum)}:${String(weighted)}:${String(sumSq)}`;
}

function payloadFingerprint(payload: QdrantPayload | undefined): string {
  if (!payload) return '';
  return [
    payload.team_id,
    payload.source_kind,
    payload.source_id,
    payload.event_id ?? '',
    payload.occurred_at,
    payload.visibility,
  ].join('\0');
}

interface PointIdentity {
  vector: string;
  payload: string;
}

async function scrollCollectionIdentity(
  client: QdrantClient,
  pageSize: number,
): Promise<Map<string, PointIdentity>> {
  const identities = new Map<string, PointIdentity>();
  let offset: unknown;
  for (;;) {
    const page = await client.scrollPoints({
      limit: pageSize,
      offset,
      withPayload: true,
      withVector: true,
    });
    for (const point of page.points) {
      const vector = denseVectorFromUnknown(point.vector);
      identities.set(pointIdKey(point.id), {
        vector: vector ? vectorFingerprint(vector) : '',
        payload: payloadFingerprint(point.payload),
      });
    }
    offset = page.nextOffset;
    if (offset === undefined || offset === null) break;
  }
  return identities;
}

function cappedKeys(keys: Iterable<string>): string[] {
  return [...keys].slice(0, IDENTITY_MISMATCH_CAP);
}

async function copyPass(
  input: CopyCollectionPointsInput,
  pageSize: number,
): Promise<CopyPassStats> {
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

  return { scanned, upserted, skipped };
}

/**
 * Copy every point (id + vector + payload) from one collection into another
 * without re-embedding. Source is scrolled; target is upserted with
 * `wait=true`. Re-running is idempotent because point ids are preserved.
 * Live copies run a second pass by default so inserts/updates that landed
 * during the first pass are not lost.
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

  const first = await copyPass(input, pageSize);
  const shouldResync = input.dryRun !== true && input.resync !== false;
  const resync = shouldResync ? await copyPass(input, pageSize) : null;

  return {
    sourceCollection,
    targetCollection,
    scanned: first.scanned,
    upserted: first.upserted,
    skipped: first.skipped,
    dryRun: input.dryRun === true,
    resync,
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

/**
 * Compare source and target by point id, vector fingerprint, and a payload
 * identity tuple. Count equality alone cannot detect a lost update that
 * replaced a vector in place.
 */
export async function verifyCollectionIdentity(
  source: QdrantClient,
  target: QdrantClient,
  opts: { pageSize?: number } = {},
): Promise<VerifyCollectionIdentityResult> {
  const pageSize = opts.pageSize ?? DEFAULT_COPY_PAGE_SIZE;
  const [sourceIdentities, targetIdentities] = await Promise.all([
    scrollCollectionIdentity(source, pageSize),
    scrollCollectionIdentity(target, pageSize),
  ]);

  const missingInTarget: string[] = [];
  const vectorMismatches: string[] = [];
  const payloadMismatches: string[] = [];
  for (const [id, sourcePoint] of sourceIdentities) {
    const targetPoint = targetIdentities.get(id);
    if (!targetPoint) {
      missingInTarget.push(id);
      continue;
    }
    if (sourcePoint.vector !== targetPoint.vector) vectorMismatches.push(id);
    if (sourcePoint.payload !== targetPoint.payload) payloadMismatches.push(id);
  }
  const extraInTarget: string[] = [];
  for (const id of targetIdentities.keys()) {
    if (!sourceIdentities.has(id)) extraInTarget.push(id);
  }

  return {
    sourceCollection: source.collectionName(),
    targetCollection: target.collectionName(),
    sourceCount: sourceIdentities.size,
    targetCount: targetIdentities.size,
    missingInTarget: cappedKeys(missingInTarget),
    extraInTarget: cappedKeys(extraInTarget),
    vectorMismatches: cappedKeys(vectorMismatches),
    payloadMismatches: cappedKeys(payloadMismatches),
    matched:
      missingInTarget.length === 0 &&
      extraInTarget.length === 0 &&
      vectorMismatches.length === 0 &&
      payloadMismatches.length === 0,
  };
}
