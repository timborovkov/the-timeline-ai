import type { QdrantClient, QdrantPayload, QdrantPointRecord } from '#src/qdrant/client.js';

const DEFAULT_COPY_PAGE_SIZE = 64;
const IDENTITY_MISMATCH_CAP = 32;

export interface CopyCollectionPointsInput {
  source: QdrantClient;
  target: QdrantClient;
  /** One or more team ids. Copy always scrolls with a `team_id` filter. */
  teamIds: string[];
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
  teamIds: string[];
  scanned: number;
  upserted: number;
  skipped: number;
  dryRun: boolean;
  resync: CopyPassStats | null;
}

export interface VerifyCollectionCountsResult {
  sourceCollection: string;
  targetCollection: string;
  teamIds: string[];
  sourceCount: number;
  targetCount: number;
  matched: boolean;
}

export interface VerifyCollectionIdentityResult {
  sourceCollection: string;
  targetCollection: string;
  teamIds: string[];
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

export function normalizeTeamIds(teamIds: Iterable<string>): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of teamIds) {
    const teamId = raw.trim();
    if (!teamId) continue;
    if (seen.has(teamId)) continue;
    seen.add(teamId);
    unique.push(teamId);
  }
  return unique;
}

export function requireTeamIds(teamIds: Iterable<string>): string[] {
  const unique = normalizeTeamIds(teamIds);
  if (unique.length === 0) {
    throw new Error('Qdrant copy/verify requires at least one teamId (or --all-teams)');
  }
  return unique;
}

/** Distinct team ids from one or more collections, sorted for stable reports. */
export function unionTeamIds(...lists: Iterable<string>[]): string[] {
  return normalizeTeamIds(lists.flatMap((list) => [...list])).sort();
}

export function teamIdScrollFilter(teamId: string): Record<string, unknown> {
  if (!teamId) throw new Error('Qdrant copy/verify requires teamId');
  return { must: [{ key: 'team_id', match: { value: teamId } }] };
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

/**
 * Canonical JSON for a stored Qdrant payload. Object keys are sorted;
 * arrays keep order. Used by identity verify so visibility_user_ids,
 * author_user_id, and every other payload field participate.
 */
export function canonicalPayloadJson(payload: unknown): string {
  return canonicalJson(payload);
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function payloadFingerprint(payload: QdrantPayload | undefined): string {
  if (!payload) return '';
  return canonicalPayloadJson(payload);
}

interface PointIdentity {
  vector: string;
  payload: string;
}

async function scrollCollectionIdentity(
  client: QdrantClient,
  pageSize: number,
  teamId: string,
): Promise<Map<string, PointIdentity>> {
  const identities = new Map<string, PointIdentity>();
  let offset: unknown;
  for (;;) {
    const page = await client.scrollPoints({
      limit: pageSize,
      offset,
      withPayload: true,
      withVector: true,
      filter: teamIdScrollFilter(teamId),
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

/**
 * Payload-only discovery of distinct `team_id` values. This is the one
 * collection-wide scroll; copy/verify then loop those teams with a filter.
 */
export async function listCollectionTeamIds(
  client: QdrantClient,
  opts: { pageSize?: number } = {},
): Promise<string[]> {
  const pageSize = opts.pageSize ?? DEFAULT_COPY_PAGE_SIZE;
  const teamIds = new Set<string>();
  let offset: unknown;
  for (;;) {
    const page = await client.scrollPoints({
      limit: pageSize,
      offset,
      withPayload: ['team_id'],
      withVector: false,
      unfiltered: true,
    });
    for (const point of page.points) {
      const teamId = point.payload?.team_id;
      if (typeof teamId === 'string' && teamId.trim()) teamIds.add(teamId);
    }
    offset = page.nextOffset;
    if (offset === undefined || offset === null) break;
  }
  return [...teamIds].sort();
}

async function copyPassForTeam(
  input: CopyCollectionPointsInput,
  pageSize: number,
  teamId: string,
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
      filter: teamIdScrollFilter(teamId),
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

async function copyPass(
  input: CopyCollectionPointsInput,
  pageSize: number,
  teamIds: string[],
): Promise<CopyPassStats> {
  let scanned = 0;
  let upserted = 0;
  let skipped = 0;
  for (const teamId of teamIds) {
    const pass = await copyPassForTeam(input, pageSize, teamId);
    scanned += pass.scanned;
    upserted += pass.upserted;
    skipped += pass.skipped;
  }
  return { scanned, upserted, skipped };
}

/**
 * Copy every point (id + vector + payload) from one collection into another
 * without re-embedding. Source is scrolled per `team_id`; target is upserted
 * with `wait=true`. Re-running is idempotent because point ids are preserved.
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
  const teamIds = requireTeamIds(input.teamIds);
  const sourceCollection = input.source.collectionName();
  const targetCollection = input.target.collectionName();
  if (sourceCollection === targetCollection) {
    throw new Error('Qdrant copy requires distinct --source-collection and --target-collection');
  }

  const first = await copyPass(input, pageSize, teamIds);
  const shouldResync = input.dryRun !== true && input.resync !== false;
  const resync = shouldResync ? await copyPass(input, pageSize, teamIds) : null;

  return {
    sourceCollection,
    targetCollection,
    teamIds,
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
  teamIds: Iterable<string>,
): Promise<VerifyCollectionCountsResult> {
  const teams = requireTeamIds(teamIds);
  let sourceCount = 0;
  let targetCount = 0;
  for (const teamId of teams) {
    sourceCount += await source.countPoints(teamId);
    targetCount += await target.countPoints(teamId);
  }
  return {
    sourceCollection: source.collectionName(),
    targetCollection: target.collectionName(),
    teamIds: teams,
    sourceCount,
    targetCount,
    matched: sourceCount === targetCount,
  };
}

/**
 * Compare source and target by point id, vector fingerprint, and a
 * canonical full-payload JSON. Count equality alone cannot detect a lost
 * update that replaced a vector or visibility field in place. Scrolls each
 * requested team separately.
 */
export async function verifyCollectionIdentity(
  source: QdrantClient,
  target: QdrantClient,
  opts: { pageSize?: number; teamIds: Iterable<string> },
): Promise<VerifyCollectionIdentityResult> {
  const pageSize = opts.pageSize ?? DEFAULT_COPY_PAGE_SIZE;
  const teamIds = requireTeamIds(opts.teamIds);
  const sourceIdentities = new Map<string, PointIdentity>();
  const targetIdentities = new Map<string, PointIdentity>();
  for (const teamId of teamIds) {
    const [sourcePage, targetPage] = await Promise.all([
      scrollCollectionIdentity(source, pageSize, teamId),
      scrollCollectionIdentity(target, pageSize, teamId),
    ]);
    for (const [id, identity] of sourcePage) sourceIdentities.set(id, identity);
    for (const [id, identity] of targetPage) targetIdentities.set(id, identity);
  }

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
    teamIds,
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
