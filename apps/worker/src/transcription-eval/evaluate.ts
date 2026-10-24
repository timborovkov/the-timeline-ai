import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  OPENROUTER_MODEL_CATALOG_SHA256,
  OPENROUTER_PRIVACY_ATTESTATION_FORMAT,
  TIMELINE_AI_PRIVACY_POLICY_VERSION,
  TIMELINE_MODELS,
  isValidOpenRouterGuardrailId,
  type OpenRouterPrivacyAttestationPayload,
} from '@timeline/shared/llm';

import {
  resolveTranscriptionEvalAudioPath,
  TRANSCRIPTION_EVAL_FORMATS,
  TRANSCRIPTION_EVAL_SCENARIOS,
  TRANSCRIPTION_EVAL_SOURCES,
  type LoadedTranscriptionEvalManifest,
  type TranscriptionEvalCase,
  type TranscriptionEvalFormat,
} from '#src/transcription-eval/manifest.js';
import {
  aggregateTranscriptionEvalMetrics,
  type TranscriptionEvalAggregateMetrics,
  type TranscriptionEvalErrorCategory,
  type TranscriptionEvalObservation,
  type TranscriptionEvalTransportSuccess,
} from '#src/transcription-eval/metrics.js';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_CORPUS_AUDIO_BYTES = 512 * 1024 * 1024;
const EPSILON = 1e-9;

export const TRANSCRIPTION_QUALITY_GATES = {
  macroErrorRegressionPoints: 0.5,
  sliceErrorRegressionPoints: 2,
  entityAccuracyRegressionPoints: 1,
  numberAccuracyRegressionPoints: 1,
  latencyRegressionFraction: 0.15,
} as const;

export interface TranscriptionEvalTransportRequest {
  modelId: string;
  audio: Buffer;
  format: TranscriptionEvalFormat;
  timeoutMs: number;
}

export interface TranscriptionEvalTransport {
  inspectZdrRoutes(
    modelIds: readonly string[],
  ): Promise<ReadonlyMap<string, TranscriptionEvalZdrRoutes>>;
  transcribe(input: TranscriptionEvalTransportRequest): Promise<TranscriptionEvalTransportSuccess>;
}

export interface TranscriptionEvalZdrRoutes {
  endpointCount: number;
  providers: readonly string[];
  tags: readonly string[];
  inventoryStatus: 'verified' | 'unavailable' | 'invalid';
  inventoryEndpointCount: number;
  inventoryTags: readonly string[];
  matchedZdrEndpointCount: number;
  nonZdrEndpointCount: number;
  allEligibleEndpointsZdr: boolean;
}

export class TranscriptionEvalRequestError extends Error {
  readonly category: TranscriptionEvalErrorCategory;
  readonly latencyMs: number;

  constructor(category: TranscriptionEvalErrorCategory, latencyMs: number) {
    super(`Transcription evaluation request failed (${category})`);
    this.name = 'TranscriptionEvalRequestError';
    this.category = category;
    this.latencyMs = latencyMs;
  }
}

export class TranscriptionQualityEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionQualityEvalError';
  }
}

interface TranscriptionQualityGateCheck {
  id:
    | 'entity_accuracy'
    | 'endpoint_isolation'
    | 'error_rates'
    | 'language_slice_cer'
    | 'language_slice_wer'
    | 'macro_cer'
    | 'macro_wer'
    | 'number_accuracy'
    | 'p95_latency'
    | 'request_budget'
    | 'actual_zdr_routes'
    | 'source_slice_cer'
    | 'source_slice_wer'
    | 'zdr_registry';
  passed: boolean;
  baseline: number | null;
  candidate: number | null;
  limit: number | null;
  worstSlice?: string;
}

