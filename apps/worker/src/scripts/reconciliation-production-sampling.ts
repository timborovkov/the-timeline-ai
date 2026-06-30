/**
 * Build a redacted production-sampling report from reconciliation live-eval artifacts.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reconciliation-production-sampling -- --input=/tmp/eval-run --out=/tmp/report.json
 *
 * Optional:
 *   --input=/path     Repeatable. Accepts live-eval run directories or JSON files.
 *   --run-kind=closed_beta|post_deploy|manual
 */
import {
  writeProductionSamplingEvalReport,
  type ProductionSamplingRunKind,
} from '@timeline/shared/reconciliation/production-sampling';

interface Args {
  inputPaths: string[];
  outputPath: string;
  runKind: ProductionSamplingRunKind;
}

function parseArgs(): Args {
  const inputPaths: string[] = [];
  let outputPath: string | undefined;
  let runKind: ProductionSamplingRunKind = 'manual';

  for (const arg of process.argv.slice(2)) {
    if (arg === '--') {
      continue;
    } else if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length).trim();
      if (!value) failUsage('Empty --input value');
      inputPaths.push(value);
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length).trim();
      if (!value) failUsage('Empty --out value');
      outputPath = value;
    } else if (arg.startsWith('--run-kind=')) {
      const value = arg.slice('--run-kind='.length);
      if (value === 'closed_beta' || value === 'post_deploy' || value === 'manual') {
        runKind = value;
      } else {
        failUsage(`Unknown run kind: ${value}`);
      }
    } else {
      failUsage(`Unknown argument: ${arg}`);
    }
  }

  if (inputPaths.length === 0) failUsage('Missing --input=<artifact directory or file>');
  if (!outputPath) failUsage('Missing --out=<report.json>');

  return { inputPaths, outputPath, runKind };
}

function failUsage(reason: string): never {
  console.error(`[reconciliation-production-sampling] ${reason}`);
  console.error(
    'Usage: reconciliation-production-sampling --input=<artifact-dir-or-json> [--input=<more>] --out=<report.json> [--run-kind=closed_beta|post_deploy|manual]',
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const written = await writeProductionSamplingEvalReport({
    inputPaths: args.inputPaths,
    outputPath: args.outputPath,
    runKind: args.runKind,
  });

  console.log(
    JSON.stringify(
      {
        outputPath: written.path,
        runKind: written.report.runKind,
        manifestCount: written.report.manifestCount,
        sampleCount: written.report.sampleCount,
        passedCount: written.report.passedCount,
        failedCount: written.report.failedCount,
        passRate: written.report.passRate,
        ignoredFiles: written.loaded.ignoredFiles,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error('[reconciliation-production-sampling] failed', err);
  process.exit(1);
});
