import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ArtifactClusterKind, DeterministicEvalCase } from '#src/reconciliation/index.js';

export interface LiveEvalModelResult {
  scenarioFamily: string;
  ingestionSurfaces: string[];
  outputKinds: string[];
  directWriteSurfaces: string[];
  artifactClusterKinds: ArtifactClusterKind[];
  approvalRequired: boolean;
  sourceRefs: { surface: string; rawEventId: string }[];
  privacyRisk: boolean;
}

export interface LiveEvalJudgeResult {
  modelId: string;
  promptVersion: string;
  score: number;
  passed: boolean;
  privacyConcern: boolean;
  failureCodes: string[];
  strengthCodes: string[];
}

export interface LiveEvalArtifactInput {
  testCase: DeterministicEvalCase;
  modelId: string;
  promptVersion: string;
  prompt: string;
  result: LiveEvalModelResult;
  judge?: LiveEvalJudgeResult | null | undefined;
  passed: boolean;
  failures: string[];
  startedAt: string;
  completedAt: string;
}

export interface LiveEvalArtifact {
  schemaVersion: 2;
  caseName: string;
  scenarioFamily: string | null;
  ingestionSurfaces: string[];
  modelId: string;
  promptVersion: string;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  failures: string[];
  packetFingerprint: string;
  promptFingerprint: string;
  expected: {
    ingestionSurfaces: string[];
    outputKindCounts: Record<string, number>;
    associationRoleCounts: Record<string, number>;
    requiredArtifactClusterKinds: string[];
    requiredSourcePayloadSurfaces: string[];
    forbiddenOutputKinds: string[];
  };
  actual: Omit<LiveEvalModelResult, 'sourceRefs'> & {
    sourceRefs: { surface: string; rawEventHash: string }[];
  };
  judge: LiveEvalJudgeResult | null;
}

export interface WrittenLiveEvalArtifact {
  path: string;
  artifact: LiveEvalArtifact;
}

export interface LiveEvalRunManifestInput {
  modelId: string;
  promptVersion: string;
  startedAt: string;
  completedAt: string;
  artifacts: WrittenLiveEvalArtifact[];
}

export interface LiveEvalArtifactDirectoryInput {
  artifactDir?: string | null | undefined;
  artifactRootDir?: string | null | undefined;
  startedAt: string;
}

export interface LiveEvalRunManifest {
  schemaVersion: 1;
  runKind: 'reconciliation_live_eval';
  modelId: string;
  promptVersion: string;
  startedAt: string;
  completedAt: string;
  caseCount: number;
  passedCount: number;
  failedCount: number;
  judgeAverageScore: number | null;
  judgePassedCount: number;
  judgeFailedCount: number;
  scenarioFamilies: string[];
  ingestionSurfaces: string[];
  cases: {
    caseName: string;
    artifactPath: string;
    scenarioFamily: string | null;
    ingestionSurfaces: string[];
    passed: boolean;
    failureCount: number;
    failures: string[];
    judgeScore: number | null;
    judgePassed: boolean | null;
    judgeFailureCodes: string[];
    packetFingerprint: string;
    promptFingerprint: string;
  }[];
}

