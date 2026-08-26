/**
 * Scoring must compare multilingual transcripts consistently while reducing all
 * transcript-bearing observations to content-free aggregates. These tests use
 * synthetic strings and no provider, audio file, or network resource.
 */
import { describe, expect, it } from 'vitest';

import {
  aggregateTranscriptionEvalMetrics,
  characterErrorRate,
  normalizeTranscriptionText,
  wordErrorRate,
  type TranscriptionEvalObservation,
} from '#src/transcription-eval/metrics.js';
import { buildValidTranscriptionEvalManifest } from '#src/transcription-eval/test-fixtures.js';

describe('transcription quality metrics', () => {
  it('normalizes Unicode punctuation and calculates WER and CER', () => {
    expect(normalizeTranscriptionText('  HéLLo—World! ')).toBe('héllo world');
    expect(wordErrorRate('hello world', 'hello brave world', 'en')).toBe(0.5);
    expect(characterErrorRate('A B!', 'ab')).toBe(0);
  });

  it('emits aggregate quality, latency, route, and cost evidence without transcript content', () => {
    const manifest = buildValidTranscriptionEvalManifest();
    const observations: TranscriptionEvalObservation[] = manifest.cases.map((fixture, index) => ({
      fixture,
      outcome: {
        ok: true,
        text: fixture.referenceText,
        latencyMs: 100 + index,
        costUsd: 0.001,
        provider: index % 2 === 0 ? 'Provider A' : 'Provider B',
        dataRegion: 'global',
      },
    }));

    const metrics = aggregateTranscriptionEvalMetrics(observations);
    const serialized = JSON.stringify(metrics);

    expect(metrics).toMatchObject({
      caseCount: 24,
      scoredCaseCount: 24,
      macroWer: 0,
      macroCer: 0,
      entityAccuracy: 1,
      numberAccuracy: 1,
      requestErrorRate: 0,
      formatErrorRate: 0,
      availabilityRate: 1,
      coverageRate: 1,
      costUsd: { observedCaseCount: 24, total: 0.024, mean: 0.001 },
    });
    expect(metrics.latencyMs).toEqual({ p50: 111, p95: 122 });
    expect(metrics.routes).toEqual([
      { provider: 'Provider A', dataRegion: 'global', count: 12 },
      { provider: 'Provider B', dataRegion: 'global', count: 12 },
    ]);
    expect(metrics.languageSlices).toHaveLength(24);
    expect(metrics.sourceSlices).toHaveLength(4);
    expect(serialized).not.toContain('Alice meets Bob');
    expect(serialized).not.toContain('Synthetic speech sample');
  });

  it('counts format failures, hallucination, empty output, and likely trailing truncation', () => {
    const manifest = buildValidTranscriptionEvalManifest();
    const observations: TranscriptionEvalObservation[] = manifest.cases.map((fixture) => {
      if (fixture.scenarios.includes('silence')) {
        return { fixture, outcome: { ok: true, text: 'invented words', latencyMs: 20 } };
      }
      if (fixture.scenarios.includes('names')) {
        return { fixture, outcome: { ok: true, text: '', latencyMs: 20 } };
      }
      if (fixture.scenarios.includes('long_low_bitrate')) {
        return {
          fixture,
          outcome: {
            ok: true,
            text: fixture.referenceText.slice(0, 50),
            latencyMs: 20,
          },
        };
      }
      if (fixture.format === 'aac') {
        return {
          fixture,
          outcome: { ok: false, latencyMs: 20, errorCategory: 'format' as const },
        };
      }
      return { fixture, outcome: { ok: true, text: fixture.referenceText, latencyMs: 20 } };
    });

    const metrics = aggregateTranscriptionEvalMetrics(observations);

    expect(metrics.hallucinationRate).toBeGreaterThan(0);
    expect(metrics.emptyOutputRate).toBeGreaterThan(0);
    expect(metrics.truncationRate).toBeGreaterThan(0);
    expect(metrics.formatErrorRate).toBeGreaterThan(0);
    expect(metrics.errorCategories).toEqual([{ category: 'format', count: 3 }]);
    expect(metrics.availabilityRate).toBeLessThan(1);
  });
});
