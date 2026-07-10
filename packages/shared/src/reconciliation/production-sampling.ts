import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type Db, reconciliationRuns } from '@timeline/db';

import type { LiveEvalArtifact, LiveEvalRunManifest } from '#src/reconciliation/live-artifacts.js';

import { summarizeLiveEvalManifestCases } from '#src/reconciliation/live-artifact-manifest-summary.js';
import { stableSha256Digest } from '#src/reconciliation/stable-digest.js';

export type ProductionSamplingRunKind = 'closed_beta' | 'post_deploy' | 'manual';

export interface ProductionSamplingLatency {
  caseName: string;
  packetFingerprint: string;
  timeToReconciledOutputMs: number;
}

export interface ProductionSamplingEvalReportInput {
  manifests: LiveEvalRunManifest[];
  artifacts: LiveEvalArtifact[];
  generatedAt: string;
  runKind?: ProductionSamplingRunKind;
  latencies?: ProductionSamplingLatency[];
  confirmedFixtureCandidates?: { caseName: string; packetFingerprint: string }[];
}

export interface ProductionSamplingIgnoredArtifactFile {
  path: string;
  reason: string;
}

export interface LoadedProductionSamplingEvalArtifacts {
  manifests: LiveEvalRunManifest[];
  artifacts: LiveEvalArtifact[];
  reports: ProductionSamplingEvalReport[];
  ignoredFiles: ProductionSamplingIgnoredArtifactFile[];
}

export interface LoadProductionSamplingEvalArtifactsInput {
  inputPaths: string[];
}

export interface WriteProductionSamplingEvalReportInput extends Omit<
  ProductionSamplingEvalReportInput,
  'manifests' | 'artifacts' | 'generatedAt'
> {
  inputPaths: string[];
  outputPath: string;
  generatedAt?: string;
  db?: DbOrTx;
  teamId?: string;
}

export interface WrittenProductionSamplingEvalReport {
  path: string;
  report: ProductionSamplingEvalReport;
  loaded: LoadedProductionSamplingEvalArtifacts;
  runId?: string;
}

export interface ProductionSamplingBucket {
  name: string;
  sampleCount: number;
  passedCount: number;
  failedCount: number;
  passRate: number | null;
  requiredObjectsMissed: number;
  requiredSuggestionsMissed: number;
  requiredArtifactKindsMissed: number;
  extraDangerousSuggestions: number;
  citationFailures: number;
  visibilityFailures: number;
  authorityPolicyViolations: number;
  promptModelRegressions: number;
  averageTimeToReconciledOutputMs: number | null;
}

export interface ProductionSamplingFixtureCandidate {
  caseName: string;
  packetFingerprint: string;
  scenarioFamily: string | null;
  ingestionSurfaces: string[];
  reasonCodes: string[];
  suggestedFixtureName: string;
  confirmed: boolean;
}

export interface ProductionSamplingEvalReport {
  schemaVersion: 2;
  runKind: ProductionSamplingRunKind;
  generatedAt: string;
  manifestCount: number;
  sampleCount: number;
  passedCount: number;
  failedCount: number;
  passRate: number | null;
  modelVersions: string[];
  promptVersions: string[];
  byIngestionSurface: ProductionSamplingBucket[];
  byScenarioFamily: ProductionSamplingBucket[];
  totals: Omit<ProductionSamplingBucket, 'name'>;
  fixtureCandidateCount: number;
  confirmedFixtureCandidateCount: number;
  unconfirmedFixtureCandidateCount: number;
  fixtureCandidates: ProductionSamplingFixtureCandidate[];
}

export interface RecordProductionSamplingEvalReportInput {
  db: DbOrTx;
  teamId: string;
  report: ProductionSamplingEvalReport;
  outputPath?: string;
  ignoredFiles?: ProductionSamplingIgnoredArtifactFile[];
}

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

const PRODUCTION_SAMPLING_RUN_ENGINE_VERSION = 'production-sampling-report-v2';

interface ClassifiedSample {
  artifact: LiveEvalArtifact;
  passed: boolean;
  reasonCodes: string[];
  requiredObjectsMissed: boolean;
  requiredSuggestionsMissed: boolean;
  requiredArtifactKindsMissed: boolean;
  extraDangerousSuggestions: boolean;
  citationFailure: boolean;
  visibilityFailure: boolean;
  authorityPolicyViolation: boolean;
  promptModelRegression: boolean;
  timeToReconciledOutputMs: number | null;
}