interface TranscriptionQualityModelEvidence {
  modelId: string;
  role: 'baseline' | 'candidate';
  zdrEndpointCount: number;
  zdrProviderCount: number;
  zdrProviderSetSha256: string | null;
  endpointIsolation: TranscriptionEndpointIsolationEvidence;
  actualRouteVerification: TranscriptionActualRouteVerification;
  metrics: TranscriptionEvalAggregateMetrics | null;
  gateChecks: TranscriptionQualityGateCheck[];
  eligible: boolean;
  rank: number | null;
}

interface TranscriptionEndpointIsolationEvidence {
  requiredForEvaluation: boolean;
  inventoryStatus: TranscriptionEvalZdrRoutes['inventoryStatus'];
  inventoryEndpointCount: number;
  matchedZdrEndpointCount: number;
  nonZdrEndpointCount: number;
  zdrTagSetSha256: string | null;
  inventoryTagSetSha256: string | null;
  allEligibleEndpointsZdr: boolean;
}

interface TranscriptionActualRouteVerification {
  requiredForRecommendation: boolean;
  successfulRequestCount: number;
  verifiedZdrRequestCount: number;
  missingRouteMetadataCount: number;
  nonZdrRouteCount: number;
  allSuccessfulRequestsVerified: boolean;
  observedRoutes: {
    provider: string;
    count: number;
    listedForModelInZdrRegistry: boolean;
  }[];
}

export interface TranscriptionQualityEvalReport {
  schemaVersion: 'transcription-quality-eval-v1';
  generatedAt: string;
  corpus: {
    manifestSha256: string;
    audioSha256: string;
    fixtureOrigin: 'synthetic' | 'licensed' | 'explicitly_approved';
    caseCount: number;
    languageCount: number;
    languageFamilyCount: number;
    formats: readonly string[];
    sources: readonly string[];
    scenarios: readonly string[];
  };
  baselineModelId: string;
  candidateModelIds: string[];
  languageHintMode: 'auto_detect';
  privacyPolicyAttestation: {
    format: typeof OPENROUTER_PRIVACY_ATTESTATION_FORMAT;
    policyVersion: typeof TIMELINE_AI_PRIVACY_POLICY_VERSION;
    catalogSha256: string;
    inferenceKeyFingerprintSha256: string;
    guardrailId: string;
    evidenceKind: 'operator_attestation';
    isProviderProof: false;
  };
  requestBudgetMs: number;
  thresholds: typeof TRANSCRIPTION_QUALITY_GATES;
  models: TranscriptionQualityModelEvidence[];
  ranking: string[];
  selection: {
    status: 'candidate_passed' | 'no_candidate_passed';
    recommendedModelId: string | null;
  };
}

export interface RunTranscriptionQualityEvalInput {
  loadedManifest: LoadedTranscriptionEvalManifest;
  baselineModelId: string;
  candidateModelIds: readonly string[];
  privacyPolicyAttestation: OpenRouterPrivacyAttestationPayload;
  requestBudgetMs: number;
  concurrency?: number;
}

export interface RunTranscriptionQualityEvalDeps {
  transport: TranscriptionEvalTransport;
  readAudio?: (path: string) => Promise<Buffer>;
  resolveAudioPath?: (manifestDirectory: string, audioPath: string) => Promise<string>;
  now?: () => Date;
}

interface BufferedFixture {
  fixture: TranscriptionEvalCase;
  audio: Buffer;
}

interface ModelRun {
  modelId: string;
  role: 'baseline' | 'candidate';
  zdrEndpointCount: number;
  zdrProviders: readonly string[];
  endpointIsolation: TranscriptionEndpointIsolationEvidence;
  observations: TranscriptionEvalObservation[];
  metrics: TranscriptionEvalAggregateMetrics | null;
}

function validateModelId(modelId: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/iu.test(modelId)) {
    throw new TranscriptionQualityEvalError(`Invalid OpenRouter model ID: ${modelId}`);
  }
}

