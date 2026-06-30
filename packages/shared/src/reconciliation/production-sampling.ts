import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { LiveEvalArtifact, LiveEvalRunManifest } from '#src/reconciliation/live-artifacts.js';

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
}

export interface WrittenProductionSamplingEvalReport {
  path: string;
  report: ProductionSamplingEvalReport;
  loaded: LoadedProductionSamplingEvalArtifacts;
}

export interface ProductionSamplingBucket {
  name: string;
  sampleCount: number;
  passedCount: number;
  failedCount: number;
  passRate: number | null;
  requiredObjectsMissed: number;
  requiredSuggestionsMissed: number;
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
  schemaVersion: 1;
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
  fixtureCandidates: ProductionSamplingFixtureCandidate[];
}

interface ClassifiedSample {
  artifact: LiveEvalArtifact;
  reasonCodes: string[];
  requiredObjectsMissed: boolean;
  requiredSuggestionsMissed: boolean;
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
  const classified = sortedArtifacts.map((artifact) => {
    const key = sampleKey(artifact.caseName, artifact.packetFingerprint);
    const promptModelRegression = !artifact.passed && previouslyPassedPackets.has(key);
    if (artifact.passed) previouslyPassedPackets.add(key);
    return classifySample({
      artifact,
      promptModelRegression,
      timeToReconciledOutputMs: latencies.get(key) ?? null,
    });
  });

  return {
    schemaVersion: 1,
    runKind: input.runKind ?? 'manual',
    generatedAt: input.generatedAt,
    manifestCount: input.manifests.length,
    sampleCount: classified.length,
    passedCount: classified.filter((sample) => sample.artifact.passed).length,
    failedCount: classified.filter((sample) => !sample.artifact.passed).length,
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
    fixtureCandidates: classified
      .filter((sample) => !sample.artifact.passed)
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
      .sort((left, right) => left.caseName.localeCompare(right.caseName)),
  };
}

export async function loadProductionSamplingEvalArtifacts(
  input: LoadProductionSamplingEvalArtifactsInput,
): Promise<LoadedProductionSamplingEvalArtifacts> {
  const loaded: LoadedProductionSamplingEvalArtifacts = {
    manifests: [],
    artifacts: [],
    ignoredFiles: [],
  };
  const seenArtifacts = new Set<string>();

  for (const inputPath of input.inputPaths) {
    await loadProductionSamplingInputPath(path.resolve(inputPath), loaded, seenArtifacts);
  }

  return loaded;
}