export function buildProductionSamplingEvalReport(
  input: ProductionSamplingEvalReportInput,
): ProductionSamplingEvalReport {
  const sortedArtifacts = [...input.artifacts].sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.caseName.localeCompare(right.caseName),
  );
  const latencies = new Map(
    (input.latencies ?? []).map((latency) => [
      sampleKey(latency.caseName, latency.packetFingerprint),
      latency.timeToReconciledOutputMs,
    ]),
  );
  const confirmed = new Set(
    (input.confirmedFixtureCandidates ?? []).map((candidate) =>
      sampleKey(candidate.caseName, candidate.packetFingerprint),
    ),
  );
  const previouslyPassedPackets = new Set<string>();
  const classified: ClassifiedSample[] = [];
  for (const artifact of sortedArtifacts) {
    const key = sampleKey(artifact.caseName, artifact.packetFingerprint);
    const sample = classifySample({
      artifact,
      previousPassedPacket: previouslyPassedPackets.has(key),
      timeToReconciledOutputMs: latencies.get(key) ?? null,
    });
    if (sample.passed) previouslyPassedPackets.add(key);
    classified.push(sample);
  }
  const fixtureCandidates = classified
    .filter((sample) => !sample.passed)
    .map((sample) => ({
      caseName: sample.artifact.caseName,
      packetFingerprint: sample.artifact.packetFingerprint,
      scenarioFamily: sample.artifact.scenarioFamily,
      ingestionSurfaces: [...sample.artifact.ingestionSurfaces],
      reasonCodes: [...sample.reasonCodes],
      suggestedFixtureName: deterministicFixtureName(sample.artifact),
      confirmed: confirmed.has(
        sampleKey(sample.artifact.caseName, sample.artifact.packetFingerprint),
      ),
    }))
    .sort((left, right) => left.caseName.localeCompare(right.caseName));
  const confirmedFixtureCandidateCount = fixtureCandidates.filter(
    (candidate) => candidate.confirmed,
  ).length;

  return {
    schemaVersion: 2,
    runKind: input.runKind ?? 'manual',
    generatedAt: input.generatedAt,
    manifestCount: input.manifests.length,
    sampleCount: classified.length,
    passedCount: classified.filter((sample) => sample.passed).length,
    failedCount: classified.filter((sample) => !sample.passed).length,
    passRate: passRate(classified),
    modelVersions: uniqueSorted([
      ...input.manifests.map((manifest) => manifest.modelId),
      ...input.artifacts.map((artifact) => artifact.modelId),
    ]),
    promptVersions: uniqueSorted([
      ...input.manifests.map((manifest) => manifest.promptVersion),
      ...input.artifacts.map((artifact) => artifact.promptVersion),
      ...input.artifacts.flatMap((artifact) => artifact.judge?.promptVersion ?? []),
    ]),
    byIngestionSurface: bucketsBy(classified, (sample) => sample.artifact.ingestionSurfaces),
    byScenarioFamily: bucketsBy(classified, (sample) =>
      sample.artifact.scenarioFamily ? [sample.artifact.scenarioFamily] : ['unknown'],
    ),
    totals: bucketFor('all', classified),
    fixtureCandidateCount: fixtureCandidates.length,
    confirmedFixtureCandidateCount,
    unconfirmedFixtureCandidateCount: fixtureCandidates.length - confirmedFixtureCandidateCount,
    fixtureCandidates,
  };
}

export async function loadProductionSamplingEvalArtifacts(
  input: LoadProductionSamplingEvalArtifactsInput,
): Promise<LoadedProductionSamplingEvalArtifacts> {
  const loaded: LoadedProductionSamplingEvalArtifacts = {
    manifests: [],
    artifacts: [],
    reports: [],
    ignoredFiles: [],
  };
  const seenArtifacts = new Set<string>();
  const seenReports = new Set<string>();

  for (const inputPath of input.inputPaths) {
    await loadProductionSamplingInputPath(
      path.resolve(inputPath),
      loaded,
      seenArtifacts,
      seenReports,
    );
  }

  return loaded;
}

