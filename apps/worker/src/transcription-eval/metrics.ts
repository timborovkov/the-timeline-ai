import type {
  TranscriptionEvalCase,
  TranscriptionEvalFormat,
  TranscriptionEvalScenario,
  TranscriptionEvalSource,
} from '#src/transcription-eval/manifest.js';

export type TranscriptionEvalErrorCategory =
  | 'authentication'
  | 'format'
  | 'invalid_response'
  | 'provider'
  | 'quota'
  | 'timeout';

export interface TranscriptionEvalTransportSuccess {
  ok: true;
  text: string;
  latencyMs: number;
  costUsd?: number;
  provider?: string;
  dataRegion?: string;
}

interface TranscriptionEvalTransportFailure {
  ok: false;
  latencyMs: number;
  errorCategory: TranscriptionEvalErrorCategory;
}

type TranscriptionEvalTransportOutcome =
  | TranscriptionEvalTransportSuccess
  | TranscriptionEvalTransportFailure;

export interface TranscriptionEvalObservation {
  fixture: TranscriptionEvalCase;
  outcome: TranscriptionEvalTransportOutcome;
}

interface TranscriptionEvalRouteAggregate {
  provider: string;
  dataRegion: string | null;
  count: number;
}

interface TranscriptionEvalSliceMetrics {
  caseCount: number;
  scoredCaseCount: number;
  macroWer: number | null;
  macroCer: number | null;
  requestErrorRate: number;
  formatErrorRate: number;
}

interface TranscriptionEvalLanguageSlice extends TranscriptionEvalSliceMetrics {
  language: string;
}

interface TranscriptionEvalSourceSlice extends TranscriptionEvalSliceMetrics {
  source: TranscriptionEvalSource;
}

export interface TranscriptionEvalAggregateMetrics {
  caseCount: number;
  scoredCaseCount: number;
  macroWer: number | null;
  macroCer: number | null;
  entityAccuracy: number | null;
  numberAccuracy: number | null;
  hallucinationRate: number;
  emptyOutputRate: number;
  truncationRate: number;
  requestErrorRate: number;
  formatErrorRate: number;
  availabilityRate: number;
  coverageRate: number;
  latencyMs: {
    p50: number | null;
    p95: number | null;
  };
  costUsd: {
    observedCaseCount: number;
    total: number | null;
    mean: number | null;
  };
  errorCategories: { category: TranscriptionEvalErrorCategory; count: number }[];
  routes: TranscriptionEvalRouteAggregate[];
  languageSlices: TranscriptionEvalLanguageSlice[];
  sourceSlices: TranscriptionEvalSourceSlice[];
}

interface ScoredObservation {
  observation: TranscriptionEvalObservation;
  normalizedHypothesis: string;
  wer: number | null;
  cer: number | null;
  usable: boolean;
  hallucinated: boolean;
  emptyOutput: boolean;
  truncated: boolean;
  entityExpected: number;
  entityFound: number;
  numberExpected: number;
  numberFound: number;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(8));
}

export function normalizeTranscriptionText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function compactNormalizedText(text: string): string {
  return normalizeTranscriptionText(text).replace(/\s+/gu, '');
}

function wordTokens(text: string, language: string): string[] {
  const normalized = normalizeTranscriptionText(text);
  if (!normalized) return [];
  try {
    const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
    const tokens: string[] = [];
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike) tokens.push(segment.segment);
    }
    if (tokens.length > 0) return tokens;
  } catch {
    // Invalid runtime locale support falls back to deterministic whitespace splitting.
  }
  return normalized.split(' ').filter(Boolean);
}

function characterTokens(text: string): string[] {
  return Array.from(compactNormalizedText(text));
}

