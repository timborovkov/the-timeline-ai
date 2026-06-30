import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DeterministicEvalCase } from '#src/reconciliation/index.js';

import {
  buildLiveEvalArtifact,
  buildLiveEvalRunManifest,
  type LiveEvalJudgeResult,
  type LiveEvalModelResult,
} from '#src/reconciliation/live-artifacts.js';
import {
  buildProductionSamplingEvalReport,
  loadProductionSamplingEvalArtifacts,
  writeProductionSamplingEvalReport,
} from '#src/reconciliation/production-sampling.js';

const BASE_CASE: DeterministicEvalCase = {
  name: 'customer-project-email-monday-sentry',
  scenarioFamily: 'customer_project',
  ingestionSurfaces: ['email', 'monday', 'sentry'],
  associations: [
    {
      id: 'association-1',
      role: 'discussion',
      visibility: { visibility: 'team' },
      visibilityFloor: { visibility: 'team' },
      sourceRefs: [{ source: 'email', rawEventId: 'raw-email-1' }],
    },
  ],
  outputs: [
    {
      id: 'direct-1',
      outputKind: 'direct_write',
      targetKind: 'task',
      operation: 'update',
      visibility: { visibility: 'team' },
      visibilityFloor: { visibility: 'team' },
      sourceRefs: [{ source: 'sentry', rawEventId: 'raw-sentry-1' }],
    },
    {
      id: 'approval-1',
      outputKind: 'approval_bundle',
      targetKind: 'object',
      operation: 'create',
      visibility: { visibility: 'team' },
      visibilityFloor: { visibility: 'team' },
      sourceRefs: [{ source: 'email', rawEventId: 'raw-email-1' }],
    },
  ],
  expected: {
    ingestionSurfaces: ['email', 'monday', 'sentry'],
    associationRoleCounts: { discussion: 1 },
    outputKindCounts: { direct_write: 1, approval_bundle: 1 },
    requireValidSourceRefs: true,
    requireVisibilityFloors: true,
    requiredSourcePayloadSurfaces: ['email', 'monday', 'sentry'],
  },
};

const PASS_RESULT: LiveEvalModelResult = {
  scenarioFamily: 'customer_project',
  ingestionSurfaces: ['email', 'monday', 'sentry'],
  outputKinds: ['direct_write', 'approval_bundle'],
  directWriteSurfaces: ['sentry'],
  approvalRequired: true,
  sourceRefs: [
    { surface: 'email', rawEventId: 'raw-email-1' },
    { surface: 'sentry', rawEventId: 'raw-sentry-1' },
  ],
  privacyRisk: false,
};

const PASS_JUDGE: LiveEvalJudgeResult = {
  modelId: 'judge-model',
  promptVersion: 'judge-v1',
  score: 0.97,
  passed: true,
  privacyConcern: false,
  failureCodes: [],
  strengthCodes: ['correct_scenario', 'visibility_safe'],
};