export async function writeProductionSamplingEvalReport(
  input: WriteProductionSamplingEvalReportInput,
): Promise<WrittenProductionSamplingEvalReport> {
  const loaded = await loadProductionSamplingEvalArtifacts({ inputPaths: input.inputPaths });
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const reportInput: Parameters<typeof buildProductionSamplingReportFromLoaded>[0] = {
    loaded,
    generatedAt,
  };
  if (input.runKind) reportInput.runKind = input.runKind;
  if (input.latencies) reportInput.latencies = input.latencies;
  if (input.confirmedFixtureCandidates) {
    reportInput.confirmedFixtureCandidates = input.confirmedFixtureCandidates;
  }
  const report = buildProductionSamplingReportFromLoaded(reportInput);
  const outputPath = path.resolve(input.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const runId =
    input.db && input.teamId
      ? await recordProductionSamplingEvalReport({
          db: input.db,
          teamId: input.teamId,
          report,
          outputPath,
          ignoredFiles: loaded.ignoredFiles,
        })
      : undefined;

  return {
    path: outputPath,
    report,
    loaded,
    ...(runId ? { runId } : {}),
  };
}

function buildProductionSamplingReportFromLoaded(input: {
  loaded: LoadedProductionSamplingEvalArtifacts;
  generatedAt: string;
  runKind?: ProductionSamplingRunKind;
  latencies?: ProductionSamplingLatency[];
  confirmedFixtureCandidates?: { caseName: string; packetFingerprint: string }[];
}): ProductionSamplingEvalReport {
  const reports = [...input.loaded.reports];
  if (input.loaded.artifacts.length > 0 || input.loaded.manifests.length > 0) {
    const artifactReportInput: ProductionSamplingEvalReportInput = {
      manifests: input.loaded.manifests,
      artifacts: input.loaded.artifacts,
      generatedAt: input.generatedAt,
    };
    if (input.runKind) artifactReportInput.runKind = input.runKind;
    if (input.latencies) artifactReportInput.latencies = input.latencies;
    if (input.confirmedFixtureCandidates) {
      artifactReportInput.confirmedFixtureCandidates = input.confirmedFixtureCandidates;
    }
    reports.push(buildProductionSamplingEvalReport(artifactReportInput));
  }

  if (reports.length === 0) {
    return buildProductionSamplingEvalReport({
      manifests: [],
      artifacts: [],
      generatedAt: input.generatedAt,
      ...(input.runKind ? { runKind: input.runKind } : {}),
    });
  }

  return mergeProductionSamplingEvalReports(reports, {
    generatedAt: input.generatedAt,
    runKind: input.runKind ?? 'manual',
    confirmedFixtureCandidates: input.confirmedFixtureCandidates ?? [],
  });
}

function mergeProductionSamplingEvalReports(
  reports: ProductionSamplingEvalReport[],
  input: {
    generatedAt: string;
    runKind: ProductionSamplingRunKind;
    confirmedFixtureCandidates: { caseName: string; packetFingerprint: string }[];
  },
): ProductionSamplingEvalReport {
  const fixtureCandidates = mergeFixtureCandidates(
    reports.flatMap((report) => report.fixtureCandidates),
    input.confirmedFixtureCandidates,
  );
  const confirmedFixtureCandidateCount = fixtureCandidates.filter(
    (candidate) => candidate.confirmed,
  ).length;
  const sampleCount = sum(reports, (report) => report.sampleCount);
  const passedCount = sum(reports, (report) => report.passedCount);
  const failedCount = sum(reports, (report) => report.failedCount);

  return {
    schemaVersion: 2,
    runKind: input.runKind,
    generatedAt: input.generatedAt,
    manifestCount: sum(reports, (report) => report.manifestCount),
    sampleCount,
    passedCount,
    failedCount,
    passRate: sampleCount > 0 ? passedCount / sampleCount : null,
    modelVersions: uniqueSorted(reports.flatMap((report) => report.modelVersions)),
    promptVersions: uniqueSorted(reports.flatMap((report) => report.promptVersions)),
    byIngestionSurface: mergeProductionSamplingBuckets(
      reports.flatMap((report) => report.byIngestionSurface),
    ),
    byScenarioFamily: mergeProductionSamplingBuckets(
      reports.flatMap((report) => report.byScenarioFamily),
    ),
    totals: omitBucketName(
      mergeProductionSamplingBucket(
        'all',
        reports.map((report) => ({ name: 'all', ...report.totals })),
      ),
    ),
    fixtureCandidateCount: fixtureCandidates.length,
    confirmedFixtureCandidateCount,
    unconfirmedFixtureCandidateCount: fixtureCandidates.length - confirmedFixtureCandidateCount,
    fixtureCandidates,
  };
}

export async function recordProductionSamplingEvalReport(
  input: RecordProductionSamplingEvalReportInput,
): Promise<string> {
  const now = new Date(input.report.generatedAt);
  const completedAt = Number.isNaN(now.getTime()) ? new Date() : now;
  const metrics = productionSamplingRunMetrics(input);
  const [run] = await input.db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'eval',
      scope: `production_sampling:${input.report.runKind}`,
      status: 'completed',
      inputFingerprint: productionSamplingRunFingerprint(input.teamId, input.report),
      engineVersion: PRODUCTION_SAMPLING_RUN_ENGINE_VERSION,
      modelVersions: input.report.modelVersions,
      startedAt: completedAt,
      completedAt,
      metrics,
    })
    .onConflictDoUpdate({
      target: [
        reconciliationRuns.teamId,
        reconciliationRuns.inputFingerprint,
        reconciliationRuns.engineVersion,
      ],
      set: {
        status: 'completed',
        startedAt: completedAt,
        completedAt,
        errorCode: null,
        modelVersions: input.report.modelVersions,
        metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) throw new Error('Failed to record production sampling reconciliation run');
  return run.id;
}

function classifySample(input: {
  artifact: LiveEvalArtifact;
  previousPassedPacket: boolean;
  timeToReconciledOutputMs: number | null;
}): ClassifiedSample {
  const artifact = input.artifact;
  const baseReasonCodes = uniqueSorted([
    ...artifact.failures.flatMap(failureReasonCodes),
    ...(artifact.judge?.failureCodes ?? []),
    ...(artifact.actual.privacyRisk ? ['privacy_leak'] : []),
    ...(artifact.judge?.privacyConcern ? ['privacy_leak'] : []),
    ...artifactConsistencyReasonCodes(artifact),
  ]);
  const basePassed = artifact.passed && baseReasonCodes.length === 0;
  const promptModelRegression = !basePassed && input.previousPassedPacket;
  const reasonCodes = uniqueSorted([
    ...baseReasonCodes,
    ...(promptModelRegression ? ['prompt_model_regression'] : []),
  ]);
  const expectedDirectWrite = (artifact.expected.outputKindCounts.direct_write ?? 0) > 0;
  const expectedApproval = (artifact.expected.outputKindCounts.approval_bundle ?? 0) > 0;

  return {
    artifact,
    passed: basePassed && !promptModelRegression,
    reasonCodes,
    requiredObjectsMissed:
      expectedDirectWrite &&
      (reasonCodes.includes('missing_required_output') ||
        artifact.failures.some((failure) => failure.includes('missing direct write'))),
    requiredSuggestionsMissed:
      expectedApproval &&
      (reasonCodes.includes('missing_required_output') ||
        reasonCodes.includes('approval_policy_wrong') ||
        artifact.failures.some((failure) => failure.includes('approvalRequired'))),
    requiredArtifactKindsMissed:
      reasonCodes.includes('artifact_kind_mismatch') ||
      artifact.failures.some((failure) => failure.includes('artifact cluster kind')),
    extraDangerousSuggestions:
      reasonCodes.includes('irrelevant_output') ||
      artifact.failures.some((failure) => failure.includes('unexpected output')),
    citationFailure:
      reasonCodes.includes('source_ref_mismatch') ||
      artifact.failures.some((failure) => failure.includes('source ref')),
    visibilityFailure: reasonCodes.includes('privacy_leak'),
    authorityPolicyViolation:
      reasonCodes.includes('unsupported_direct_write') ||
      reasonCodes.includes('approval_policy_wrong'),
    promptModelRegression,
    timeToReconciledOutputMs: input.timeToReconciledOutputMs,
  };
}

async function loadProductionSamplingInputPath(
  inputPath: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
  seenReports: Set<string>,
): Promise<void> {
  let inputStat;
  try {
    inputStat = await stat(inputPath);
  } catch (error) {
    loaded.ignoredFiles.push({ path: inputPath, reason: `unreadable: ${errorMessage(error)}` });
    return;
  }

  if (inputStat.isDirectory()) {
    await loadProductionSamplingDirectory(inputPath, loaded, seenArtifacts, seenReports);
    return;
  }

  if (!inputStat.isFile()) {
    loaded.ignoredFiles.push({ path: inputPath, reason: 'not a regular file or directory' });
    return;
  }

  await loadProductionSamplingJsonFile(
    inputPath,
    path.dirname(inputPath),
    loaded,
    seenArtifacts,
    seenReports,
  );
}

async function loadProductionSamplingDirectory(
  dir: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
  seenReports: Set<string>,
): Promise<void> {
  const manifestPath = path.join(dir, 'manifest.json');
  const manifestLoaded = await loadProductionSamplingManifest(
    manifestPath,
    dir,
    loaded,
    seenArtifacts,
    { optional: true },
  );

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    loaded.ignoredFiles.push({ path: dir, reason: `unreadable directory: ${errorMessage(error)}` });
    return;
  }

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue;
    if (entry === 'manifest.json') continue;
    if (entry === 'production-sampling-report.json') continue;
    const filePath = path.join(dir, entry);
    if (manifestLoaded && seenArtifacts.has(path.resolve(filePath))) continue;
    await loadProductionSamplingJsonFile(filePath, dir, loaded, seenArtifacts, seenReports);
  }
}

