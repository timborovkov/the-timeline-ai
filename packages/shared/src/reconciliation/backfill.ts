import {
  type Db,
  eventSource,
  rawEvents,
  reconciliationEvidence,
  type reconciliationReplayState,
} from '@timeline/db';
import { and, asc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';

import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export type ReconciliationEvidenceSource = (typeof eventSource.enumValues)[number];
export type ReconciliationEvidenceReplayState =
  (typeof reconciliationReplayState.enumValues)[number];

export interface ReconciliationEvidenceCoverageBucket {
  totalRawEvents: number;
  normalizedRawEvents: number;
  missingRawEvents: number;
  fullReplayEvidence: number;
  degradedReplayEvidence: number;
}

export interface ReconciliationEvidenceCoverageReport extends ReconciliationEvidenceCoverageBucket {
  teamId: string;
  source: ReconciliationEvidenceSource | 'all';
  bySource: Record<ReconciliationEvidenceSource, ReconciliationEvidenceCoverageBucket>;
}

export interface AuditReconciliationEvidenceCoverageInput {
  db: DbOrTx;
  teamId: string;
  source?: ReconciliationEvidenceSource;
  limit?: number;
  pageSize?: number;
}

export interface BackfillReconciliationEvidenceInput {
  db: DbOrTx;
  teamId: string;
  source?: ReconciliationEvidenceSource;
  limit?: number;
  pageSize?: number;
  dryRun?: boolean;
  missingOnly?: boolean;
}

export interface ReconciliationEvidenceBackfillResult {
  teamId: string;
  source: ReconciliationEvidenceSource | 'all';
  dryRun: boolean;
  missingOnly: boolean;
  scannedRawEvents: number;
  candidateRawEvents: number;
  normalizedEvidence: number;
}

interface RawEventCursor {
  occurredAt: Date;
  id: string;
}

interface RawEventPageRow {
  id: string;
  source: ReconciliationEvidenceSource;
  occurredAt: Date;
}

interface EvidenceCoverageRow {
  rawEventId: string;
  replayState: ReconciliationEvidenceReplayState;
}

const DEFAULT_PAGE_SIZE = 500;

export function isReconciliationEvidenceSource(
  value: string,
): value is ReconciliationEvidenceSource {
  return (eventSource.enumValues as readonly string[]).includes(value);
}

export async function auditReconciliationEvidenceCoverage(
  input: AuditReconciliationEvidenceCoverageInput,
): Promise<ReconciliationEvidenceCoverageReport> {
  const bySource = emptySourceBuckets();
  const report: ReconciliationEvidenceCoverageReport = {
    teamId: input.teamId,
    source: input.source ?? 'all',
    totalRawEvents: 0,
    normalizedRawEvents: 0,
    missingRawEvents: 0,
    fullReplayEvidence: 0,
    degradedReplayEvidence: 0,
    bySource,
  };

  await walkRawEvents(input, async (page) => {
    const evidenceByRawEventId = await loadEvidenceCoverage(input.db, input.teamId, page);
    for (const row of page) {
      report.totalRawEvents += 1;
      bySource[row.source].totalRawEvents += 1;

      const evidenceRows = evidenceByRawEventId.get(row.id) ?? [];
      if (evidenceRows.length === 0) {
        report.missingRawEvents += 1;
        bySource[row.source].missingRawEvents += 1;
        continue;
      }

      report.normalizedRawEvents += 1;
      bySource[row.source].normalizedRawEvents += 1;
      const hasFullReplay = evidenceRows.some((evidence) => evidence.replayState === 'full');
      if (hasFullReplay) {
        report.fullReplayEvidence += 1;
        bySource[row.source].fullReplayEvidence += 1;
      } else {
        report.degradedReplayEvidence += 1;
        bySource[row.source].degradedReplayEvidence += 1;
      }
    }
  });

  return report;
}

export async function backfillReconciliationEvidence(
  input: BackfillReconciliationEvidenceInput,
): Promise<ReconciliationEvidenceBackfillResult> {
  const limit = normalizeLimit(input.limit);
  const result: ReconciliationEvidenceBackfillResult = {
    teamId: input.teamId,
    source: input.source ?? 'all',
    dryRun: input.dryRun ?? false,
    missingOnly: input.missingOnly ?? true,
    scannedRawEvents: 0,
    candidateRawEvents: 0,
    normalizedEvidence: 0,
  };

  const walkInput: AuditReconciliationEvidenceCoverageInput = {
    db: input.db,
    teamId: input.teamId,
  };
  if (input.source) walkInput.source = input.source;
  if (input.pageSize !== undefined) walkInput.pageSize = input.pageSize;

  await walkRawEvents(walkInput, async (page) => {
    if (result.candidateRawEvents >= limit) return false;
    result.scannedRawEvents += page.length;

    let candidateIds = page.map((row) => row.id);
    if (result.missingOnly) {
      const existing = await loadEvidenceCoverage(input.db, input.teamId, page);
      candidateIds = candidateIds.filter((id) => !existing.has(id));
    }

    const remaining = limit - result.candidateRawEvents;
    candidateIds = candidateIds.slice(0, remaining);
    if (candidateIds.length === 0) return true;

    result.candidateRawEvents += candidateIds.length;
    if (!result.dryRun) {
      const evidenceIds = await normalizeRawEventsToEvidence({
        db: input.db,
        teamId: input.teamId,
        rawEventIds: candidateIds,
      });
      result.normalizedEvidence += evidenceIds.length;
    }

    return result.candidateRawEvents < limit;
  });

  return result;
}

async function walkRawEvents(
  input: AuditReconciliationEvidenceCoverageInput,
  onPage: (page: RawEventPageRow[]) => Promise<boolean | undefined>,
): Promise<void> {
  const limit = normalizeLimit(input.limit);
  const pageSize = Math.max(1, Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE));
  let cursor: RawEventCursor | null = null;
  let scanned = 0;

  while (scanned < limit) {
    const remaining = limit - scanned;
    const pageInput: LoadRawEventPageInput = {
      db: input.db,
      teamId: input.teamId,
      cursor,
      pageSize: Math.min(pageSize, remaining),
    };
    if (input.source) pageInput.source = input.source;

    const page = await loadRawEventPage(pageInput);
    if (page.length === 0) break;

    const shouldContinue = await onPage(page);
    scanned += page.length;
    if (shouldContinue === false) break;

    const last = page[page.length - 1];
    if (!last || page.length < pageSize) break;
    cursor = { occurredAt: last.occurredAt, id: last.id };
  }
}

