import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RECONCILIATION_DETERMINISTIC_EVAL_CASES } from '#src/reconciliation/eval-cases.js';
import {
  buildLiveEvalArtifact,
  buildLiveEvalRunManifest,
  liveEvalArtifactOutputDir,
  writeLiveEvalArtifact,
  writeLiveEvalRunManifest,
  type LiveEvalJudgeResult,
  type LiveEvalModelResult,
} from '#src/reconciliation/live-artifacts.js';

const [TEST_CASE] = RECONCILIATION_DETERMINISTIC_EVAL_CASES;
if (!TEST_CASE) {
  throw new Error('Expected at least one reconciliation eval case');
}

const RESULT: LiveEvalModelResult = {
  scenarioFamily: 'customer_project',
  ingestionSurfaces: ['email', 'monday', 'sentry'],
  outputKinds: ['observed_association', 'direct_write', 'approval_bundle', 'conflict'],
  directWriteSurfaces: ['monday', 'sentry'],
  artifactClusterKinds: ['customer_project', 'provider_record', 'incident'],
  approvalRequired: true,
  sourceRefs: [
    { surface: 'email', rawEventId: 'raw-email-1' },
    { surface: 'monday', rawEventId: 'raw-monday-1' },
  ],
  privacyRisk: false,
};

const JUDGE: LiveEvalJudgeResult = {
  modelId: 'judge-model',
  promptVersion: 'judge-prompt-v1',
  score: 0.96,
  passed: true,
  privacyConcern: false,
  failureCodes: [],
  strengthCodes: [
    'correct_scenario',
    'correct_surfaces',
    'correct_outputs',
    'source_refs_complete',
    'visibility_safe',
  ],
};

