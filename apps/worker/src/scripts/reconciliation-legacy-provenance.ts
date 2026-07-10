/**
 * Legacy reconciliation provenance cutover audit.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reconciliation-legacy-provenance -- --team=<uuid>
 *   TIMELINE_ENV_FILE=/path/to/.env pnpm --filter @timeline/worker reconciliation-legacy-provenance -- --team=<uuid>
 *
 * Optional:
 *   --fail-on-legacy   Exit 1 when any legacy object/board provenance rows remain.
 */
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';

import { closeDb, getDb, type Db } from '@timeline/db';
import { auditLegacyProvenanceCutover } from '@timeline/shared/reconciliation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Args {
  teamId: string;
  failOnLegacy: boolean;
}

export interface ReconciliationLegacyProvenanceCliDeps {
  db: Db;
  audit?: typeof auditLegacyProvenanceCutover;
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
}

export class ReconciliationLegacyProvenanceUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationLegacyProvenanceUsageError';
  }
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  let teamId: string | undefined;
  let failOnLegacy = false;

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    } else if (arg.startsWith('--team=')) {
      teamId = arg.slice('--team='.length).trim();
    } else if (arg === '--fail-on-legacy') {
      failOnLegacy = true;
    } else {
      throwUsage(`Unknown argument: ${arg}`);
    }
  }

  if (!teamId || !UUID_RE.test(teamId)) throwUsage('Missing or invalid --team=<uuid>');
  return { teamId, failOnLegacy };
}

function throwUsage(reason: string): never {
  throw new ReconciliationLegacyProvenanceUsageError(reason);
}

function usage(): string {
  return 'Usage: reconciliation-legacy-provenance --team=<uuid> [--fail-on-legacy]';
}

export async function runReconciliationLegacyProvenanceCli(
  args: Args,
  deps: ReconciliationLegacyProvenanceCliDeps,
): Promise<void> {
  const audit = deps.audit ?? auditLegacyProvenanceCutover;
  const write = deps.write ?? console.log;
  const setExitCode = deps.setExitCode ?? ((code: number) => (process.exitCode = code));

  const report = await audit({ db: deps.db, teamId: args.teamId });
  write(
    JSON.stringify({ mode: 'legacy_provenance_cutover', teamId: args.teamId, report }, null, 2),
  );
  if (args.failOnLegacy && report.totalRows > 0) setExitCode(1);
}

async function main(): Promise<void> {
  loadOptionalEnvFile();
  let args: Args;
  try {
    args = parseArgs();
  } catch (err) {
    if (err instanceof ReconciliationLegacyProvenanceUsageError) {
      console.error(`[reconciliation-legacy-provenance] ${err.message}`);
      console.error(usage());
      process.exit(2);
    }
    throw err;
  }

  const db = getDb();
  try {
    await runReconciliationLegacyProvenanceCli(args, { db });
  } finally {
    await closeDb();
  }
}

function loadOptionalEnvFile(): void {
  const envFile =
    process.env.TIMELINE_ENV_FILE ?? process.env.RECONCILIATION_LEGACY_PROVENANCE_ENV_FILE;
  if (envFile?.trim()) loadEnvFile(envFile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('[reconciliation-legacy-provenance] failed', err);
    process.exit(1);
  });
}