export function buildLiveEvalArtifact(input: LiveEvalArtifactInput): LiveEvalArtifact {
  return {
    schemaVersion: 2,
    caseName: input.testCase.name,
    scenarioFamily: input.testCase.scenarioFamily ?? null,
    ingestionSurfaces: [...input.testCase.ingestionSurfaces],
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    passed: input.passed,
    failures: [...input.failures],
    packetFingerprint: digestStable({
      name: input.testCase.name,
      scenarioFamily: input.testCase.scenarioFamily ?? null,
      ingestionSurfaces: input.testCase.ingestionSurfaces,
      expected: input.testCase.expected,
      associations: input.testCase.associations,
      outputs: input.testCase.outputs,
    }),
    promptFingerprint: digestStable(input.prompt),
    expected: {
      ingestionSurfaces: [...input.testCase.expected.ingestionSurfaces],
      outputKindCounts: { ...input.testCase.expected.outputKindCounts },
      associationRoleCounts: { ...(input.testCase.expected.associationRoleCounts ?? {}) },
      requiredArtifactClusterKinds: [
        ...(input.testCase.expected.requiredArtifactClusterKinds ?? []),
      ],
      requiredSourcePayloadSurfaces: [
        ...(input.testCase.expected.requiredSourcePayloadSurfaces ?? []),
      ],
      forbiddenOutputKinds: [...(input.testCase.expected.forbiddenOutputKinds ?? [])],
    },
    actual: {
      scenarioFamily: input.result.scenarioFamily,
      ingestionSurfaces: [...input.result.ingestionSurfaces],
      outputKinds: [...input.result.outputKinds],
      directWriteSurfaces: [...input.result.directWriteSurfaces],
      artifactClusterKinds: [...input.result.artifactClusterKinds],
      approvalRequired: input.result.approvalRequired,
      privacyRisk: input.result.privacyRisk,
      sourceRefs: input.result.sourceRefs.map((ref) => ({
        surface: ref.surface,
        rawEventHash: digestStable(ref.rawEventId),
      })),
    },
    judge: input.judge
      ? {
          modelId: input.judge.modelId,
          promptVersion: input.judge.promptVersion,
          score: input.judge.score,
          passed: input.judge.passed,
          privacyConcern: input.judge.privacyConcern,
          failureCodes: [...input.judge.failureCodes],
          strengthCodes: [...input.judge.strengthCodes],
        }
      : null,
  };
}

export async function writeLiveEvalArtifact(
  outputDir: string,
  input: LiveEvalArtifactInput,
): Promise<WrittenLiveEvalArtifact> {
  const artifact = buildLiveEvalArtifact(input);
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${safeFileSegment(input.testCase.name)}.json`);
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { path: filePath, artifact };
}

export function liveEvalArtifactOutputDir(input: LiveEvalArtifactDirectoryInput): string | null {
  const artifactDir = input.artifactDir?.trim();
  if (artifactDir) return artifactDir;

  const artifactRootDir = input.artifactRootDir?.trim();
  if (!artifactRootDir) return null;

  return path.join(artifactRootDir, timestampFileSegment(input.startedAt));
}

export function buildLiveEvalRunManifest(
  outputDir: string,
  input: LiveEvalRunManifestInput,
): LiveEvalRunManifest {
  const cases = input.artifacts
    .map(({ artifact, path: artifactPath }) => ({
      caseName: artifact.caseName,
      artifactPath: path.relative(outputDir, artifactPath),
      scenarioFamily: artifact.scenarioFamily,
      ingestionSurfaces: [...artifact.ingestionSurfaces],
      passed: artifact.passed,
      failureCount: artifact.failures.length,
      failures: [...artifact.failures],
      judgeScore: artifact.judge?.score ?? null,
      judgePassed: artifact.judge?.passed ?? null,
      judgeFailureCodes: [...(artifact.judge?.failureCodes ?? [])],
      packetFingerprint: artifact.packetFingerprint,
      promptFingerprint: artifact.promptFingerprint,
    }))
    .sort((left, right) => left.caseName.localeCompare(right.caseName));

  const judgedCases = cases.filter((entry) => entry.judgeScore !== null);

  return {
    schemaVersion: 1,
    runKind: 'reconciliation_live_eval',
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    caseCount: cases.length,
    passedCount: cases.filter((entry) => entry.passed).length,
    failedCount: cases.filter((entry) => !entry.passed).length,
    judgeAverageScore:
      judgedCases.length > 0
        ? judgedCases.reduce((sum, entry) => sum + (entry.judgeScore ?? 0), 0) / judgedCases.length
        : null,
    judgePassedCount: cases.filter((entry) => entry.judgePassed === true).length,
    judgeFailedCount: cases.filter((entry) => entry.judgePassed === false).length,
    scenarioFamilies: uniqueSorted(cases.flatMap((entry) => entry.scenarioFamily ?? [])),
    ingestionSurfaces: uniqueSorted(cases.flatMap((entry) => entry.ingestionSurfaces)),
    cases,
  };
}

export async function writeLiveEvalRunManifest(
  outputDir: string,
  input: LiveEvalRunManifestInput,
): Promise<{ path: string; manifest: LiveEvalRunManifest }> {
  const manifest = buildLiveEvalRunManifest(outputDir, input);
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, 'manifest.json');
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { path: filePath, manifest };
}

function safeFileSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function timestampFileSegment(value: string): string {
  return value.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '');
}

function digestStable(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