function validateInput(input: RunTranscriptionQualityEvalInput): void {
  validateModelId(input.baselineModelId);
  if (input.baselineModelId !== TIMELINE_MODELS.transcription.id) {
    throw new TranscriptionQualityEvalError(
      `Baseline must match the production transcription model ${TIMELINE_MODELS.transcription.id}`,
    );
  }
  const attestation = input.privacyPolicyAttestation as unknown as Record<string, unknown>;
  if (
    attestation.format !== OPENROUTER_PRIVACY_ATTESTATION_FORMAT ||
    attestation.policyVersion !== TIMELINE_AI_PRIVACY_POLICY_VERSION ||
    attestation.catalogSha256 !== OPENROUTER_MODEL_CATALOG_SHA256 ||
    typeof attestation.inferenceKeyFingerprintSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(attestation.inferenceKeyFingerprintSha256) ||
    typeof attestation.guardrailId !== 'string' ||
    !isValidOpenRouterGuardrailId(attestation.guardrailId)
  ) {
    throw new TranscriptionQualityEvalError(
      'Privacy policy attestation must match the current model catalog and privacy policy',
    );
  }
  if (input.candidateModelIds.length === 0) {
    throw new TranscriptionQualityEvalError('At least one candidate model is required');
  }
  const models = new Set<string>([input.baselineModelId]);
  for (const candidate of input.candidateModelIds) {
    validateModelId(candidate);
    if (models.has(candidate)) {
      throw new TranscriptionQualityEvalError('Baseline and candidate model IDs must be unique');
    }
    models.add(candidate);
  }
  if (!Number.isInteger(input.requestBudgetMs) || input.requestBudgetMs < 1_000) {
    throw new TranscriptionQualityEvalError('Request budget must be an integer of at least 1000ms');
  }
  const concurrency = input.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new TranscriptionQualityEvalError('Concurrency must be an integer from 1 to 8');
  }
}

async function bufferCorpus(
  loaded: LoadedTranscriptionEvalManifest,
  readAudio: (path: string) => Promise<Buffer>,
  resolveAudioPath: (manifestDirectory: string, audioPath: string) => Promise<string>,
): Promise<{ fixtures: BufferedFixture[]; audioSha256: string }> {
  const fixtures: BufferedFixture[] = [];
  const hash = createHash('sha256');
  let totalBytes = 0;

  for (const fixture of loaded.manifest.cases) {
    const audioPath = await resolveAudioPath(loaded.manifestDirectory, fixture.audioPath);
    let audio: Buffer;
    try {
      audio = await readAudio(audioPath);
    } catch (error) {
      throw new TranscriptionQualityEvalError(
        `Could not read a corpus audio fixture (${error instanceof Error ? error.name : 'unknown error'})`,
      );
    }
    if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
      throw new TranscriptionQualityEvalError(
        'Every audio fixture must be between 1 byte and 25 MB',
      );
    }
    totalBytes += audio.byteLength;
    if (totalBytes > MAX_CORPUS_AUDIO_BYTES) {
      throw new TranscriptionQualityEvalError('Corpus audio exceeds the 512 MB safety limit');
    }
    const byteLength = Buffer.allocUnsafe(8);
    byteLength.writeBigUInt64BE(BigInt(audio.byteLength));
    hash.update(byteLength);
    hash.update(audio);
    fixtures.push({ fixture, audio });
  }

  return { fixtures, audioSha256: hash.digest('hex') };
}

function stableJobKey(modelId: string, caseId: string, manifestSha256: string): string {
  return createHash('sha256')
    .update(manifestSha256)
    .update('\u0000')
    .update(modelId)
    .update('\u0000')
    .update(caseId)
    .digest('hex');
}

async function runWithConcurrency<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < jobs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const job = jobs[index];
      if (!job) continue;
      results[index] = await job();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}

function failureObservation(
  fixture: TranscriptionEvalCase,
  error: unknown,
): TranscriptionEvalObservation {
  if (error instanceof TranscriptionEvalRequestError) {
    return {
      fixture,
      outcome: { ok: false, latencyMs: error.latencyMs, errorCategory: error.category },
    };
  }
  return {
    fixture,
    outcome: { ok: false, latencyMs: 0, errorCategory: 'provider' },
  };
}