describe('live reconciliation eval artifacts', () => {
  it('resolves live artifact output directories for direct and timestamped modes', () => {
    expect(
      liveEvalArtifactOutputDir({
        artifactDir: '/tmp/direct-run',
        artifactRootDir: '/tmp/eval-runs/reconciliation',
        startedAt: '2026-06-28T12:00:00.000Z',
      }),
    ).toBe('/tmp/direct-run');
    expect(
      liveEvalArtifactOutputDir({
        artifactRootDir: '/tmp/eval-runs/reconciliation',
        startedAt: '2026-06-28T12:00:00.000Z',
      }),
    ).toBe('/tmp/eval-runs/reconciliation/2026-06-28T12-00-00-000Z');
    expect(
      liveEvalArtifactOutputDir({
        startedAt: '2026-06-28T12:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('redacts raw refs and prompt content into fingerprints', () => {
    const artifact = buildLiveEvalArtifact({
      testCase: TEST_CASE,
      modelId: 'test-model',
      promptVersion: 'test-prompt-v1',
      prompt: 'Forwarded email from buyer@acme.example mentions Nora and ISSUE-789',
      result: RESULT,
      judge: JUDGE,
      passed: true,
      failures: [],
      startedAt: '2026-06-28T12:00:00.000Z',
      completedAt: '2026-06-28T12:00:01.000Z',
    });

    expect(artifact.packetFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(artifact.promptFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(artifact.expected.forbiddenOutputKinds).toEqual(
      TEST_CASE.expected.forbiddenOutputKinds ?? [],
    );
    expect(artifact.expected.requiredArtifactClusterKinds).toEqual(
      TEST_CASE.expected.requiredArtifactClusterKinds ?? [],
    );
    expect(artifact.actual.artifactClusterKinds).toEqual([
      'customer_project',
      'provider_record',
      'incident',
    ]);
    expect(artifact.actual.sourceRefs).toHaveLength(2);
    expect(artifact.actual.sourceRefs.map((ref) => ref.surface)).toEqual(['email', 'monday']);
    expect(artifact.judge).toMatchObject({
      modelId: 'judge-model',
      promptVersion: 'judge-prompt-v1',
      score: 0.96,
      passed: true,
      privacyConcern: false,
      failureCodes: [],
    });
    for (const ref of artifact.actual.sourceRefs) {
      expect(ref.rawEventHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(JSON.stringify(artifact)).not.toContain('buyer@acme.example');
    expect(JSON.stringify(artifact)).not.toContain('raw-email-1');
    expect(JSON.stringify(artifact)).not.toContain('s3://eval/reconciliation');
  });

  it('rejects empty source refs before writing redacted artifacts', () => {
    expect(() =>
      buildLiveEvalArtifact({
        testCase: TEST_CASE,
        modelId: 'test-model',
        promptVersion: 'test-prompt-v1',
        prompt: 'Private customer packet should not be persisted verbatim',
        result: {
          ...RESULT,
          sourceRefs: [
            { surface: 'email', rawEventId: 'raw-email-1' },
            { surface: 'monday', rawEventId: '' },
          ],
        },
        judge: JUDGE,
        passed: false,
        failures: ['missing source ref monday:raw-monday-1'],
        startedAt: '2026-06-28T12:00:00.000Z',
        completedAt: '2026-06-28T12:00:01.000Z',
      }),
    ).toThrow(
      'Cannot write reconciliation live eval artifact for customer-project-email-monday-sentry: invalid source refs at indexes 1',
    );
  });

  it('rejects non-finite judge scores before writing redacted artifacts', () => {
    expect(() =>
      buildLiveEvalArtifact({
        testCase: TEST_CASE,
        modelId: 'test-model',
        promptVersion: 'test-prompt-v1',
        prompt: 'Private customer packet should not be persisted verbatim',
        result: RESULT,
        judge: { ...JUDGE, score: Number.NaN },
        passed: false,
        failures: ['judge score was not finite'],
        startedAt: '2026-06-28T12:00:00.000Z',
        completedAt: '2026-06-28T12:00:01.000Z',
      }),
    ).toThrow(
      'Cannot write reconciliation live eval artifact for customer-project-email-monday-sentry: invalid judge score',
    );
  });

  it('rejects invalid expected count maps before writing redacted artifacts', () => {
    expect(() =>
      buildLiveEvalArtifact({
        testCase: {
          ...TEST_CASE,
          expected: {
            ...TEST_CASE.expected,
            outputKindCounts: {
              ...TEST_CASE.expected.outputKindCounts,
              direct_write: -1,
            },
          },
        },
        modelId: 'test-model',
        promptVersion: 'test-prompt-v1',
        prompt: 'Private customer packet should not be persisted verbatim',
        result: RESULT,
        judge: JUDGE,
        passed: false,
        failures: ['fixture expected count was invalid'],
        startedAt: '2026-06-28T12:00:00.000Z',
        completedAt: '2026-06-28T12:00:01.000Z',
      }),
    ).toThrow(
      'Cannot write reconciliation live eval artifact for customer-project-email-monday-sentry: invalid expected counts at expected.outputKindCounts.direct_write',
    );
  });

  it('writes one redacted JSON artifact per case', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'timeline-live-eval-'));
    try {
      const { path: artifactPath } = await writeLiveEvalArtifact(dir, {
        testCase: TEST_CASE,
        modelId: 'test-model',
        promptVersion: 'test-prompt-v1',
        prompt: 'Private customer packet should not be persisted verbatim',
        result: RESULT,
        judge: {
          ...JUDGE,
          passed: false,
          score: 0.75,
          failureCodes: ['missing_required_output'],
        },
        passed: false,
        failures: ['missing observed_association'],
        startedAt: '2026-06-28T12:00:00.000Z',
        completedAt: '2026-06-28T12:00:01.000Z',
      });

      const raw = await readFile(artifactPath, 'utf8');
      expect(artifactPath).toMatch(/customer-project-email-monday-sentry\.json$/);
      expect(raw).toContain('"schemaVersion": 2');
      expect(raw).toContain('"missing observed_association"');
      expect(raw).toContain('"failureCodes": [');
      expect(raw).toContain('"missing_required_output"');
      expect(raw).not.toContain('Private customer packet');
      expect(raw).not.toContain('raw-email-1');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('summarizes a redacted live eval run without raw payload refs', () => {
    const artifact = buildLiveEvalArtifact({
      testCase: TEST_CASE,
      modelId: 'test-model',
      promptVersion: 'test-prompt-v1',
      prompt: 'Private customer packet should not be persisted verbatim',
      result: RESULT,
      judge: {
        ...JUDGE,
        passed: false,
        score: 0.75,
        failureCodes: ['missing_required_output'],
      },
      passed: false,
      failures: ['missing observed_association'],
      startedAt: '2026-06-28T12:00:00.000Z',
      completedAt: '2026-06-28T12:00:01.000Z',
    });

    const manifest = buildLiveEvalRunManifest('/tmp/eval-run', {
      modelId: 'test-model',
      promptVersion: 'test-prompt-v1',
      startedAt: '2026-06-28T12:00:00.000Z',
      completedAt: '2026-06-28T12:00:02.000Z',
      artifacts: [{ path: '/tmp/eval-run/customer-project-email-monday-sentry.json', artifact }],
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      runKind: 'reconciliation_live_eval',
      caseCount: 1,
      passedCount: 0,
      failedCount: 1,
      judgeAverageScore: 0.75,
      judgePassedCount: 0,
      judgeFailedCount: 1,
      scenarioFamilies: ['customer_project'],
    });
    expect(manifest.cases).toHaveLength(1);
    const [entry] = manifest.cases;
    expect(entry).toBeDefined();
    expect(entry?.caseName).toBe('customer-project-email-monday-sentry');
    expect(entry?.artifactPath).toBe('customer-project-email-monday-sentry.json');
    expect(entry?.scenarioFamily).toBe('customer_project');
    expect(entry?.ingestionSurfaces).toEqual(['email', 'monday', 'sentry']);
    expect(entry?.passed).toBe(false);
    expect(entry?.failureCount).toBe(1);
    expect(entry?.failures).toEqual(['missing observed_association']);
    expect(entry?.judgeScore).toBe(0.75);
    expect(entry?.judgePassed).toBe(false);
    expect(entry?.judgeFailureCodes).toEqual(['missing_required_output']);
    expect(entry?.packetFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(entry?.promptFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain('Private customer packet');
    expect(JSON.stringify(manifest)).not.toContain('raw-email-1');
    expect(JSON.stringify(manifest)).not.toContain('s3://eval/reconciliation');
  });

  it('rejects manifest artifact paths outside the output directory', () => {
    const artifact = buildLiveEvalArtifact({
      testCase: TEST_CASE,
      modelId: 'test-model',
      promptVersion: 'test-prompt-v1',
      prompt: 'Private customer packet should not be persisted verbatim',
      result: RESULT,
      judge: JUDGE,
      passed: true,
      failures: [],
      startedAt: '2026-06-28T12:00:00.000Z',
      completedAt: '2026-06-28T12:00:01.000Z',
    });

    expect(() =>
      buildLiveEvalRunManifest('/tmp/eval-run', {
        modelId: 'test-model',
        promptVersion: 'test-prompt-v1',
        startedAt: '2026-06-28T12:00:00.000Z',
        completedAt: '2026-06-28T12:00:02.000Z',
        artifacts: [{ path: '/tmp/escape.json', artifact }],
      }),
    ).toThrow(
      'Cannot write reconciliation live eval manifest for customer-project-email-monday-sentry: artifact path escapes output directory',
    );
  });

  it('writes a manifest next to per-case artifacts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'timeline-live-eval-'));
    try {
      const writtenArtifact = await writeLiveEvalArtifact(dir, {
        testCase: TEST_CASE,
        modelId: 'test-model',
        promptVersion: 'test-prompt-v1',
        prompt: 'Private customer packet should not be persisted verbatim',
        result: RESULT,
        judge: JUDGE,
        passed: true,
        failures: [],
        startedAt: '2026-06-28T12:00:00.000Z',
        completedAt: '2026-06-28T12:00:01.000Z',
      });
      const { path: manifestPath } = await writeLiveEvalRunManifest(dir, {
        modelId: 'test-model',
        promptVersion: 'test-prompt-v1',
        startedAt: '2026-06-28T12:00:00.000Z',
        completedAt: '2026-06-28T12:00:02.000Z',
        artifacts: [writtenArtifact],
      });

      const raw = await readFile(manifestPath, 'utf8');
      expect(manifestPath).toBe(path.join(dir, 'manifest.json'));
      expect(raw).toContain('"runKind": "reconciliation_live_eval"');
      expect(raw).toContain('"artifactPath": "customer-project-email-monday-sentry.json"');
      expect(raw).toContain('"judgeAverageScore": 0.96');
      expect(raw).not.toContain('Private customer packet');
      expect(raw).not.toContain('raw-email-1');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
