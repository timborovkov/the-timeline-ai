/**
 * Build a redacted production-sampling report from reconciliation live-eval artifacts.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reconciliation-production-sampling -- --input=/tmp/eval-run --out=/tmp/report.json
 *   TIMELINE_ENV_FILE=/path/to/.env pnpm --filter @timeline/worker reconciliation-production-sampling -- --input=/tmp/eval-run --out=/tmp/report.json --team=<uuid>
 *
 * Optional:
 *   --input=/path     Repeatable. Accepts live-eval run directories or JSON files.
 *   --team=<uuid>     Persist the report as a dashboard-visible reconciliation eval run.
 *   --run-kind=closed_beta|post_deploy|manual
 *   --fail-on-failures    Exit 1 when the report contains any failed sample.
 *   --confirm-fixture=<caseName>:<packetFingerprint>   Repeatable confirmed fixture candidate.
 *   --evidence-pack-samples=/path/to/redacted-samples.json   Repeatable sample input.
 *   --required-evidence-scenario=<name>   Repeatable required promotion scenario family.
 */
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';

import { closeDb, getDb, type Db } from '@timeline/db';
import {
  parseProductionSamplingEvidencePackSamples,
  writeProductionSamplingEvalReport,
  type ProductionSamplingEvidencePackSample,
  type ProductionSamplingRunKind,
} from '@timeline/shared/reconciliation/production-sampling';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Args {
  inputPaths: string[];
  outputPath: string;
  teamId?: string;
  runKind: ProductionSamplingRunKind;
  failOnFailures: boolean;
  confirmedFixtureCandidates: { caseName: string; packetFingerprint: string }[];
  evidencePackSamplePaths: string[];
  requiredEvidencePackScenarioFamilies: string[];
}

export interface ReconciliationProductionSamplingCliDeps {
  writeReport?: typeof writeProductionSamplingEvalReport;
  db?: Db;
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
  loadEvidencePackSamples?: (paths: string[]) => Promise<ProductionSamplingEvidencePackSample[]>;
}

export class ReconciliationProductionSamplingUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationProductionSamplingUsageError';
  }
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  const inputPaths: string[] = [];
  let outputPath: string | undefined;
  let teamId: string | undefined;
  let runKind: ProductionSamplingRunKind = 'manual';
  let failOnFailures = false;
  const confirmedFixtureCandidates: { caseName: string; packetFingerprint: string }[] = [];
  const evidencePackSamplePaths: string[] = [];
  const requiredEvidencePackScenarioFamilies: string[] = [];

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    } else if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length).trim();
      if (!value) throwUsage('Empty --input value');
      inputPaths.push(value);
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length).trim();
      if (!value) throwUsage('Empty --out value');
      outputPath = value;
    } else if (arg.startsWith('--team=')) {
      const value = arg.slice('--team='.length).trim();
      if (!UUID_RE.test(value)) throwUsage('Expected --team=<uuid>');
      teamId = value;
    } else if (arg.startsWith('--run-kind=')) {
      const value = arg.slice('--run-kind='.length);
      if (value === 'closed_beta' || value === 'post_deploy' || value === 'manual') {
        runKind = value;
      } else {
        throwUsage(`Unknown run kind: ${value}`);
      }
    } else if (arg === '--fail-on-failures') {
      failOnFailures = true;
    } else if (arg.startsWith('--confirm-fixture=')) {
      confirmedFixtureCandidates.push(
        parseConfirmedFixture(arg.slice('--confirm-fixture='.length)),
      );
    } else if (arg.startsWith('--evidence-pack-samples=')) {
      const value = arg.slice('--evidence-pack-samples='.length).trim();
      if (!value) throwUsage('Empty --evidence-pack-samples value');
      evidencePackSamplePaths.push(value);
    } else if (arg.startsWith('--required-evidence-scenario=')) {
      const value = arg.slice('--required-evidence-scenario='.length).trim();
      if (!value) throwUsage('Empty --required-evidence-scenario value');
      requiredEvidencePackScenarioFamilies.push(value);
    } else {
      throwUsage(`Unknown argument: ${arg}`);
    }
  }

  if (inputPaths.length === 0) throwUsage('Missing --input=<artifact directory or file>');
  if (!outputPath) throwUsage('Missing --out=<report.json>');
  if (evidencePackSamplePaths.length > 0 && requiredEvidencePackScenarioFamilies.length === 0) {
    throwUsage('Evidence-pack promotion samples require at least one --required-evidence-scenario');
  }

  return {
    inputPaths,
    outputPath,
    ...(teamId ? { teamId } : {}),
    runKind,
    failOnFailures,
    confirmedFixtureCandidates,
    evidencePackSamplePaths,
    requiredEvidencePackScenarioFamilies: [...new Set(requiredEvidencePackScenarioFamilies)].sort(),
  };
}