function asPoints(value: number): number {
  return value * 100;
}

function nullableCheck(
  id: TranscriptionQualityGateCheck['id'],
  baseline: number | null,
  candidate: number | null,
  limit: number,
  compare: (candidateValue: number, baselineValue: number, limitValue: number) => boolean,
): TranscriptionQualityGateCheck {
  return {
    id,
    passed: baseline !== null && candidate !== null && compare(candidate, baseline, limit),
    baseline,
    candidate,
    limit,
  };
}

interface WorstSliceRegression {
  baseline: number | null;
  candidate: number | null;
  regressionPoints: number | null;
  slice?: string;
}

function worstSliceRegression(
  baseline: TranscriptionEvalAggregateMetrics,
  candidate: TranscriptionEvalAggregateMetrics,
  kind: 'language' | 'source',
  metric: 'macroWer' | 'macroCer',
): WorstSliceRegression {
  const baselineSlices = kind === 'language' ? baseline.languageSlices : baseline.sourceSlices;
  const candidateSlices = kind === 'language' ? candidate.languageSlices : candidate.sourceSlices;
  let worst: WorstSliceRegression = { baseline: null, candidate: null, regressionPoints: null };

  for (const baselineSlice of baselineSlices) {
    const key = 'language' in baselineSlice ? baselineSlice.language : baselineSlice.source;
    const candidateSlice = candidateSlices.find((slice) =>
      'language' in slice ? slice.language === key : slice.source === key,
    );
    const baselineValue = baselineSlice[metric];
    const candidateValue = candidateSlice?.[metric] ?? null;
    if (baselineValue === null || candidateValue === null) {
      return {
        baseline: baselineValue,
        candidate: candidateValue,
        regressionPoints: null,
        slice: key,
      };
    }
    const regressionPoints = asPoints(candidateValue - baselineValue);
    if (worst.regressionPoints === null || regressionPoints > worst.regressionPoints) {
      worst = { baseline: baselineValue, candidate: candidateValue, regressionPoints, slice: key };
    }
  }
  return worst;
}

function sliceCheck(
  id: TranscriptionQualityGateCheck['id'],
  regression: WorstSliceRegression,
): TranscriptionQualityGateCheck {
  return {
    id,
    passed:
      regression.regressionPoints !== null &&
      regression.regressionPoints <=
        TRANSCRIPTION_QUALITY_GATES.sliceErrorRegressionPoints + EPSILON,
    baseline: regression.baseline,
    candidate: regression.candidate,
    limit: TRANSCRIPTION_QUALITY_GATES.sliceErrorRegressionPoints,
    ...(regression.slice ? { worstSlice: regression.slice } : {}),
  };
}

function errorRatesPass(
  baseline: TranscriptionEvalAggregateMetrics,
  candidate: TranscriptionEvalAggregateMetrics,
): boolean {
  const metricKeys = [
    'hallucinationRate',
    'emptyOutputRate',
    'truncationRate',
    'requestErrorRate',
    'formatErrorRate',
  ] as const;
  return metricKeys.every((key) => candidate[key] <= baseline[key] + EPSILON);
}

