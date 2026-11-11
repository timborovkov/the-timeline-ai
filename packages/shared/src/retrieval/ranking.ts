/** Freshness is a small relevance signal, never a claim of source authority. */
export type SearchRanking = 'auto' | 'relevance' | 'balanced';
export type EvidenceDateBasis = 'source' | 'observed' | 'uploaded' | 'unknown';
export const FRESHNESS_CANDIDATE_LIMIT = 200;
export interface RankingMetadata {
  mode: 'relevance' | 'balanced';
  rankingScore: number;
  freshnessBoost: number;
  dateBasis: EvidenceDateBasis;
  evidenceDate: string | null;
  rankedAt: string;
  candidateLimitReached: boolean;
}
export interface SearchRankingSummary {
  mode: 'balanced' | 'relevance';
  candidateLimit: number | null;
  candidateLimitReached: boolean;
}
export function rankingSummary(balanced: boolean, count: number): SearchRankingSummary {
  return {
    mode: balanced ? 'balanced' : 'relevance',
    candidateLimit: balanced ? FRESHNESS_CANDIDATE_LIMIT : null,
    candidateLimitReached: balanced && count >= FRESHNESS_CANDIDATE_LIMIT,
  };
}
export interface RankingInput {
  onRanking?: (summary: SearchRankingSummary) => void;
  ranking?: SearchRanking | undefined;
  rankingNow?: Date | undefined;
}
export function balancedRanking(
  input: RankingInput & { from?: unknown; to?: unknown },
  exact = false,
): boolean {
  return (
    input.ranking === 'balanced' ||
    (input.ranking !== 'relevance' && !input.from && !input.to && !exact)
  );
}
export function evidenceRanking(
  score: number,
  date: Date | string | null | undefined,
  basis: EvidenceDateBasis,
  now: Date,
  balanced: boolean,
  candidateLimitReached = false,
): RankingMetadata {
  const time = date === null || date === undefined ? NaN : new Date(date).getTime();
  const age = now.getTime() - time;
  const maximum = basis === 'source' ? 0.05 : basis === 'unknown' ? 0 : 0.01;
  const freshnessBoost =
    balanced && Number.isFinite(age) && age >= 0 ? maximum * 2 ** (-age / (30 * 86_400_000)) : 0;
  return {
    mode: balanced ? 'balanced' : 'relevance',
    rankingScore: score + freshnessBoost,
    freshnessBoost,
    dateBasis: basis,
    evidenceDate: Number.isFinite(time) ? new Date(time).toISOString() : null,
    rankedAt: now.toISOString(),
    candidateLimitReached,
  };
}
export function compareEvidence(
  a: { id: string; score: number; ranking?: RankingMetadata | undefined },
  b: { id: string; score: number; ranking?: RankingMetadata | undefined },
): number {
  return (
    (b.ranking?.rankingScore ?? b.score) - (a.ranking?.rankingScore ?? a.score) ||
    b.score - a.score ||
    (Date.parse(b.ranking?.evidenceDate ?? '') || 0) -
      (Date.parse(a.ranking?.evidenceDate ?? '') || 0) ||
    a.id.localeCompare(b.id)
  );
}

/** Native web notes are authored evidence; only website captures are observations. */
export function eventEvidenceDate(
  source: string,
  occurredAt: Date | string,
  metadata: unknown,
): { date: Date | string; basis: EvidenceDateBasis } {
  const record =
    metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  if (source === 'web' && (record.websiteScanId || record.websiteId))
    return { date: occurredAt, basis: 'observed' };
  if (source === 'document') return { date: occurredAt, basis: 'uploaded' };
  if (source === 'meeting') {
    const snapshot =
      record.source_snapshot && typeof record.source_snapshot === 'object'
        ? (record.source_snapshot as Record<string, unknown>)
        : {};
    if (typeof snapshot.started_at === 'string')
      return { date: snapshot.started_at, basis: 'source' };
  }
  return { date: occurredAt, basis: 'source' };
}