async function loadProductionSamplingJsonFile(
  filePath: string,
  baseDir: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
  seenReports: Set<string>,
): Promise<void> {
  if (path.basename(filePath) === 'manifest.json') {
    await loadProductionSamplingManifest(filePath, baseDir, loaded, seenArtifacts, {
      optional: false,
    });
    return;
  }

  const value = await readJsonFile(filePath, loaded);
  if (!value) return;
  if (!isLiveEvalArtifact(value)) {
    if (isProductionSamplingEvalReport(value)) {
      addProductionSamplingEvalReport(filePath, value, loaded, seenReports);
      return;
    }
    loaded.ignoredFiles.push({
      path: filePath,
      reason: 'not a reconciliation live artifact or production sampling report',
    });
    return;
  }
  addLiveEvalArtifact(filePath, value, loaded, seenArtifacts);
}

async function loadProductionSamplingManifest(
  manifestPath: string,
  baseDir: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
  opts: { optional: boolean },
): Promise<boolean> {
  const value = await readJsonFile(manifestPath, loaded, opts);
  if (!value) return false;
  if (!isLiveEvalRunManifest(value)) {
    loaded.ignoredFiles.push({ path: manifestPath, reason: 'not a reconciliation live manifest' });
    return false;
  }
  loaded.manifests.push(value);

  for (const entry of value.cases) {
    const artifactPath = safeManifestArtifactPath(baseDir, entry.artifactPath);
    if (!artifactPath) {
      loaded.ignoredFiles.push({
        path: path.join(baseDir, entry.artifactPath),
        reason: 'manifest artifact path escapes the run directory',
      });
      continue;
    }
    const artifactValue = await readJsonFile(artifactPath, loaded);
    if (!artifactValue) continue;
    if (!isLiveEvalArtifact(artifactValue)) {
      loaded.ignoredFiles.push({
        path: artifactPath,
        reason: 'manifest entry is not a reconciliation live artifact',
      });
      continue;
    }
    addLiveEvalArtifact(artifactPath, artifactValue, loaded, seenArtifacts);
  }

  return true;
}

async function readJsonFile(
  filePath: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  opts: { optional?: boolean } = {},
): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (!opts.optional) {
      loaded.ignoredFiles.push({ path: filePath, reason: `unreadable: ${errorMessage(error)}` });
    }
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    loaded.ignoredFiles.push({ path: filePath, reason: `invalid json: ${errorMessage(error)}` });
    return null;
  }
}

function addLiveEvalArtifact(
  filePath: string,
  artifact: LiveEvalArtifact,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
): void {
  const resolvedPath = path.resolve(filePath);
  if (seenArtifacts.has(resolvedPath)) return;
  seenArtifacts.add(resolvedPath);
  loaded.artifacts.push(artifact);
}

