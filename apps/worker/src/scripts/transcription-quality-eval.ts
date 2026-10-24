/**
 * Compare the retained quality baseline with currently ZDR-listed OpenRouter STT candidates.
 *
 * Usage:
 *   pnpm eval:transcription-quality:live -- --manifest=/approved/corpus/manifest.json \
 *     --out=/secure/evidence/transcription-eval-2026-08-21.json \
 *     --candidate=google/chirp-3 --candidate=mistralai/voxtral-mini-transcribe
 *
 * The input corpus must be synthetic, licensed, or explicitly approved non-customer data.
 * The output is aggregate-only and deliberately excludes audio, paths, references, hypotheses,
 * case IDs, and provider errors.
 */
import { writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  TIMELINE_MODELS,
  isCurrentOpenRouterPrivacyAttestation,
  parseOpenRouterPrivacyAttestationToken,
  type OpenRouterPrivacyAttestationPayload,
} from '@timeline/shared/llm';

import {
  runTranscriptionQualityEval,
  TranscriptionQualityEvalError,
  type RunTranscriptionQualityEvalInput,
  type TranscriptionQualityEvalReport,
} from '#src/transcription-eval/evaluate.js';
import {
  loadTranscriptionEvalManifest,
  TranscriptionEvalManifestError,
  type LoadedTranscriptionEvalManifest,
} from '#src/transcription-eval/manifest.js';
import { createOpenRouterTranscriptionEvalTransport } from '#src/transcription-eval/openrouter.js';

export const DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL = TIMELINE_MODELS.transcription.id;
const DEFAULT_REQUEST_BUDGET_MS = 120_000;

export interface TranscriptionQualityEvalArgs {
  manifestPath: string;
  outputPath: string;
  baselineModelId: string;
  candidateModelIds: string[];
  requestBudgetMs: number;
  concurrency: number;
  requirePassingCandidate: boolean;
}

export interface TranscriptionQualityEvalCliDeps {
  loadManifest?: (manifestPath: string) => Promise<LoadedTranscriptionEvalManifest>;
  runEval?: (input: RunTranscriptionQualityEvalInput) => Promise<TranscriptionQualityEvalReport>;
  writeReport?: (outputPath: string, report: TranscriptionQualityEvalReport) => Promise<void>;
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
  apiKey?: string;
  guardrailId?: string;
  privacyPolicyAttestationToken?: string;
}

export class TranscriptionQualityEvalUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionQualityEvalUsageError';
  }
}

function usageError(message: string): never {
  throw new TranscriptionQualityEvalUsageError(message);
}

function parseInteger(value: string, label: string, minimum: number, maximum: number): number {
  if (!/^\d+$/u.test(value)) usageError(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    usageError(`${label} must be between ${String(minimum)} and ${String(maximum)}`);
  }
  return parsed;
}

export function parseTranscriptionQualityEvalArgs(
  argv = process.argv.slice(2),
): TranscriptionQualityEvalArgs {
  let manifestPath: string | undefined;
  let outputPath: string | undefined;
  let baselineModelId: string = DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL;
  const candidateModelIds: string[] = [];
  let requestBudgetMs = DEFAULT_REQUEST_BUDGET_MS;
  let concurrency = 2;
  let requirePassingCandidate = true;
  let promotionFlag: 'allow' | 'require' | undefined;

  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg.startsWith('--manifest=')) {
      manifestPath = arg.slice('--manifest='.length).trim();
      if (!manifestPath) usageError('Missing --manifest value');
    } else if (arg.startsWith('--out=')) {
      outputPath = arg.slice('--out='.length).trim();
      if (!outputPath) usageError('Missing --out value');
    } else if (arg.startsWith('--baseline=')) {
      baselineModelId = arg.slice('--baseline='.length).trim();
      if (!baselineModelId) usageError('Missing --baseline value');
    } else if (arg.startsWith('--candidate=')) {
      const candidate = arg.slice('--candidate='.length).trim();
      if (!candidate) usageError('Missing --candidate value');
      candidateModelIds.push(candidate);
    } else if (arg.startsWith('--request-budget-ms=')) {
      requestBudgetMs = parseInteger(
        arg.slice('--request-budget-ms='.length),
        '--request-budget-ms',
        1_000,
        600_000,
      );
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInteger(arg.slice('--concurrency='.length), '--concurrency', 1, 8);
    } else if (arg === '--require-passing-candidate') {
      if (promotionFlag === 'allow') {
        usageError('Choose only one passing-candidate mode');
      }
      promotionFlag = 'require';
      requirePassingCandidate = true;
    } else if (arg === '--allow-no-passing-candidate') {
      if (promotionFlag === 'require') {
        usageError('Choose only one passing-candidate mode');
      }
      promotionFlag = 'allow';
      requirePassingCandidate = false;
    } else {
      usageError(`Unknown argument: ${arg}`);
    }
  }

  if (!manifestPath) usageError('Missing --manifest=<approved-corpus-manifest.json>');
  if (!outputPath) usageError('Missing --out=<new-evidence-file.json>');
  if (baselineModelId !== DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL) {
    usageError(
      `--baseline must equal the current production transcription model ${DEFAULT_TRANSCRIPTION_QUALITY_BASELINE_MODEL}`,
    );
  }
  if (candidateModelIds.length === 0) {
    usageError('Provide at least one --candidate=<openrouter-model-id>');
  }
  if (candidateModelIds.length > 20) usageError('At most 20 candidates may be evaluated per run');

  return {
    manifestPath,
    outputPath,
    baselineModelId,
    candidateModelIds,
    requestBudgetMs,
    concurrency,
    requirePassingCandidate,
  };
}