function throwUsage(reason: string): never {
  throw new ReconciliationProductionSamplingUsageError(reason);
}

function parseConfirmedFixture(value: string): { caseName: string; packetFingerprint: string } {
  const separator = value.lastIndexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throwUsage('Expected --confirm-fixture=<caseName>:<packetFingerprint>');
  }
  const caseName = value.slice(0, separator).trim();
  const packetFingerprint = value.slice(separator + 1).trim();
  if (!caseName || !packetFingerprint) {
    throwUsage('Expected --confirm-fixture=<caseName>:<packetFingerprint>');
  }
  return { caseName, packetFingerprint };
}

function usage(): string {
  return 'Usage: reconciliation-production-sampling --input=<artifact-dir-or-json> [--input=<more>] --out=<report.json> [--team=<uuid>] [--run-kind=closed_beta|post_deploy|manual] [--fail-on-failures] [--confirm-fixture=<caseName>:<packetFingerprint>] [--evidence-pack-samples=<redacted-samples.json> --required-evidence-scenario=<name>]';
}

async function loadEvidencePackSamples(
  paths: readonly string[],
): Promise<ProductionSamplingEvidencePackSample[]> {
  const samples: ProductionSamplingEvidencePackSample[] = [];
  for (const inputPath of paths) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
    } catch (error) {
      throw new ReconciliationProductionSamplingUsageError(
        `Could not read evidence-pack samples from ${inputPath}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
    try {
      samples.push(...parseProductionSamplingEvidencePackSamples(parsed));
    } catch (error) {
      throw new ReconciliationProductionSamplingUsageError(
        `Invalid evidence-pack samples in ${inputPath}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
  return samples;
}

export async function runReconciliationProductionSamplingCli(
  args: Args,
  deps: ReconciliationProductionSamplingCliDeps = {},
): Promise<void> {
  const writeReport = deps.writeReport ?? writeProductionSamplingEvalReport;
  const evidencePackSamples = await (deps.loadEvidencePackSamples ?? loadEvidencePackSamples)(
    args.evidencePackSamplePaths,
  );
  const write = deps.write ?? console.log;
  const setExitCode = deps.setExitCode ?? ((code: number) => (process.exitCode = code));
  if (args.teamId && !deps.db) {
    throw new ReconciliationProductionSamplingUsageError(
      'Persisting production sampling requires a database connection',
    );
  }
  const written = await writeReport({
    inputPaths: args.inputPaths,
    outputPath: args.outputPath,
    runKind: args.runKind,
    confirmedFixtureCandidates: args.confirmedFixtureCandidates,
    ...(evidencePackSamples.length > 0 ? { evidencePackSamples } : {}),
    ...(args.requiredEvidencePackScenarioFamilies.length > 0
      ? { requiredEvidencePackScenarioFamilies: args.requiredEvidencePackScenarioFamilies }
      : {}),
    ...(args.teamId && deps.db ? { teamId: args.teamId, db: deps.db } : {}),
  });

  write(
    JSON.stringify(
      {
        outputPath: written.path,
        runKind: written.report.runKind,
        manifestCount: written.report.manifestCount,
        sampleCount: written.report.sampleCount,
        passedCount: written.report.passedCount,
        failedCount: written.report.failedCount,
        passRate: written.report.passRate,
        fixtureCandidateCount: written.report.fixtureCandidateCount,
        confirmedFixtureCandidateCount: written.report.confirmedFixtureCandidateCount,
        unconfirmedFixtureCandidateCount: written.report.unconfirmedFixtureCandidateCount,
        evidencePackPromotion: written.report.evidencePackPromotion ?? null,
        runId: written.runId ?? null,
        ignoredFiles: written.loaded.ignoredFiles,
      },
      null,
      2,
    ),
  );
  if (
    args.failOnFailures &&
    (written.report.failedCount > 0 || written.report.evidencePackPromotion?.ready === false)
  ) {
    setExitCode(1);
  }
}

async function main(): Promise<void> {
  loadOptionalEnvFile();
  let args: Args;
  try {
    args = parseArgs();
  } catch (err) {
    if (err instanceof ReconciliationProductionSamplingUsageError) {
      console.error(`[reconciliation-production-sampling] ${err.message}`);
      console.error(usage());
      process.exit(2);
    }
    throw err;
  }

  if (!args.teamId) {
    await runReconciliationProductionSamplingCli(args);
    return;
  }

  const db = getDb();
  try {
    await runReconciliationProductionSamplingCli(args, { db });
  } finally {
    await closeDb();
  }
}

function loadOptionalEnvFile(): void {
  const envFile =
    process.env.TIMELINE_ENV_FILE ?? process.env.RECONCILIATION_PRODUCTION_SAMPLING_ENV_FILE;
  if (envFile?.trim()) loadEnvFile(envFile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('[reconciliation-production-sampling] failed', err);
    process.exit(1);
  });
}
