/**
 * The opt-in CLI must make model/corpus choices explicit, write one immutable
 * aggregate artifact, and expose a strict promotion exit code without printing
 * transcript-bearing details. All dependencies are fakes; no file or provider is touched.
 */
import {
  TIMELINE_AI_PRIVACY_POLICY_VERSION,
  TIMELINE_MODELS,
  buildOpenRouterPrivacyAttestationPayload,
  buildOpenRouterPrivacyAttestationToken,
} from '@timeline/shared/llm';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL,
  parseTranscriptionQualityEvalArgs,
  requireCurrentOpenRouterPrivacyAttestation,
  runTranscriptionQualityEvalCli,
  TranscriptionQualityEvalUsageError,
} from '#src/scripts/transcription-quality-eval.js';
import {
  TRANSCRIPTION_QUALITY_GATES,
  type TranscriptionQualityEvalReport,
} from '#src/transcription-eval/evaluate.js';
import { buildValidTranscriptionEvalManifest } from '#src/transcription-eval/test-fixtures.js';

const TEST_API_KEY = 'sk-or-v1-synthetic-cli-eval-key';
const TEST_GUARDRAIL_ID = 'synthetic-cli-eval-guardrail';
const TEST_PRIVACY_ATTESTATION = buildOpenRouterPrivacyAttestationPayload({
  apiKey: TEST_API_KEY,
  guardrailId: TEST_GUARDRAIL_ID,
});
const TEST_PRIVACY_ATTESTATION_TOKEN = buildOpenRouterPrivacyAttestationToken({
  apiKey: TEST_API_KEY,
  guardrailId: TEST_GUARDRAIL_ID,
});
const PRIVACY_DEPS = {
  apiKey: TEST_API_KEY,
  guardrailId: TEST_GUARDRAIL_ID,
  privacyPolicyAttestationToken: TEST_PRIVACY_ATTESTATION_TOKEN,
} as const;

function aggregateReport(status: 'candidate_passed' | 'no_candidate_passed') {
  return {
    schemaVersion: 'transcription-quality-eval-v1',
    generatedAt: '2026-08-21T10:00:00.000Z',
    corpus: {
      manifestSha256: 'a'.repeat(64),
      audioSha256: 'b'.repeat(64),
      fixtureOrigin: 'synthetic',
      caseCount: 24,
      languageCount: 24,
      languageFamilyCount: 8,
      formats: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac'],
      sources: ['web_voice_note', 'telegram_voice', 'slack_audio', 'email_audio'],
      scenarios: [
        'accent',
        'background_noise',
        'silence',
        'names',
        'numbers',
        'long_low_bitrate',
        'code_switching',
      ],
    },
    baselineModelId: DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL,
    candidateModelIds: ['example/zdr-candidate'],
    languageHintMode: 'auto_detect',
    privacyPolicyAttestation: {
      ...TEST_PRIVACY_ATTESTATION,
      evidenceKind: 'operator_attestation',
      isProviderProof: false,
    },
    requestBudgetMs: 120_000,
    thresholds: TRANSCRIPTION_QUALITY_GATES,
    models: [],
    ranking: status === 'candidate_passed' ? ['example/zdr-candidate'] : [],
    selection: {
      status,
      recommendedModelId: status === 'candidate_passed' ? 'example/zdr-candidate' : null,
    },
  } satisfies TranscriptionQualityEvalReport;
}