export async function writeProductionSamplingEvalReport(
  input: WriteProductionSamplingEvalReportInput,
): Promise<WrittenProductionSamplingEvalReport> {
  const loaded = await loadProductionSamplingEvalArtifacts({ inputPaths: input.inputPaths });
  const reportInput: ProductionSamplingEvalReportInput = {
    manifests: loaded.manifests,
    artifacts: loaded.artifacts,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
  if (input.runKind) reportInput.runKind = input.runKind;
  if (input.latencies) reportInput.latencies = input.latencies;
  if (input.confirmedFixtureCandidates) {
    reportInput.confirmedFixtureCandidates = input.confirmedFixtureCandidates;
  }
  const report = buildProductionSamplingEvalReport(reportInput);
  const outputPath = path.resolve(input.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return {
    path: outputPath,
    report,
    loaded,
  };
}

function classifySample(input: {
  artifact: LiveEvalArtifact;
  promptModelRegression: boolean;
  timeToReconciledOutputMs: number | null;
}): ClassifiedSample {
  const artifact = input.artifact;
  const reasonCodes = uniqueSorted([
    ...artifact.failures.flatMap(failureReasonCodes),
    ...(artifact.judge?.failureCodes ?? []),
    ...(artifact.actual.privacyRisk ? ['privacy_leak'] : []),
    ...(artifact.judge?.privacyConcern ? ['privacy_leak'] : []),
    ...(input.promptModelRegression ? ['prompt_model_regression'] : []),
  ]);
  const expectedDirectWrite = (artifact.expected.outputKindCounts.direct_write ?? 0) > 0;
  const expectedApproval = (artifact.expected.outputKindCounts.approval_bundle ?? 0) > 0;

  return {
    artifact,
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
    promptModelRegression: input.promptModelRegression,
    timeToReconciledOutputMs: input.timeToReconciledOutputMs,
  };
}

async function loadProductionSamplingInputPath(
  inputPath: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
): Promise<void> {
  let inputStat;
  try {
    inputStat = await stat(inputPath);
  } catch (error) {
    loaded.ignoredFiles.push({ path: inputPath, reason: `unreadable: ${errorMessage(error)}` });
    return;
  }

  if (inputStat.isDirectory()) {
    await loadProductionSamplingDirectory(inputPath, loaded, seenArtifacts);
    return;
  }

  if (!inputStat.isFile()) {
    loaded.ignoredFiles.push({ path: inputPath, reason: 'not a regular file or directory' });
    return;
  }

  await loadProductionSamplingJsonFile(inputPath, path.dirname(inputPath), loaded, seenArtifacts);
}

async function loadProductionSamplingDirectory(
  dir: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
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
    await loadProductionSamplingJsonFile(filePath, dir, loaded, seenArtifacts);
  }
}

async function loadProductionSamplingJsonFile(
  filePath: string,
  baseDir: string,
  loaded: LoadedProductionSamplingEvalArtifacts,
  seenArtifacts: Set<string>,
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
    loaded.ignoredFiles.push({ path: filePath, reason: 'not a reconciliation live artifact' });
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
    Array.isArray(record.cases) &&
    record.cases.every(isLiveEvalManifestCase)
  );
}

function isLiveEvalManifestCase(value: unknown): boolean {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.caseName === 'string' &&
    typeof record.artifactPath === 'string' &&
    Array.isArray(record.ingestionSurfaces) &&
    record.ingestionSurfaces.every((surface) => typeof surface === 'string') &&
    typeof record.passed === 'boolean' &&
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
    record.schemaVersion === 1 &&
    typeof record.caseName === 'string' &&
    (typeof record.scenarioFamily === 'string' || record.scenarioFamily === null) &&
    Array.isArray(record.ingestionSurfaces) &&
    record.ingestionSurfaces.every((surface) => typeof surface === 'string') &&
    typeof record.modelId === 'string' &&
    typeof record.promptVersion === 'string' &&
    typeof record.startedAt === 'string' &&
    typeof record.completedAt === 'string' &&
    typeof record.passed === 'boolean' &&
    Array.isArray(record.failures) &&
    record.failures.every((failure) => typeof failure === 'string') &&
    typeof record.packetFingerprint === 'string' &&
    typeof record.promptFingerprint === 'string' &&
    !!expected &&
    Array.isArray(expected.ingestionSurfaces) &&
    isStringNumberRecord(expected.outputKindCounts) &&
    isStringNumberRecord(expected.associationRoleCounts) &&
    Array.isArray(expected.requiredSourcePayloadSurfaces) &&
    !!actual &&
    Array.isArray(actual.ingestionSurfaces) &&
    Array.isArray(actual.outputKinds) &&
    Array.isArray(actual.directWriteSurfaces) &&
    typeof actual.approvalRequired === 'boolean' &&
    typeof actual.privacyRisk === 'boolean' &&
    Array.isArray(actual.sourceRefs)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isStringNumberRecord(value: unknown): boolean {
  const record = asRecord(value);
  return !!record && Object.values(record).every((entry) => typeof entry === 'number');
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
    passedCount: samples.filter((sample) => sample.artifact.passed).length,
    failedCount: samples.filter((sample) => !sample.artifact.passed).length,
    passRate: passRate(samples),
    requiredObjectsMissed: samples.filter((sample) => sample.requiredObjectsMissed).length,
    requiredSuggestionsMissed: samples.filter((sample) => sample.requiredSuggestionsMissed).length,
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
  return samples.filter((sample) => sample.artifact.passed).length / samples.length;
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