export function requireCurrentOpenRouterPrivacyAttestation(input: {
  apiKey: string | undefined;
  guardrailId: string | undefined;
  token: string | undefined;
}): OpenRouterPrivacyAttestationPayload {
  const { apiKey, guardrailId, token } = input;
  if (!apiKey || !guardrailId || !token) {
    throw new TranscriptionQualityEvalUsageError(
      'OPENROUTER_API_KEY, OPENROUTER_GUARDRAIL_ID, and OPENROUTER_PRIVACY_POLICY_ATTESTATION are required',
    );
  }
  try {
    if (!isCurrentOpenRouterPrivacyAttestation(token, { apiKey, guardrailId })) {
      throw new Error('stale attestation');
    }
  } catch {
    throw new TranscriptionQualityEvalUsageError(
      'OPENROUTER_PRIVACY_POLICY_ATTESTATION must be regenerated for the current inference key, guardrail, model catalog, and privacy policy',
    );
  }
  const payload = parseOpenRouterPrivacyAttestationToken(token);
  if (!payload) {
    throw new TranscriptionQualityEvalUsageError(
      'OPENROUTER_PRIVACY_POLICY_ATTESTATION is invalid',
    );
  }
  return payload;
}

async function writeNewReport(
  outputPath: string,
  report: TranscriptionQualityEvalReport,
): Promise<void> {
  try {
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    throw new TranscriptionQualityEvalError(
      `Could not create the evidence artifact (${error instanceof Error ? error.name : 'unknown error'}); choose a new output path`,
    );
  }
}

export async function runTranscriptionQualityEvalCli(
  args: TranscriptionQualityEvalArgs,
  deps: TranscriptionQualityEvalCliDeps = {},
): Promise<void> {
  const apiKey = deps.apiKey ?? process.env.OPENROUTER_API_KEY;
  const privacyPolicyAttestation = requireCurrentOpenRouterPrivacyAttestation({
    apiKey,
    guardrailId: deps.guardrailId ?? process.env.OPENROUTER_GUARDRAIL_ID,
    token: deps.privacyPolicyAttestationToken ?? process.env.OPENROUTER_PRIVACY_POLICY_ATTESTATION,
  });
  const loadedManifest = await (deps.loadManifest ?? loadTranscriptionEvalManifest)(
    args.manifestPath,
  );
  let report: TranscriptionQualityEvalReport;
  if (deps.runEval) {
    report = await deps.runEval({
      loadedManifest,
      baselineModelId: args.baselineModelId,
      candidateModelIds: args.candidateModelIds,
      privacyPolicyAttestation,
      requestBudgetMs: args.requestBudgetMs,
      concurrency: args.concurrency,
    });
  } else {
    if (!apiKey?.trim()) {
      throw new TranscriptionQualityEvalUsageError(
        'OPENROUTER_API_KEY or TRANSCRIPTION_QUALITY_EVAL_ENV_FILE is required',
      );
    }
    report = await runTranscriptionQualityEval(
      {
        loadedManifest,
        baselineModelId: args.baselineModelId,
        candidateModelIds: args.candidateModelIds,
        privacyPolicyAttestation,
        requestBudgetMs: args.requestBudgetMs,
        concurrency: args.concurrency,
      },
      { transport: createOpenRouterTranscriptionEvalTransport({ apiKey }) },
    );
  }

  await (deps.writeReport ?? writeNewReport)(args.outputPath, report);
  (deps.write ?? console.log)(
    JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        outputPath: args.outputPath,
        corpusManifestSha256: report.corpus.manifestSha256,
        corpusAudioSha256: report.corpus.audioSha256,
        baselineModelId: report.baselineModelId,
        privacyPolicyVersion: report.privacyPolicyAttestation.policyVersion,
        candidateCount: report.candidateModelIds.length,
        selection: report.selection,
      },
      null,
      2,
    ),
  );
  if (args.requirePassingCandidate && report.selection.status !== 'candidate_passed') {
    (deps.setExitCode ?? ((code: number) => (process.exitCode = code)))(1);
  }
}

function usage(): string {
  return 'Usage: pnpm eval:transcription-quality:live -- --manifest=<approved-corpus-manifest.json> --out=<new-evidence-file.json> [--baseline=<current-production-model>] --candidate=<model-id> [--candidate=<model-id>] [--request-budget-ms=120000] [--concurrency=2] [--require-passing-candidate | --allow-no-passing-candidate]';
}

async function main(): Promise<void> {
  if (process.env.TRANSCRIPTION_QUALITY_EVAL_LIVE !== '1') {
    throw new TranscriptionQualityEvalUsageError(
      'Live provider calls require TRANSCRIPTION_QUALITY_EVAL_LIVE=1; use the root eval command',
    );
  }
  const envFile = process.env.TRANSCRIPTION_QUALITY_EVAL_ENV_FILE;
  if (envFile?.trim()) loadEnvFile(envFile);
  await runTranscriptionQualityEvalCli(parseTranscriptionQualityEvalArgs());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (
      error instanceof TranscriptionQualityEvalUsageError ||
      error instanceof TranscriptionEvalManifestError ||
      error instanceof TranscriptionQualityEvalError
    ) {
      console.error(`[transcription-quality-eval] ${error.message}`);
      if (error instanceof TranscriptionQualityEvalUsageError) console.error(usage());
      process.exit(2);
    }
    console.error('[transcription-quality-eval] failed without content-bearing diagnostics');
    process.exit(1);
  });
}