describe('transcription quality eval CLI', () => {
  it('parses an explicit approved corpus, candidates, budget, and promotion gate', () => {
    expect(
      parseTranscriptionQualityEvalArgs([
        '--manifest=/secure/corpus/manifest.json',
        '--out=/secure/evidence/run.json',
        `--baseline=${DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL}`,
        '--candidate=openai/whisper-large-v3',
        '--candidate=google/chirp-3',
        '--request-budget-ms=90000',
        '--concurrency=3',
        '--require-passing-candidate',
      ]),
    ).toEqual({
      manifestPath: '/secure/corpus/manifest.json',
      outputPath: '/secure/evidence/run.json',
      baselineModelId: DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL,
      candidateModelIds: ['openai/whisper-large-v3', 'google/chirp-3'],
      requestBudgetMs: 90_000,
      concurrency: 3,
      requirePassingCandidate: true,
    });
  });

  it('derives the default baseline from the production model registry', () => {
    const parsed = parseTranscriptionQualityEvalArgs([
      '--manifest=/secure/corpus/manifest.json',
      '--out=/secure/evidence/run.json',
      '--candidate=example/zdr-candidate',
    ]);

    expect(DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL).toBe(TIMELINE_MODELS.transcription.id);
    expect(parsed.baselineModelId).toBe(TIMELINE_MODELS.transcription.id);
    expect(parsed.requirePassingCandidate).toBe(true);
  });

  it('writes only the returned aggregate report and prints a content-free summary', async () => {
    const report = aggregateReport('candidate_passed');
    const writeReport = vi.fn().mockResolvedValue(undefined);
    const writes: string[] = [];
    const runEval = vi.fn().mockResolvedValue(report);

    await runTranscriptionQualityEvalCli(
      parseTranscriptionQualityEvalArgs([
        '--manifest=/secure/corpus/manifest.json',
        '--out=/secure/evidence/run.json',
        '--candidate=example/zdr-candidate',
      ]),
      {
        ...PRIVACY_DEPS,
        loadManifest: vi.fn().mockResolvedValue({
          manifest: buildValidTranscriptionEvalManifest(),
          manifestDirectory: '/secure/corpus',
          manifestSha256: 'a'.repeat(64),
        }),
        runEval,
        writeReport,
        write: (text) => writes.push(text),
      },
    );

    expect(runEval).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineModelId: DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL,
        candidateModelIds: ['example/zdr-candidate'],
        privacyPolicyAttestation: TEST_PRIVACY_ATTESTATION,
      }),
    );
    expect(writeReport).toHaveBeenCalledWith('/secure/evidence/run.json', report);
    expect(JSON.parse(writes[0] ?? '{}')).toEqual({
      schemaVersion: 'transcription-quality-eval-v1',
      outputPath: '/secure/evidence/run.json',
      corpusManifestSha256: 'a'.repeat(64),
      corpusAudioSha256: 'b'.repeat(64),
      baselineModelId: DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL,
      privacyPolicyVersion: TIMELINE_AI_PRIVACY_POLICY_VERSION,
      candidateCount: 1,
      selection: report.selection,
    });
    expect(writes.join('\n')).not.toContain('The licensed reference transcript');
  });

  it('sets a failing promotion exit code when no ZDR candidate clears every gate', async () => {
    const exitCodes: number[] = [];
    await runTranscriptionQualityEvalCli(
      parseTranscriptionQualityEvalArgs([
        '--manifest=/secure/corpus/manifest.json',
        '--out=/secure/evidence/run.json',
        '--candidate=example/zdr-candidate',
      ]),
      {
        ...PRIVACY_DEPS,
        loadManifest: vi.fn().mockResolvedValue({
          manifest: buildValidTranscriptionEvalManifest(),
          manifestDirectory: '/secure/corpus',
          manifestSha256: 'a'.repeat(64),
        }),
        runEval: vi.fn().mockResolvedValue(aggregateReport('no_candidate_passed')),
        writeReport: vi.fn().mockResolvedValue(undefined),
        write: () => undefined,
        setExitCode: (code) => exitCodes.push(code),
      },
    );

    expect(exitCodes).toEqual([1]);
  });

  it('allows an explicit exploratory run to preserve a no-passing result', async () => {
    const exitCodes: number[] = [];
    const args = parseTranscriptionQualityEvalArgs([
      '--manifest=/secure/corpus/manifest.json',
      '--out=/secure/evidence/run.json',
      '--candidate=example/zdr-candidate',
      '--allow-no-passing-candidate',
    ]);

    await runTranscriptionQualityEvalCli(args, {
      ...PRIVACY_DEPS,
      loadManifest: vi.fn().mockResolvedValue({
        manifest: buildValidTranscriptionEvalManifest(),
        manifestDirectory: '/secure/corpus',
        manifestSha256: 'a'.repeat(64),
      }),
      runEval: vi.fn().mockResolvedValue(aggregateReport('no_candidate_passed')),
      writeReport: vi.fn().mockResolvedValue(undefined),
      write: () => undefined,
      setExitCode: (code) => exitCodes.push(code),
    });

    expect(args.requirePassingCandidate).toBe(false);
    expect(exitCodes).toEqual([]);
  });

  it('rejects any baseline override that differs from the production pin', () => {
    expect(() =>
      parseTranscriptionQualityEvalArgs([
        '--manifest=/secure/corpus/manifest.json',
        '--out=/secure/evidence/run.json',
        '--baseline=example/stale-baseline',
        '--candidate=example/zdr-candidate',
      ]),
    ).toThrow(/current production transcription model/u);
  });

  it('validates the key-bound current operator attestation before loading the corpus', async () => {
    expect(
      requireCurrentOpenRouterPrivacyAttestation({
        apiKey: TEST_API_KEY,
        guardrailId: TEST_GUARDRAIL_ID,
        token: TEST_PRIVACY_ATTESTATION_TOKEN,
      }),
    ).toEqual(TEST_PRIVACY_ATTESTATION);

    const loadManifest = vi.fn();
    const args = parseTranscriptionQualityEvalArgs([
      '--manifest=/secure/corpus/manifest.json',
      '--out=/secure/evidence/run.json',
      '--candidate=example/zdr-candidate',
    ]);
    await expect(
      runTranscriptionQualityEvalCli(args, {
        ...PRIVACY_DEPS,
        apiKey: `${TEST_API_KEY}-rotated`,
        loadManifest,
      }),
    ).rejects.toThrow(/must be regenerated/u);
    expect(loadManifest).not.toHaveBeenCalled();
  });

  it('requires a manifest, a new output path, and at least one candidate', () => {
    expect(() =>
      parseTranscriptionQualityEvalArgs(['--out=/tmp/run.json', '--candidate=google/chirp-3']),
    ).toThrow(TranscriptionQualityEvalUsageError);
    expect(() =>
      parseTranscriptionQualityEvalArgs(['--manifest=/tmp/manifest.json', '--out=/tmp/run.json']),
    ).toThrow(/candidate/u);
    expect(() =>
      parseTranscriptionQualityEvalArgs([
        '--manifest=/tmp/manifest.json',
        '--out=/tmp/run.json',
        '--candidate=google/chirp-3',
        '--require-passing-candidate',
        '--allow-no-passing-candidate',
      ]),
    ).toThrow(/only one/u);
  });
});