interface LoadRawEventPageInput {
  db: DbOrTx;
  teamId: string;
  source?: ReconciliationEvidenceSource;
  cursor: RawEventCursor | null;
  pageSize: number;
}

async function loadRawEventPage(input: LoadRawEventPageInput): Promise<RawEventPageRow[]> {
  const conditions: SQL[] = [eq(rawEvents.teamId, input.teamId)];
  if (input.source) conditions.push(eq(rawEvents.source, input.source));
  if (input.cursor) {
    const cursorClause = or(
      sql`${rawEvents.occurredAt} > ${input.cursor.occurredAt.toISOString()}::timestamptz`,
      and(
        sql`${rawEvents.occurredAt} = ${input.cursor.occurredAt.toISOString()}::timestamptz`,
        gt(rawEvents.id, input.cursor.id),
      ),
    );
    if (cursorClause) conditions.push(cursorClause);
  }

  return input.db
    .select({
      id: rawEvents.id,
      source: rawEvents.source,
      occurredAt: rawEvents.occurredAt,
    })
    .from(rawEvents)
    .where(and(...conditions))
    .orderBy(asc(rawEvents.occurredAt), asc(rawEvents.id))
    .limit(input.pageSize);
}

async function loadEvidenceCoverage(
  db: DbOrTx,
  teamId: string,
  rawEventRows: RawEventPageRow[],
): Promise<Map<string, EvidenceCoverageRow[]>> {
  if (rawEventRows.length === 0) return new Map();
  const rows = await db
    .select({
      rawEventId: reconciliationEvidence.rawEventId,
      replayState: reconciliationEvidence.replayState,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, teamId),
        inArray(
          reconciliationEvidence.rawEventId,
          rawEventRows.map((row) => row.id),
        ),
      ),
    );

  const byRawEventId = new Map<string, EvidenceCoverageRow[]>();
  for (const row of rows) {
    const bucket = byRawEventId.get(row.rawEventId) ?? [];
    bucket.push(row);
    byRawEventId.set(row.rawEventId, bucket);
  }
  return byRawEventId;
}

function emptySourceBuckets(): Record<
  ReconciliationEvidenceSource,
  ReconciliationEvidenceCoverageBucket
> {
  return Object.fromEntries(
    eventSource.enumValues.map((source) => [
      source,
      {
        totalRawEvents: 0,
        normalizedRawEvents: 0,
        missingRawEvents: 0,
        fullReplayEvidence: 0,
        degradedReplayEvidence: 0,
      },
    ]),
  ) as Record<ReconciliationEvidenceSource, ReconciliationEvidenceCoverageBucket>;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return Number.POSITIVE_INFINITY;
  if (limit === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(limit));
}