function addProductionSamplingEvalReport(
  filePath: string,
  report: ProductionSamplingEvalReport,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenReports: Set<string>,
): void {
  const resolvedPath = path.resolve(filePath);
  if (seenReports.has(resolvedPath)) return;
  seenReports.add(resolvedPath);
  loaded.reports.push(report);
}

function mergeProductionSamplingBuckets(
  buckets: ProductionSamplingBucket[],
): ProductionSamplingBucket[] {
  const byName = new Map<string, ProductionSamplingBucket[]>();
  for (const bucket of buckets) {
    const rows = byName.get(bucket.name) ?? [];
    rows.push(bucket);
    byName.set(bucket.name, rows);
  }
  return [...byName.entries()]
    .map(([name, rows]) => mergeProductionSamplingBucket(name, rows))
    .sort(
      (left, right) => right.sampleCount - left.sampleCount || left.name.localeCompare(right.name),
    );
}

function mergeProductionSamplingBucket(
  name: string,
  buckets: ProductionSamplingBucket[],
): ProductionSamplingBucket {
  const sampleCount = sum(buckets, (bucket) => bucket.sampleCount);
  const passedCount = sum(buckets, (bucket) => bucket.passedCount);
  return {
    name,
    sampleCount,
    passedCount,
    failedCount: sum(buckets, (bucket) => bucket.failedCount),
    passRate: sampleCount > 0 ? passedCount / sampleCount : null,
    requiredObjectsMissed: sum(buckets, (bucket) => bucket.requiredObjectsMissed),
    requiredSuggestionsMissed: sum(buckets, (bucket) => bucket.requiredSuggestionsMissed),
    requiredArtifactKindsMissed: sum(buckets, (bucket) => bucket.requiredArtifactKindsMissed),
    extraDangerousSuggestions: sum(buckets, (bucket) => bucket.extraDangerousSuggestions),
    citationFailures: sum(buckets, (bucket) => bucket.citationFailures),
    visibilityFailures: sum(buckets, (bucket) => bucket.visibilityFailures),
    authorityPolicyViolations: sum(buckets, (bucket) => bucket.authorityPolicyViolations),
    promptModelRegressions: sum(buckets, (bucket) => bucket.promptModelRegressions),
    averageTimeToReconciledOutputMs: weightedAverage(
      buckets
        .filter((bucket) => bucket.averageTimeToReconciledOutputMs !== null)
        .map((bucket) => ({
          value: bucket.averageTimeToReconciledOutputMs ?? 0,
          weight: bucket.sampleCount,
        })),
    ),
  };
}

function omitBucketName(bucket: ProductionSamplingBucket): Omit<ProductionSamplingBucket, 'name'> {
  const { name: _name, ...rest } = bucket;
  return rest;
}

function mergeFixtureCandidates(
  candidates: ProductionSamplingFixtureCandidate[],
  confirmedFixtureCandidates: { caseName: string; packetFingerprint: string }[],
): ProductionSamplingFixtureCandidate[] {
  const confirmed = new Set(
    confirmedFixtureCandidates.map((candidate) =>
      sampleKey(candidate.caseName, candidate.packetFingerprint),
    ),
  );
  const bySample = new Map<string, ProductionSamplingFixtureCandidate>();
  for (const candidate of candidates) {
    const key = sampleKey(candidate.caseName, candidate.packetFingerprint);
    const existing = bySample.get(key);
    if (!existing) {
      bySample.set(key, {
        ...candidate,
        ingestionSurfaces: uniqueSorted(candidate.ingestionSurfaces),
        reasonCodes: uniqueSorted(candidate.reasonCodes),
        confirmed: candidate.confirmed || confirmed.has(key),
      });
      continue;
    }
    existing.ingestionSurfaces = uniqueSorted([
      ...existing.ingestionSurfaces,
      ...candidate.ingestionSurfaces,
    ]);
    existing.reasonCodes = uniqueSorted([...existing.reasonCodes, ...candidate.reasonCodes]);
    existing.confirmed = existing.confirmed || candidate.confirmed || confirmed.has(key);
  }
  return [...bySample.values()].sort(
    (left, right) =>
      left.caseName.localeCompare(right.caseName) ||
      left.packetFingerprint.localeCompare(right.packetFingerprint),
  );
}

function weightedAverage(items: { value: number; weight: number }[]): number | null {
  const totalWeight = sum(items, (item) => item.weight);
  if (totalWeight === 0) return null;
  return items.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight;
}

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function productionSamplingRunMetrics(input: RecordProductionSamplingEvalReportInput) {
  const report = input.report;
  return {
    mode: 'production_sampling',
    run_kind: report.runKind,
    output_path: input.outputPath ?? null,
    generated_at: report.generatedAt,
    manifest_count: report.manifestCount,
    sample_count: report.sampleCount,
    passed_count: report.passedCount,
    failed_count: report.failedCount,
    pass_rate: report.passRate,
    fixture_candidate_count: report.fixtureCandidateCount,
    confirmed_fixture_candidate_count: report.confirmedFixtureCandidateCount,
    unconfirmed_fixture_candidate_count: report.unconfirmedFixtureCandidateCount,
    ignored_file_count: input.ignoredFiles?.length ?? 0,
    ignored_files: input.ignoredFiles ?? [],
    model_versions: report.modelVersions,
    prompt_versions: report.promptVersions,
    by_ingestion_surface: report.byIngestionSurface,
    by_scenario_family: report.byScenarioFamily,
    totals: report.totals,
  };
}

