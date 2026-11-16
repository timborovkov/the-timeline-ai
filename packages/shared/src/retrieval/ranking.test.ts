import { describe, expect, it } from 'bun:test';

import {
  balancedRanking,
  compareEvidence,
  evidenceRanking,
  eventEvidenceDate,
} from '#src/retrieval/ranking.js';
// Ranking must improve freshness without turning recent evidence into authority.
const now = new Date('2026-11-11T12:00:00Z');
const rank = (
  id: string,
  score: number,
  date: string,
  basis: 'source' | 'uploaded' | 'observed' = 'source',
) => ({ id, score, ranking: evidenceRanking(score, date, basis, now, true) });
describe('evidence freshness', () => {
  it('favours a recent relevant correction but preserves materially stronger older evidence', () => {
    const old = rank('old', 0.8, '2026-01-01');
    const recent = rank('new', 0.79, now.toISOString());
    const evergreen = rank('evergreen', 0.9, '2025-01-01');
    expect([old, recent, evergreen].sort(compareEvidence).map((x) => x.id)).toEqual([
      'evergreen',
      'new',
      'old',
    ]);
    expect(recent.score).toBe(0.79);
  });
  it('uses the same source-date policy across conversation and integration evidence', () => {
    for (const source of ['telegram', 'slack', 'email', 'meeting', 'integration', 'note']) {
      const date = eventEvidenceDate(source, now, {});
      expect(evidenceRanking(0.8, date.date, date.basis, now, true).freshnessBoost).toBe(0.05);
    }
    expect(rank('upload', 0.8, now.toISOString(), 'uploaded').ranking.freshnessBoost).toBe(0.01);
    expect(rank('website', 0.8, now.toISOString(), 'observed').ranking.freshnessBoost).toBe(0.01);
  });
  it('distinguishes observation, upload, native notes and actual meeting time', () => {
    expect(eventEvidenceDate('web', now, { websiteScanId: 'scan' }).basis).toBe('observed');
    expect(eventEvidenceDate('web', now, {}).basis).toBe('source');
    expect(eventEvidenceDate('document', now, {}).basis).toBe('uploaded');
    expect(
      eventEvidenceDate('meeting', now, { source_snapshot: { started_at: '2026-01-01' } }),
    ).toEqual({ date: '2026-01-01', basis: 'source' });
  });
  it('uses a thirty-day half-life and gives invalid or future dates no boost', () => {
    expect(rank('month', 0.8, '2026-10-12T12:00:00Z').ranking.freshnessBoost).toBeCloseTo(0.025);
    for (const date of ['invalid', '2027-01-01'])
      expect(rank(date, 0.8, date).ranking.freshnessBoost).toBe(0);
    expect(evidenceRanking(0.8, null, 'unknown', now, true).freshnessBoost).toBe(0);
  });
  it('preserves historical and exact inspection unless balanced ranking is explicit', () => {
    expect(balancedRanking({})).toBe(true);
    expect(balancedRanking({ from: now })).toBe(false);
    expect(balancedRanking({}, true)).toBe(false);
    expect(balancedRanking({ ranking: 'relevance' })).toBe(false);
    expect(balancedRanking({ ranking: 'balanced', from: now })).toBe(true);
    expect(evidenceRanking(0.8, now, 'source', now, false).rankingScore).toBe(0.8);
  });
  it('breaks ties deterministically by stable identity', () => {
    expect(
      [rank('b', 0.8, '2026-11-01'), rank('a', 0.8, '2026-11-01')]
        .sort(compareEvidence)
        .map((x) => x.id),
    ).toEqual(['a', 'b']);
  });
});