function editDistance(reference: readonly string[], hypothesis: readonly string[]): number {
  if (reference.length === 0) return hypothesis.length;
  if (hypothesis.length === 0) return reference.length;

  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex += 1) {
    const current = [referenceIndex];
    for (let hypothesisIndex = 1; hypothesisIndex <= hypothesis.length; hypothesisIndex += 1) {
      const substitutionCost =
        reference[referenceIndex - 1] === hypothesis[hypothesisIndex - 1] ? 0 : 1;
      current[hypothesisIndex] = Math.min(
        (previous[hypothesisIndex] ?? 0) + 1,
        (current[hypothesisIndex - 1] ?? 0) + 1,
        (previous[hypothesisIndex - 1] ?? 0) + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[hypothesis.length] ?? 0;
}

function normalizedErrorRate(reference: readonly string[], hypothesis: readonly string[]): number {
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  return editDistance(reference, hypothesis) / reference.length;
}

export function wordErrorRate(reference: string, hypothesis: string, language: string): number {
  return normalizedErrorRate(wordTokens(reference, language), wordTokens(hypothesis, language));
}

export function characterErrorRate(reference: string, hypothesis: string): number {
  return normalizedErrorRate(characterTokens(reference), characterTokens(hypothesis));
}

function expectedTermFound(hypothesis: string, expected: string): boolean {
  const hypothesisTokens = wordTokens(hypothesis, 'und');
  const expectedTokens = wordTokens(expected, 'und');
  if (expectedTokens.length === 0 || expectedTokens.length > hypothesisTokens.length) return false;

  return hypothesisTokens.some((_, start) =>
    expectedTokens.every((token, offset) => hypothesisTokens[start + offset] === token),
  );
}

function countExpectedTerms(hypothesis: string, expected: readonly string[] | undefined): number {
  return (expected ?? []).filter((term) => expectedTermFound(hypothesis, term)).length;
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function isLikelyTruncated(fixture: TranscriptionEvalCase, hypothesis: string): boolean {
  if (!fixture.scenarios.includes('long_low_bitrate')) return false;
  const reference = compactNormalizedText(fixture.referenceText);
  const normalizedHypothesis = compactNormalizedText(hypothesis);
  if (reference.length < 40 || normalizedHypothesis.length < 8) return false;
  if (normalizedHypothesis.length / reference.length > 0.75) return false;
  return commonPrefixLength(reference, normalizedHypothesis) / normalizedHypothesis.length >= 0.85;
}

function scoreObservation(observation: TranscriptionEvalObservation): ScoredObservation {
  const { fixture, outcome } = observation;
  const hypothesis = outcome.ok ? outcome.text : '';
  const normalizedHypothesis = normalizeTranscriptionText(hypothesis);
  const isSilence = fixture.scenarios.includes('silence');
  const emptyOutput = !isSilence && outcome.ok && normalizedHypothesis.length === 0;
  const usable = outcome.ok && (isSilence ? normalizedHypothesis.length === 0 : !emptyOutput);

  return {
    observation,
    normalizedHypothesis,
    wer: outcome.ok ? wordErrorRate(fixture.referenceText, hypothesis, fixture.language) : null,
    cer: outcome.ok ? characterErrorRate(fixture.referenceText, hypothesis) : null,
    usable,
    hallucinated: isSilence && outcome.ok && normalizedHypothesis.length > 0,
    emptyOutput,
    truncated: outcome.ok && isLikelyTruncated(fixture, hypothesis),
    entityExpected: fixture.entities?.length ?? 0,
    entityFound: outcome.ok ? countExpectedTerms(hypothesis, fixture.entities) : 0,
    numberExpected: fixture.numbers?.length ?? 0,
    numberFound: outcome.ok ? countExpectedTerms(hypothesis, fixture.numbers) : 0,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  const value = sorted[index];
  return value === undefined ? null : roundMetric(value);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : roundMetric(numerator / denominator);
}

function sliceMetrics(scored: readonly ScoredObservation[]): TranscriptionEvalSliceMetrics {
  const requestErrors = scored.filter(({ observation }) => !observation.outcome.ok).length;
  const formatErrors = scored.filter(
    ({ observation }) => !observation.outcome.ok && observation.outcome.errorCategory === 'format',
  ).length;
  const wers = scored.flatMap(({ wer }) => (wer === null ? [] : [wer]));
  const cers = scored.flatMap(({ cer }) => (cer === null ? [] : [cer]));
  return {
    caseCount: scored.length,
    scoredCaseCount: wers.length,
    macroWer: mean(wers),
    macroCer: mean(cers),
    requestErrorRate: rate(requestErrors, scored.length),
    formatErrorRate: rate(formatErrors, scored.length),
  };
}

function routeKey(provider: string, dataRegion: string | undefined): string {
  return `${provider}\u0000${dataRegion ?? ''}`;
}

function splitRouteKey(key: string): { provider: string; dataRegion: string | null } {
  const separator = key.indexOf('\u0000');
  const provider = key.slice(0, separator);
  const dataRegion = key.slice(separator + 1);
  return { provider, dataRegion: dataRegion || null };
}

function coverageKeys(fixture: TranscriptionEvalCase): string[] {
  return [
    `language:${fixture.language.toLowerCase()}`,
    `format:${fixture.format satisfies TranscriptionEvalFormat}`,
    `source:${fixture.source satisfies TranscriptionEvalSource}`,
    ...fixture.scenarios.map(
      (scenario) => `scenario:${scenario satisfies TranscriptionEvalScenario}`,
    ),
  ];
}

/**
 * Reduce transcript-bearing observations to aggregate evidence. The returned value
 * intentionally has no fixture IDs, paths, references, hypotheses, or audio data.
 */
export function aggregateTranscriptionEvalMetrics(
  observations: readonly TranscriptionEvalObservation[],
): TranscriptionEvalAggregateMetrics {
  const scored = observations.map(scoreObservation);
  const base = sliceMetrics(scored);
  const requestErrors = scored.filter(({ observation }) => !observation.outcome.ok).length;
  const formatErrors = scored.filter(
    ({ observation }) => !observation.outcome.ok && observation.outcome.errorCategory === 'format',
  ).length;
  const silenceCases = scored.filter(({ observation }) =>
    observation.fixture.scenarios.includes('silence'),
  );
  const voicedCases = scored.filter(
    ({ observation }) => !observation.fixture.scenarios.includes('silence'),
  );
  const longCases = scored.filter(({ observation }) =>
    observation.fixture.scenarios.includes('long_low_bitrate'),
  );

  const allCoverageKeys = new Set<string>();
  const successfulCoverageKeys = new Set<string>();
  for (const item of scored) {
    for (const key of coverageKeys(item.observation.fixture)) {
      allCoverageKeys.add(key);
      if (item.usable) successfulCoverageKeys.add(key);
    }
  }

  const errorCounts = new Map<TranscriptionEvalErrorCategory, number>();
  const routeCounts = new Map<string, number>();
  const costs: number[] = [];
  const latencies: number[] = [];
  for (const { outcome } of observations) {
    latencies.push(outcome.latencyMs);
    if (!outcome.ok) {
      errorCounts.set(outcome.errorCategory, (errorCounts.get(outcome.errorCategory) ?? 0) + 1);
      continue;
    }
    if (outcome.costUsd !== undefined) costs.push(outcome.costUsd);
    const provider = outcome.provider ?? 'unreported';
    const key = routeKey(provider, outcome.dataRegion);
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }

  const entityExpected = scored.reduce((sum, item) => sum + item.entityExpected, 0);
  const entityFound = scored.reduce((sum, item) => sum + item.entityFound, 0);
  const numberExpected = scored.reduce((sum, item) => sum + item.numberExpected, 0);
  const numberFound = scored.reduce((sum, item) => sum + item.numberFound, 0);
  const totalCost = costs.length > 0 ? costs.reduce((sum, value) => sum + value, 0) : null;

  const languages = [...new Set(observations.map(({ fixture }) => fixture.language.toLowerCase()))]
    .sort()
    .map((language) => ({
      language,
      ...sliceMetrics(
        scored.filter(({ observation }) => observation.fixture.language.toLowerCase() === language),
      ),
    }));
  const sources = [...new Set(observations.map(({ fixture }) => fixture.source))]
    .sort()
    .map((source) => ({
      source,
      ...sliceMetrics(scored.filter(({ observation }) => observation.fixture.source === source)),
    }));

  return {
    ...base,
    entityAccuracy: entityExpected === 0 ? null : rate(entityFound, entityExpected),
    numberAccuracy: numberExpected === 0 ? null : rate(numberFound, numberExpected),
    hallucinationRate: rate(
      silenceCases.filter((item) => item.hallucinated).length,
      silenceCases.length,
    ),
    emptyOutputRate: rate(
      voicedCases.filter((item) => item.emptyOutput).length,
      voicedCases.length,
    ),
    truncationRate: rate(longCases.filter((item) => item.truncated).length, longCases.length),
    requestErrorRate: rate(requestErrors, observations.length),
    formatErrorRate: rate(formatErrors, observations.length),
    availabilityRate: rate(observations.length - requestErrors, observations.length),
    coverageRate: rate(successfulCoverageKeys.size, allCoverageKeys.size),
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    },
    costUsd: {
      observedCaseCount: costs.length,
      total: totalCost === null ? null : roundMetric(totalCost),
      mean: totalCost === null ? null : roundMetric(totalCost / costs.length),
    },
    errorCategories: [...errorCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => ({ category, count })),
    routes: [...routeCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => ({ ...splitRouteKey(key), count })),
    languageSlices: languages,
    sourceSlices: sources,
  };
}