function productionSamplingRunFingerprint(
  teamId: string,
  report: ProductionSamplingEvalReport,
): string {
  const digest = stableSha256Digest({
    teamId,
    schemaVersion: report.schemaVersion,
    runKind: report.runKind,
    generatedAt: report.generatedAt,
    manifestCount: report.manifestCount,
    sampleCount: report.sampleCount,
    passedCount: report.passedCount,
    failedCount: report.failedCount,
    fixtureCandidates: report.fixtureCandidates.map((candidate) => ({
      caseName: candidate.caseName,
      packetFingerprint: candidate.packetFingerprint,
      confirmed: candidate.confirmed,
    })),
  })
    .slice('sha256:'.length)
    .slice(0, 32);
  return `production-sampling:${digest}`;
}

function safeManifestArtifactPath(baseDir: string, artifactPath: string): string | null {
  if (path.isAbsolute(artifactPath)) return null;
  const resolvedBase = path.resolve(baseDir);
  const resolvedArtifact = path.resolve(resolvedBase, artifactPath);
  if (resolvedArtifact === resolvedBase) return null;
  if (!resolvedArtifact.startsWith(`${resolvedBase}${path.sep}`)) return null;
  return resolvedArtifact;
}

function isLiveEvalRunManifest(value: unknown): value is LiveEvalRunManifest {
  const record = asRecord(value);
  if (!record) return false;
  return (
    record.schemaVersion === 1 &&
    record.runKind === 'reconciliation_live_eval' &&
    typeof record.modelId === 'string' &&
    typeof record.promptVersion === 'string' &&
    typeof record.startedAt === 'string' &&
    typeof record.completedAt === 'string' &&
    isNonNegativeInteger(record.caseCount) &&
    isNonNegativeInteger(record.passedCount) &&
    isNonNegativeInteger(record.failedCount) &&
    (record.judgeAverageScore === null || isFiniteNumber(record.judgeAverageScore)) &&
    isNonNegativeInteger(record.judgePassedCount) &&
    isNonNegativeInteger(record.judgeFailedCount) &&
    isStringArray(record.scenarioFamilies) &&
    isStringArray(record.ingestionSurfaces) &&
    Array.isArray(record.cases) &&
    record.cases.every(isLiveEvalManifestCase) &&
    hasConsistentLiveEvalManifestSummary(record as unknown as LiveEvalRunManifest)
  );
}

function hasConsistentLiveEvalManifestSummary(manifest: LiveEvalRunManifest): boolean {
  const summary = summarizeLiveEvalManifestCases(manifest.cases);
  return (
    manifest.caseCount === summary.caseCount &&
    manifest.passedCount === summary.passedCount &&
    manifest.failedCount === summary.failedCount &&
    manifest.judgePassedCount === summary.judgePassedCount &&
    manifest.judgeFailedCount === summary.judgeFailedCount &&
    sameStringArray(manifest.scenarioFamilies, summary.scenarioFamilies) &&
    sameStringArray(manifest.ingestionSurfaces, summary.ingestionSurfaces) &&
    sameNullableNumber(manifest.judgeAverageScore, summary.judgeAverageScore)
  );
}

function isLiveEvalManifestCase(value: unknown): boolean {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.caseName === 'string' &&
    typeof record.artifactPath === 'string' &&
    (typeof record.scenarioFamily === 'string' || record.scenarioFamily === null) &&
    isStringArray(record.ingestionSurfaces) &&
    typeof record.passed === 'boolean' &&
    isNonNegativeInteger(record.failureCount) &&
    isStringArray(record.failures) &&
    (record.judgeScore === null || isFiniteNumber(record.judgeScore)) &&
    (typeof record.judgePassed === 'boolean' || record.judgePassed === null) &&
    isStringArray(record.judgeFailureCodes) &&
    typeof record.packetFingerprint === 'string' &&
    typeof record.promptFingerprint === 'string'
  );
}

function isLiveEvalArtifact(value: unknown): value is LiveEvalArtifact {
  const record = asRecord(value);
  const expected = asRecord(record?.expected);
  const actual = asRecord(record?.actual);
  return (
    !!record &&
    record.schemaVersion === 2 &&
    typeof record.caseName === 'string' &&
    (typeof record.scenarioFamily === 'string' || record.scenarioFamily === null) &&
    isStringArray(record.ingestionSurfaces) &&
    typeof record.modelId === 'string' &&
    typeof record.promptVersion === 'string' &&
    typeof record.startedAt === 'string' &&
    typeof record.completedAt === 'string' &&
    typeof record.passed === 'boolean' &&
    isStringArray(record.failures) &&
    typeof record.packetFingerprint === 'string' &&
    typeof record.promptFingerprint === 'string' &&
    (record.judge === null || isLiveEvalJudgeResult(record.judge)) &&
    !!expected &&
    isStringArray(expected.ingestionSurfaces) &&
    isStringNumberRecord(expected.outputKindCounts) &&
    isStringNumberRecord(expected.associationRoleCounts) &&
    isStringArray(expected.requiredArtifactClusterKinds) &&
    isStringArray(expected.requiredSourcePayloadSurfaces) &&
    isStringArray(expected.forbiddenOutputKinds) &&
    !!actual &&
    isStringArray(actual.ingestionSurfaces) &&
    isStringArray(actual.outputKinds) &&
    isStringArray(actual.directWriteSurfaces) &&
    isStringArray(actual.artifactClusterKinds) &&
    typeof actual.approvalRequired === 'boolean' &&
    typeof actual.privacyRisk === 'boolean' &&
    Array.isArray(actual.sourceRefs) &&
    actual.sourceRefs.every(isLiveEvalArtifactSourceRef)
  );
}