function buildCandidateGateChecks(
  baseline: TranscriptionEvalAggregateMetrics,
  candidate: TranscriptionEvalAggregateMetrics,
  zdrEndpointCount: number,
  zdrProviderCount: number,
  endpointIsolation: TranscriptionEndpointIsolationEvidence,
  actualRouteVerification: TranscriptionActualRouteVerification,
  requestBudgetMs: number,
): TranscriptionQualityGateCheck[] {
  const p95Limit =
    baseline.latencyMs.p95 === null
      ? null
      : baseline.latencyMs.p95 * (1 + TRANSCRIPTION_QUALITY_GATES.latencyRegressionFraction);
  const checks: TranscriptionQualityGateCheck[] = [
    {
      id: 'zdr_registry',
      passed: zdrEndpointCount > 0 && zdrProviderCount > 0,
      baseline: null,
      candidate: zdrEndpointCount,
      limit: 1,
    },
    {
      id: 'endpoint_isolation',
      passed: endpointIsolation.allEligibleEndpointsZdr,
      baseline: null,
      candidate: endpointIsolation.matchedZdrEndpointCount,
      limit: endpointIsolation.inventoryEndpointCount,
    },
    {
      id: 'actual_zdr_routes',
      passed: actualRouteVerification.allSuccessfulRequestsVerified,
      baseline: null,
      candidate: actualRouteVerification.verifiedZdrRequestCount,
      limit: actualRouteVerification.successfulRequestCount,
    },
    nullableCheck(
      'macro_wer',
      baseline.macroWer,
      candidate.macroWer,
      TRANSCRIPTION_QUALITY_GATES.macroErrorRegressionPoints,
      (candidateValue, baselineValue, limit) =>
        asPoints(candidateValue - baselineValue) <= limit + EPSILON,
    ),
    nullableCheck(
      'macro_cer',
      baseline.macroCer,
      candidate.macroCer,
      TRANSCRIPTION_QUALITY_GATES.macroErrorRegressionPoints,
      (candidateValue, baselineValue, limit) =>
        asPoints(candidateValue - baselineValue) <= limit + EPSILON,
    ),
    sliceCheck(
      'language_slice_wer',
      worstSliceRegression(baseline, candidate, 'language', 'macroWer'),
    ),
    sliceCheck(
      'language_slice_cer',
      worstSliceRegression(baseline, candidate, 'language', 'macroCer'),
    ),
    sliceCheck('source_slice_wer', worstSliceRegression(baseline, candidate, 'source', 'macroWer')),
    sliceCheck('source_slice_cer', worstSliceRegression(baseline, candidate, 'source', 'macroCer')),
    nullableCheck(
      'entity_accuracy',
      baseline.entityAccuracy,
      candidate.entityAccuracy,
      TRANSCRIPTION_QUALITY_GATES.entityAccuracyRegressionPoints,
      (candidateValue, baselineValue, limit) =>
        asPoints(baselineValue - candidateValue) <= limit + EPSILON,
    ),
    nullableCheck(
      'number_accuracy',
      baseline.numberAccuracy,
      candidate.numberAccuracy,
      TRANSCRIPTION_QUALITY_GATES.numberAccuracyRegressionPoints,
      (candidateValue, baselineValue, limit) =>
        asPoints(baselineValue - candidateValue) <= limit + EPSILON,
    ),
    {
      id: 'error_rates',
      passed: errorRatesPass(baseline, candidate),
      baseline: Math.max(
        baseline.hallucinationRate,
        baseline.emptyOutputRate,
        baseline.truncationRate,
        baseline.requestErrorRate,
        baseline.formatErrorRate,
      ),
      candidate: Math.max(
        candidate.hallucinationRate,
        candidate.emptyOutputRate,
        candidate.truncationRate,
        candidate.requestErrorRate,
        candidate.formatErrorRate,
      ),
      limit: 0,
    },
    {
      id: 'p95_latency',
      passed:
        p95Limit !== null &&
        candidate.latencyMs.p95 !== null &&
        candidate.latencyMs.p95 <= p95Limit + EPSILON,
      baseline: baseline.latencyMs.p95,
      candidate: candidate.latencyMs.p95,
      limit: p95Limit,
    },
    {
      id: 'request_budget',
      passed:
        candidate.latencyMs.p95 !== null && candidate.latencyMs.p95 <= requestBudgetMs + EPSILON,
      baseline: null,
      candidate: candidate.latencyMs.p95,
      limit: requestBudgetMs,
    },
  ];
  return checks;
}