describe('production reconciliation sampling report', () => {
  it('aggregates redacted live artifacts into surface and scenario health metrics', () => {
    const passed = buildLiveEvalArtifact({
      testCase: BASE_CASE,
      modelId: 'planner-v1',
      promptVersion: 'prompt-v1',
      prompt: 'private production packet text',
      result: PASS_RESULT,
      judge: PASS_JUDGE,
      passed: true,
      failures: [],
      startedAt: '2026-06-29T10:00:00.000Z',
      completedAt: '2026-06-29T10:00:01.000Z',
    });
    const failed = buildLiveEvalArtifact({
      testCase: BASE_CASE,
      modelId: 'planner-v2',
      promptVersion: 'prompt-v2',
      prompt: 'private production packet text with miss',
      result: {
        ...PASS_RESULT,
        outputKinds: ['approval_bundle'],
        directWriteSurfaces: [],
        privacyRisk: true,
      },
      judge: {
        ...PASS_JUDGE,
        modelId: 'judge-model-v2',
        promptVersion: 'judge-v2',
        score: 0.42,
        passed: false,
        privacyConcern: true,
        failureCodes: [
          'missing_required_output',
          'source_ref_mismatch',
          'unsupported_direct_write',
          'privacy_leak',
          'irrelevant_output',
        ],
      },
      passed: false,
      failures: [
        'missing output kind direct_write',
        'missing source ref sentry:raw-sentry-1',
        'privacyRisk should be false',
      ],
      startedAt: '2026-06-29T10:05:00.000Z',
      completedAt: '2026-06-29T10:05:02.000Z',
    });
    const manifest = buildLiveEvalRunManifest('/tmp/reconciliation-prod-sample', {
      modelId: 'planner-v2',
      promptVersion: 'prompt-v2',
      startedAt: '2026-06-29T10:00:00.000Z',
      completedAt: '2026-06-29T10:05:02.000Z',
      artifacts: [
        { path: '/tmp/reconciliation-prod-sample/pass.json', artifact: passed },
        { path: '/tmp/reconciliation-prod-sample/fail.json', artifact: failed },
      ],
    });

    const report = buildProductionSamplingEvalReport({
      runKind: 'closed_beta',
      generatedAt: '2026-06-29T10:06:00.000Z',
      manifests: [manifest],
      artifacts: [passed, failed],
      latencies: [
        {
          caseName: passed.caseName,
          packetFingerprint: passed.packetFingerprint,
          timeToReconciledOutputMs: 1_000,
        },
        {
          caseName: failed.caseName,
          packetFingerprint: failed.packetFingerprint,
          timeToReconciledOutputMs: 2_000,
        },
      ],
      confirmedFixtureCandidates: [
        { caseName: failed.caseName, packetFingerprint: failed.packetFingerprint },
      ],
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      runKind: 'closed_beta',
      manifestCount: 1,
      sampleCount: 2,
      passedCount: 1,
      failedCount: 1,
      passRate: 0.5,
      modelVersions: ['planner-v1', 'planner-v2'],
      promptVersions: ['judge-v1', 'judge-v2', 'prompt-v1', 'prompt-v2'],
      totals: {
        sampleCount: 2,
        passedCount: 1,
        failedCount: 1,
        passRate: 0.5,
        requiredObjectsMissed: 1,
        requiredSuggestionsMissed: 1,
        extraDangerousSuggestions: 1,
        citationFailures: 1,
        visibilityFailures: 1,
        authorityPolicyViolations: 1,
        promptModelRegressions: 1,
        averageTimeToReconciledOutputMs: 2000,
      },
    });
    expect(report.byIngestionSurface).toEqual([
      expect.objectContaining({ name: 'email', sampleCount: 2, passRate: 0.5 }),
      expect.objectContaining({ name: 'monday', sampleCount: 2, passRate: 0.5 }),
      expect.objectContaining({ name: 'sentry', sampleCount: 2, passRate: 0.5 }),
    ]);
    expect(report.byScenarioFamily).toEqual([
      expect.objectContaining({ name: 'customer_project', sampleCount: 2, failedCount: 1 }),
    ]);
    expect(report.fixtureCandidates).toEqual([
      expect.objectContaining({
        caseName: failed.caseName,
        packetFingerprint: failed.packetFingerprint,
        scenarioFamily: 'customer_project',
        ingestionSurfaces: ['email', 'monday', 'sentry'],
        confirmed: true,
      }),
    ]);
    expect(report.fixtureCandidates[0]?.reasonCodes).toEqual([
      'irrelevant_output',
      'missing_required_output',
      'privacy_leak',
      'prompt_model_regression',
      'source_ref_mismatch',
      'unsupported_direct_write',
    ]);
    expect(report.fixtureCandidates[0]?.suggestedFixtureName).toMatch(
      /^customer_project-customer-project-email-monday-sentry-[a-f0-9]{12}$/,
    );
    expect(JSON.stringify(report)).not.toContain('private production packet');
    expect(JSON.stringify(report)).not.toContain('raw-sentry-1');
  });

  it('loads redacted live artifacts from manifests and ignores unsafe files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'timeline-production-sampling-'));
    try {
      const artifact = buildLiveEvalArtifact({
        testCase: BASE_CASE,
        modelId: 'planner-v1',
        promptVersion: 'prompt-v1',
        prompt: 'private production packet text',
        result: PASS_RESULT,
        judge: PASS_JUDGE,
        passed: true,
        failures: [],
        startedAt: '2026-06-29T10:00:00.000Z',
        completedAt: '2026-06-29T10:00:01.000Z',
      });
      const artifactPath = path.join(dir, 'customer-project-email-monday-sentry.json');
      await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
      await writeFile(
        path.join(dir, 'not-an-artifact.json'),
        `${JSON.stringify({ schemaVersion: 1, prompt: 'raw customer text' })}\n`,
        'utf8',
      );
      await writeFile(path.join(dir, 'broken.json'), '{', 'utf8');

      const manifest = {
        ...buildLiveEvalRunManifest(dir, {
          modelId: 'planner-v1',
          promptVersion: 'prompt-v1',
          startedAt: '2026-06-29T10:00:00.000Z',
          completedAt: '2026-06-29T10:00:02.000Z',
          artifacts: [{ path: artifactPath, artifact }],
        }),
        cases: [
          {
            caseName: artifact.caseName,
            artifactPath: path.basename(artifactPath),
            scenarioFamily: artifact.scenarioFamily,
            ingestionSurfaces: artifact.ingestionSurfaces,
            passed: artifact.passed,
            failureCount: artifact.failures.length,
            failures: artifact.failures,
            judgeScore: artifact.judge?.score ?? null,
            judgePassed: artifact.judge?.passed ?? null,
            judgeFailureCodes: artifact.judge?.failureCodes ?? [],
            packetFingerprint: artifact.packetFingerprint,
            promptFingerprint: artifact.promptFingerprint,
          },
          {
            caseName: 'escape',
            artifactPath: '../escape.json',
            scenarioFamily: 'customer_project',
            ingestionSurfaces: ['email'],
            passed: false,
            failureCount: 1,
            failures: ['should not be read'],
            judgeScore: null,
            judgePassed: null,
            judgeFailureCodes: [],
            packetFingerprint: 'sha256:escape',
            promptFingerprint: 'sha256:escape',
          },
        ],
      };
      await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

      const loaded = await loadProductionSamplingEvalArtifacts({ inputPaths: [dir] });

      expect(loaded.manifests).toHaveLength(1);
      expect(loaded.artifacts).toHaveLength(1);
      expect(loaded.artifacts[0]?.caseName).toBe('customer-project-email-monday-sentry');
      expect(
        loaded.ignoredFiles.some(
          (file) =>
            file.path === path.join(dir, '../escape.json') &&
            file.reason === 'manifest artifact path escapes the run directory',
        ),
      ).toBe(true);
      expect(
        loaded.ignoredFiles.some(
          (file) =>
            file.path === path.join(dir, 'broken.json') && file.reason.includes('invalid json'),
        ),
      ).toBe(true);
      expect(
        loaded.ignoredFiles.some(
          (file) =>
            file.path === path.join(dir, 'not-an-artifact.json') &&
            file.reason === 'not a reconciliation live artifact',
        ),
      ).toBe(true);
      expect(JSON.stringify(loaded)).not.toContain('private production packet text');
      expect(JSON.stringify(loaded)).not.toContain('raw-email-1');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('writes a production sampling report from one or more live artifact directories', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'timeline-production-sampling-'));
    try {
      const artifact = buildLiveEvalArtifact({
        testCase: BASE_CASE,
        modelId: 'planner-v1',
        promptVersion: 'prompt-v1',
        prompt: 'private production packet text',
        result: PASS_RESULT,
        judge: PASS_JUDGE,
        passed: true,
        failures: [],
        startedAt: '2026-06-29T10:00:00.000Z',
        completedAt: '2026-06-29T10:00:01.000Z',
      });
      const artifactPath = path.join(dir, 'customer-project-email-monday-sentry.json');
      await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
      await writeFile(
        path.join(dir, 'manifest.json'),
        `${JSON.stringify(
          buildLiveEvalRunManifest(dir, {
            modelId: 'planner-v1',
            promptVersion: 'prompt-v1',
            startedAt: '2026-06-29T10:00:00.000Z',
            completedAt: '2026-06-29T10:00:01.000Z',
            artifacts: [{ path: artifactPath, artifact }],
          }),
          null,
          2,
        )}\n`,
        'utf8',
      );

      const outputPath = path.join(dir, 'reports', 'production-sampling-report.json');
      const written = await writeProductionSamplingEvalReport({
        inputPaths: [dir],
        outputPath,
        generatedAt: '2026-06-29T10:06:00.000Z',
        runKind: 'closed_beta',
      });

      expect(written.path).toBe(outputPath);
      expect(written.report).toMatchObject({
        schemaVersion: 1,
        runKind: 'closed_beta',
        manifestCount: 1,
        sampleCount: 1,
        passedCount: 1,
        failedCount: 0,
        passRate: 1,
      });
      const raw = await readFile(outputPath, 'utf8');
      expect(raw).toContain('"runKind": "closed_beta"');
      expect(raw).not.toContain('private production packet text');
      expect(raw).not.toContain('raw-email-1');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