function isProductionSamplingEvalReport(value: unknown): value is ProductionSamplingEvalReport {
  const record = asRecord(value);
  if (!record) return false;
  const report = record as unknown as ProductionSamplingEvalReport;
  return (
    record.schemaVersion === 2 &&
    isProductionSamplingRunKind(record.runKind) &&
    typeof record.generatedAt === 'string' &&
    isNonNegativeInteger(record.manifestCount) &&
    isNonNegativeInteger(record.sampleCount) &&
    isNonNegativeInteger(record.passedCount) &&
    isNonNegativeInteger(record.failedCount) &&
    (record.passRate === null || isFiniteNumber(record.passRate)) &&
    isStringArray(record.modelVersions) &&
    isStringArray(record.promptVersions) &&
    Array.isArray(record.byIngestionSurface) &&
    record.byIngestionSurface.every(isProductionSamplingBucket) &&
    Array.isArray(record.byScenarioFamily) &&
    record.byScenarioFamily.every(isProductionSamplingBucket) &&
    isProductionSamplingBucket({ name: 'all', ...asRecord(record.totals) }) &&
    isNonNegativeInteger(record.fixtureCandidateCount) &&
    isNonNegativeInteger(record.confirmedFixtureCandidateCount) &&
    isNonNegativeInteger(record.unconfirmedFixtureCandidateCount) &&
    Array.isArray(record.fixtureCandidates) &&
    record.fixtureCandidates.every(isProductionSamplingFixtureCandidate) &&
    hasConsistentProductionSamplingReportSummary(report)
  );
}

function isProductionSamplingRunKind(value: unknown): value is ProductionSamplingRunKind {
  return value === 'closed_beta' || value === 'post_deploy' || value === 'manual';
}

function isProductionSamplingBucket(value: unknown): value is ProductionSamplingBucket {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.name === 'string' &&
    isNonNegativeInteger(record.sampleCount) &&
    isNonNegativeInteger(record.passedCount) &&
    isNonNegativeInteger(record.failedCount) &&
    (record.passRate === null || isFiniteNumber(record.passRate)) &&
    isNonNegativeInteger(record.requiredObjectsMissed) &&
    isNonNegativeInteger(record.requiredSuggestionsMissed) &&
    isNonNegativeInteger(record.requiredArtifactKindsMissed) &&
    isNonNegativeInteger(record.extraDangerousSuggestions) &&
    isNonNegativeInteger(record.citationFailures) &&
    isNonNegativeInteger(record.visibilityFailures) &&
    isNonNegativeInteger(record.authorityPolicyViolations) &&
    isNonNegativeInteger(record.promptModelRegressions) &&
    (record.averageTimeToReconciledOutputMs === null ||
      isFiniteNumber(record.averageTimeToReconciledOutputMs))
  );
}

function isProductionSamplingFixtureCandidate(
  value: unknown,
): value is ProductionSamplingFixtureCandidate {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.caseName === 'string' &&
    typeof record.packetFingerprint === 'string' &&
    (typeof record.scenarioFamily === 'string' || record.scenarioFamily === null) &&
    isStringArray(record.ingestionSurfaces) &&
    isStringArray(record.reasonCodes) &&
    typeof record.suggestedFixtureName === 'string' &&
    typeof record.confirmed === 'boolean'
  );
}

function hasConsistentProductionSamplingReportSummary(
  report: ProductionSamplingEvalReport,
): boolean {
  return (
    report.sampleCount === report.passedCount + report.failedCount &&
    sameNullableNumber(
      report.passRate,
      report.sampleCount > 0 ? report.passedCount / report.sampleCount : null,
    ) &&
    report.totals.sampleCount === report.sampleCount &&
    report.totals.passedCount === report.passedCount &&
    report.totals.failedCount === report.failedCount &&
    sameNullableNumber(report.totals.passRate, report.passRate) &&
    report.fixtureCandidateCount === report.fixtureCandidates.length &&
    report.confirmedFixtureCandidateCount ===
      report.fixtureCandidates.filter((candidate) => candidate.confirmed).length &&
    report.unconfirmedFixtureCandidateCount ===
      report.fixtureCandidates.filter((candidate) => !candidate.confirmed).length
  );
}

function isLiveEvalArtifactSourceRef(value: unknown): boolean {
  const record = asRecord(value);
  return !!record && isNonEmptyString(record.surface) && isNonEmptyString(record.rawEventHash);
}