function normalizedProviderName(provider: string): string {
  return provider.trim().toLocaleLowerCase('und');
}

function hashStringSet(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return createHash('sha256')
    .update(JSON.stringify([...new Set(values)].sort()))
    .digest('hex');
}

function endpointIsolationEvidence(
  routes: TranscriptionEvalZdrRoutes | undefined,
  requiredForEvaluation: boolean,
): TranscriptionEndpointIsolationEvidence {
  return {
    requiredForEvaluation,
    inventoryStatus: routes?.inventoryStatus ?? 'unavailable',
    inventoryEndpointCount: routes?.inventoryEndpointCount ?? 0,
    matchedZdrEndpointCount: routes?.matchedZdrEndpointCount ?? 0,
    nonZdrEndpointCount: routes?.nonZdrEndpointCount ?? 0,
    zdrTagSetSha256: hashStringSet(routes?.tags ?? []),
    inventoryTagSetSha256: hashStringSet(routes?.inventoryTags ?? []),
    allEligibleEndpointsZdr: routes?.allEligibleEndpointsZdr ?? false,
  };
}

function verifyActualRoutes(
  metrics: TranscriptionEvalAggregateMetrics | null,
  zdrProviders: readonly string[],
  requiredForRecommendation: boolean,
): TranscriptionActualRouteVerification {
  const allowed = new Set(zdrProviders.map(normalizedProviderName));
  let successfulRequestCount = 0;
  let verifiedZdrRequestCount = 0;
  let missingRouteMetadataCount = 0;
  let nonZdrRouteCount = 0;
  const observedRoutes: TranscriptionActualRouteVerification['observedRoutes'] = [];

  for (const route of metrics?.routes ?? []) {
    successfulRequestCount += route.count;
    const missing = route.provider === 'unreported';
    const listed = !missing && allowed.has(normalizedProviderName(route.provider));
    if (missing) missingRouteMetadataCount += route.count;
    else if (listed) verifiedZdrRequestCount += route.count;
    else nonZdrRouteCount += route.count;
    observedRoutes.push({
      provider: route.provider,
      count: route.count,
      listedForModelInZdrRegistry: listed,
    });
  }

  return {
    requiredForRecommendation,
    successfulRequestCount,
    verifiedZdrRequestCount,
    missingRouteMetadataCount,
    nonZdrRouteCount,
    allSuccessfulRequestsVerified:
      successfulRequestCount > 0 &&
      missingRouteMetadataCount === 0 &&
      nonZdrRouteCount === 0 &&
      verifiedZdrRequestCount === successfulRequestCount,
    observedRoutes,
  };
}

function combinedError(metrics: TranscriptionEvalAggregateMetrics): number {
  return metrics.macroWer === null || metrics.macroCer === null
    ? Number.POSITIVE_INFINITY
    : (metrics.macroWer + metrics.macroCer) / 2;
}

function nullAs(metrics: number | null, fallback: number): number {
  return metrics ?? fallback;
}

function compareEligibleModels(
  left: TranscriptionQualityModelEvidence,
  right: TranscriptionQualityModelEvidence,
): number {
  if (!left.metrics || !right.metrics) return left.modelId.localeCompare(right.modelId);
  const tupleLeft = [
    combinedError(left.metrics),
    -nullAs(left.metrics.entityAccuracy, -1),
    -nullAs(left.metrics.numberAccuracy, -1),
    -left.metrics.coverageRate,
    nullAs(left.metrics.latencyMs.p95, Number.POSITIVE_INFINITY),
    -left.metrics.availabilityRate,
    nullAs(left.metrics.costUsd.mean, Number.POSITIVE_INFINITY),
  ];
  const tupleRight = [
    combinedError(right.metrics),
    -nullAs(right.metrics.entityAccuracy, -1),
    -nullAs(right.metrics.numberAccuracy, -1),
    -right.metrics.coverageRate,
    nullAs(right.metrics.latencyMs.p95, Number.POSITIVE_INFINITY),
    -right.metrics.availabilityRate,
    nullAs(right.metrics.costUsd.mean, Number.POSITIVE_INFINITY),
  ];
  for (const [index, leftValue] of tupleLeft.entries()) {
    const rightValue = tupleRight[index];
    if (rightValue !== undefined && leftValue !== rightValue) return leftValue - rightValue;
  }
  return left.modelId.localeCompare(right.modelId);
}