function isLiveEvalJudgeResult(value: unknown): boolean {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.modelId === 'string' &&
    typeof record.promptVersion === 'string' &&
    typeof record.score === 'number' &&
    Number.isFinite(record.score) &&
    typeof record.passed === 'boolean' &&
    typeof record.privacyConcern === 'boolean' &&
    isStringArray(record.failureCodes) &&
    isStringArray(record.strengthCodes)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNullableNumber(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < Number.EPSILON;
}

function artifactConsistencyReasonCodes(artifact: LiveEvalArtifact): string[] {
  const reasonCodes: string[] = [];
  const expectedSurfaces = new Set(artifact.expected.ingestionSurfaces);
  const actualSurfaces = new Set(artifact.actual.ingestionSurfaces);
  const sourceRefSurfaces = new Set<string>();
  const sourceRefKeys = new Set<string>();
  let duplicateSourceRef = false;
  for (const ref of artifact.actual.sourceRefs) {
    sourceRefSurfaces.add(ref.surface);
    const key = `${ref.surface}:${ref.rawEventHash}`;
    if (sourceRefKeys.has(key)) duplicateSourceRef = true;
    sourceRefKeys.add(key);
  }

  for (const surface of expectedSurfaces) {
    if (!actualSurfaces.has(surface)) reasonCodes.push('surface_mismatch');
    if (!sourceRefSurfaces.has(surface)) reasonCodes.push('source_ref_mismatch');
  }
  for (const surface of actualSurfaces) {
    if (!expectedSurfaces.has(surface)) reasonCodes.push('surface_mismatch');
    if (!sourceRefSurfaces.has(surface)) reasonCodes.push('source_ref_mismatch');
  }
  for (const surface of sourceRefSurfaces) {
    if (!expectedSurfaces.has(surface)) reasonCodes.push('source_ref_mismatch');
  }
  if (duplicateSourceRef) reasonCodes.push('source_ref_mismatch');

  return reasonCodes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isStringNumberRecord(value: unknown): boolean {
  const record = asRecord(value);
  return !!record && Object.values(record).every(isNonNegativeInteger);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureReasonCodes(failure: string): string[] {
  const text = failure.toLowerCase();
  const codes: string[] = [];
  if (text.includes('missing output') || text.includes('missing direct write')) {
    codes.push('missing_required_output');
  }
  if (text.includes('approvalrequired') || text.includes('approval policy')) {
    codes.push('approval_policy_wrong');
  }
  if (text.includes('source ref') || text.includes('citation')) {
    codes.push('source_ref_mismatch');
  }
  if (text.includes('artifact cluster kind')) {
    codes.push('artifact_kind_mismatch');
  }
  if (text.includes('privacy') || text.includes('visibility')) {
    codes.push('privacy_leak');
  }
  if (text.includes('unsupported direct write')) {
    codes.push('unsupported_direct_write');
  }
  if (text.includes('unexpected output') || text.includes('irrelevant')) {
    codes.push('irrelevant_output');
  }
  return codes;
}

function bucketsBy(
  samples: ClassifiedSample[],
  keyFn: (sample: ClassifiedSample) => string[],
): ProductionSamplingBucket[] {
  const byKey = new Map<string, ClassifiedSample[]>();
  for (const sample of samples) {
    for (const key of keyFn(sample)) {
      const bucket = byKey.get(key) ?? [];
      bucket.push(sample);
      byKey.set(key, bucket);
    }
  }
  return [...byKey.entries()]
    .map(([name, bucketSamples]) => bucketFor(name, bucketSamples))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function bucketFor(name: string, samples: ClassifiedSample[]): ProductionSamplingBucket {
  const latencies = samples.flatMap((sample) =>
    sample.timeToReconciledOutputMs === null ? [] : [sample.timeToReconciledOutputMs],
  );
  return {
    name,
    sampleCount: samples.length,
    passedCount: samples.filter((sample) => sample.passed).length,
    failedCount: samples.filter((sample) => !sample.passed).length,
    passRate: passRate(samples),
    requiredObjectsMissed: samples.filter((sample) => sample.requiredObjectsMissed).length,
    requiredSuggestionsMissed: samples.filter((sample) => sample.requiredSuggestionsMissed).length,
    requiredArtifactKindsMissed: samples.filter((sample) => sample.requiredArtifactKindsMissed)
      .length,
    extraDangerousSuggestions: samples.filter((sample) => sample.extraDangerousSuggestions).length,
    citationFailures: samples.filter((sample) => sample.citationFailure).length,
    visibilityFailures: samples.filter((sample) => sample.visibilityFailure).length,
    authorityPolicyViolations: samples.filter((sample) => sample.authorityPolicyViolation).length,
    promptModelRegressions: samples.filter((sample) => sample.promptModelRegression).length,
    averageTimeToReconciledOutputMs:
      latencies.length > 0
        ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
        : null,
  };
}

function passRate(samples: ClassifiedSample[]): number | null {
  if (samples.length === 0) return null;
  return samples.filter((sample) => sample.passed).length / samples.length;
}

function deterministicFixtureName(artifact: LiveEvalArtifact): string {
  const prefix = artifact.scenarioFamily ?? 'unknown';
  const fingerprint = artifact.packetFingerprint.replace(/^sha256:/, '').slice(0, 12);
  return `${safeFileSegment(prefix)}-${safeFileSegment(artifact.caseName)}-${fingerprint}`;
}

function sampleKey(caseName: string, packetFingerprint: string): string {
  return `${caseName}:${packetFingerprint}`;
}

function safeFileSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