function reportCorpus(
  input: RunTranscriptionQualityEvalInput,
  audioSha256: string,
): TranscriptionQualityEvalReport['corpus'] {
  const manifest = input.loadedManifest.manifest;
  return {
    manifestSha256: input.loadedManifest.manifestSha256,
    audioSha256,
    fixtureOrigin: manifest.fixturePolicy.origin,
    caseCount: manifest.cases.length,
    languageCount: new Set(manifest.cases.map((fixture) => fixture.language.toLowerCase())).size,
    languageFamilyCount: new Set(manifest.cases.map((fixture) => fixture.languageFamily)).size,
    formats: TRANSCRIPTION_EVAL_FORMATS,
    sources: TRANSCRIPTION_EVAL_SOURCES,
    scenarios: TRANSCRIPTION_EVAL_SCENARIOS,
  };
}

/**
 * Run an interleaved provider-backed bake-off and emit only aggregate evidence.
 * All corpus files are validated and buffered before network access, and models
 * without a currently listed ZDR endpoint are not sent fixture audio. Candidate
 * audio is sent only when every endpoint in the authenticated inventory has an
 * exact model/tag match in the ZDR registry. Recommendations additionally
 * require every successful request's generation metadata provider to match that
 * model's live ZDR provider set.
 */
export async function runTranscriptionQualityEval(
  input: RunTranscriptionQualityEvalInput,
  deps: RunTranscriptionQualityEvalDeps,
): Promise<TranscriptionQualityEvalReport> {
  validateInput(input);
  const readAudio = deps.readAudio ?? readFile;
  const resolveAudioPath = deps.resolveAudioPath ?? resolveTranscriptionEvalAudioPath;
  const { fixtures, audioSha256 } = await bufferCorpus(
    input.loadedManifest,
    readAudio,
    resolveAudioPath,
  );
  const allModelIds = [input.baselineModelId, ...input.candidateModelIds];
  const zdrRoutes = await deps.transport.inspectZdrRoutes(input.candidateModelIds);
  const modelRuns: ModelRun[] = allModelIds.map((modelId, index) => ({
    modelId,
    role: index === 0 ? 'baseline' : 'candidate',
    zdrEndpointCount: zdrRoutes.get(modelId)?.endpointCount ?? 0,
    zdrProviders: zdrRoutes.get(modelId)?.providers ?? [],
    endpointIsolation: endpointIsolationEvidence(zdrRoutes.get(modelId), index !== 0),
    observations: [],
    metrics: null,
  }));
  const evaluatedRuns = modelRuns.filter(
    (run) =>
      run.role === 'baseline' ||
      (run.zdrEndpointCount > 0 && run.endpointIsolation.allEligibleEndpointsZdr),
  );

  const jobs = evaluatedRuns
    .flatMap((run) =>
      fixtures.map(({ fixture, audio }) => ({
        key: stableJobKey(run.modelId, fixture.id, input.loadedManifest.manifestSha256),
        run,
        fixture,
        audio,
      })),
    )
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(({ run, fixture, audio }) => async () => {
      let observation: TranscriptionEvalObservation;
      try {
        const outcome = await deps.transport.transcribe({
          modelId: run.modelId,
          audio,
          format: fixture.format,
          timeoutMs: input.requestBudgetMs,
        });
        observation = { fixture, outcome };
      } catch (error) {
        observation = failureObservation(fixture, error);
      }
      return { run, observation };
    });

  const completed = await runWithConcurrency(jobs, input.concurrency ?? 2);
  for (const { run, observation } of completed) run.observations.push(observation);
  for (const run of evaluatedRuns) {
    run.metrics = aggregateTranscriptionEvalMetrics(run.observations);
  }

  const baselineRun = modelRuns[0];
  if (!baselineRun?.metrics) {
    throw new TranscriptionQualityEvalError('Baseline did not produce evaluation metrics');
  }
  const baselineMetrics = baselineRun.metrics;
  const evidence: TranscriptionQualityModelEvidence[] = modelRuns.map((run) => {
    const actualRouteVerification = verifyActualRoutes(
      run.metrics,
      run.zdrProviders,
      run.role === 'candidate',
    );
    if (run.role === 'baseline') {
      return {
        modelId: run.modelId,
        role: run.role,
        zdrEndpointCount: run.zdrEndpointCount,
        zdrProviderCount: run.zdrProviders.length,
        zdrProviderSetSha256: hashStringSet(run.zdrProviders),
        endpointIsolation: run.endpointIsolation,
        actualRouteVerification,
        metrics: run.metrics,
        gateChecks: [],
        eligible: false,
        rank: null,
      };
    }
    const gateChecks = run.metrics
      ? buildCandidateGateChecks(
          baselineMetrics,
          run.metrics,
          run.zdrEndpointCount,
          run.zdrProviders.length,
          run.endpointIsolation,
          actualRouteVerification,
          input.requestBudgetMs,
        )
      : [
          {
            id: 'zdr_registry' as const,
            passed: run.zdrEndpointCount > 0 && run.zdrProviders.length > 0,
            baseline: null,
            candidate: run.zdrEndpointCount,
            limit: 1,
          },
          {
            id: 'endpoint_isolation' as const,
            passed: run.endpointIsolation.allEligibleEndpointsZdr,
            baseline: null,
            candidate: run.endpointIsolation.matchedZdrEndpointCount,
            limit: run.endpointIsolation.inventoryEndpointCount,
          },
          {
            id: 'actual_zdr_routes' as const,
            passed: false,
            baseline: null,
            candidate: 0,
            limit: 1,
          },
        ];
    return {
      modelId: run.modelId,
      role: run.role,
      zdrEndpointCount: run.zdrEndpointCount,
      zdrProviderCount: run.zdrProviders.length,
      zdrProviderSetSha256: hashStringSet(run.zdrProviders),
      endpointIsolation: run.endpointIsolation,
      actualRouteVerification,
      metrics: run.metrics,
      gateChecks,
      eligible: gateChecks.every((check) => check.passed),
      rank: null,
    };
  });

  const ranked = evidence.filter((model) => model.eligible).sort(compareEligibleModels);
  for (const [index, model] of ranked.entries()) model.rank = index + 1;

  return {
    schemaVersion: 'transcription-quality-eval-v1',
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    corpus: reportCorpus(input, audioSha256),
    baselineModelId: input.baselineModelId,
    candidateModelIds: [...input.candidateModelIds],
    languageHintMode: 'auto_detect',
    privacyPolicyAttestation: {
      format: input.privacyPolicyAttestation.format,
      policyVersion: input.privacyPolicyAttestation.policyVersion,
      catalogSha256: input.privacyPolicyAttestation.catalogSha256,
      inferenceKeyFingerprintSha256: input.privacyPolicyAttestation.inferenceKeyFingerprintSha256,
      guardrailId: input.privacyPolicyAttestation.guardrailId,
      evidenceKind: 'operator_attestation',
      isProviderProof: false,
    },
    requestBudgetMs: input.requestBudgetMs,
    thresholds: TRANSCRIPTION_QUALITY_GATES,
    models: evidence,
    ranking: ranked.map(({ modelId }) => modelId),
    selection: {
      status: ranked.length > 0 ? 'candidate_passed' : 'no_candidate_passed',
      recommendedModelId: ranked[0]?.modelId ?? null,
    },
  };
}
