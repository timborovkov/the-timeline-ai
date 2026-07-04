/**
 * Reconciliation evidence coverage + backfill.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=audit
 *   pnpm --filter @timeline/worker reconciliation-evidence -- --team=<uuid> --mode=backfill [--dry-run]
 *
 * Optional:
 *   --source=email|slack|integration|...
 *   --limit=N       audit: raw rows inspected; backfill: candidate rows normalized
 *   --page-size=N   max 500
 *   --allow-degraded-source=web   audit only; repeat for known legacy degraded rows
 *   --fail-on-release-gate        audit only; exit 1 when missing/degraded rows fail
 *   --all           backfill already-covered raw events too
 */
import { pathToFileURL } from 'node:url';

import { closeDb, getDb } from '@timeline/db';
import {
  auditReconciliationEvidenceCoverage,
  backfillReconciliationEvidence,
  isReconciliationEvidenceSource,
  type ReconciliationEvidenceSource,
} from '@timeline/shared/reconciliation/backfill';

import type { Db } from '@timeline/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Mode = 'audit' | 'backfill';

export interface Args {
  teamId: string;
  mode: Mode;
  source?: ReconciliationEvidenceSource;
  limit?: number;
  pageSize?: number;
  dryRun: boolean;
  all: boolean;
  allowedDegradedReplaySources: ReconciliationEvidenceSource[];
  failOnReleaseGate: boolean;
}

export interface ReconciliationEvidenceCliDeps {
  db: Db;
  audit?: typeof auditReconciliationEvidenceCoverage;
  backfill?: typeof backfillReconciliationEvidence;
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
}

export class ReconciliationEvidenceUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationEvidenceUsageError';
  }
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  let teamId: string | undefined;
  let mode: Mode = 'audit';
  let source: ReconciliationEvidenceSource | undefined;
  let limit: number | undefined;
  let pageSize: number | undefined;
  let dryRun = false;
  let all = false;
  const allowedDegradedReplaySources: ReconciliationEvidenceSource[] = [];
  let failOnReleaseGate = false;

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    } else if (arg.startsWith('--team=')) {
      teamId = arg.slice('--team='.length);
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value === 'audit' || value === 'backfill') mode = value;
      else throwUsage(`Unknown mode: ${value}`);
    } else if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length);
      if (!isReconciliationEvidenceSource(value)) throwUsage(`Unknown source: ${value}`);
      source = value;
    } else if (arg.startsWith('--limit=')) {
      limit = parsePositiveInt(arg, '--limit=');
    } else if (arg.startsWith('--page-size=')) {
      pageSize = parsePositiveInt(arg, '--page-size=');
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--all') {
      all = true;
    } else if (arg.startsWith('--allow-degraded-source=')) {
      const value = arg.slice('--allow-degraded-source='.length);
      if (!isReconciliationEvidenceSource(value)) throwUsage(`Unknown degraded source: ${value}`);
      allowedDegradedReplaySources.push(value);
    } else if (arg === '--fail-on-release-gate') {
      failOnReleaseGate = true;
    } else {
      throwUsage(`Unknown argument: ${arg}`);
    }
  }

  if (!teamId || !UUID_RE.test(teamId)) throwUsage('Missing or invalid --team=<uuid>');

  const parsed: Args = {
    teamId,
    mode,
    dryRun,
    all,
    allowedDegradedReplaySources,
    failOnReleaseGate,
  };
  if (source) parsed.source = source;
  if (limit !== undefined) parsed.limit = limit;
  if (pageSize !== undefined) parsed.pageSize = pageSize;
  return parsed;
}

function parsePositiveInt(arg: string, prefix: string): number {
  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throwUsage(`Expected ${prefix}<non-negative integer>`);
  }
  return parsed;
}

function throwUsage(reason: string): never {
  throw new ReconciliationEvidenceUsageError(reason);
}

function usage(): string {
  return 'Usage: reconciliation-evidence --team=<uuid> [--mode=audit|backfill] [--source=<event_source>] [--limit=N] [--page-size=N] [--dry-run] [--all] [--allow-degraded-source=<event_source>] [--fail-on-release-gate]';
}

export async function runReconciliationEvidenceCli(
  args: Args,
  deps: ReconciliationEvidenceCliDeps,
): Promise<void> {
  const audit = deps.audit ?? auditReconciliationEvidenceCoverage;
  const backfill = deps.backfill ?? backfillReconciliationEvidence;
  const write = deps.write ?? console.log;
  const setExitCode = deps.setExitCode ?? ((code: number) => (process.exitCode = code));

  if (args.mode === 'audit') {
    const input: Parameters<typeof auditReconciliationEvidenceCoverage>[0] = {
      db: deps.db,
      teamId: args.teamId,
    };
    if (args.source) input.source = args.source;
    if (args.limit !== undefined) input.limit = args.limit;
    if (args.pageSize !== undefined) input.pageSize = args.pageSize;
    if (args.allowedDegradedReplaySources.length > 0) {
      input.allowedDegradedReplaySources = args.allowedDegradedReplaySources;
    }

    const report = await audit(input);
    write(JSON.stringify({ mode: args.mode, report }, null, 2));
    if (args.failOnReleaseGate && !report.releaseGate.passed) setExitCode(1);
    return;
  }

  const input: Parameters<typeof backfillReconciliationEvidence>[0] = {
    db: deps.db,
    teamId: args.teamId,
    dryRun: args.dryRun,
    missingOnly: !args.all,
  };
  if (args.source) input.source = args.source;
  if (args.limit !== undefined) input.limit = args.limit;
  if (args.pageSize !== undefined) input.pageSize = args.pageSize;

  const result = await backfill(input);
  write(JSON.stringify({ mode: args.mode, result }, null, 2));
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs();
  } catch (err) {
    if (err instanceof ReconciliationEvidenceUsageError) {
      console.error(`[reconciliation-evidence] ${err.message}`);
      console.error(usage());
      process.exit(2);
    }
    throw err;
  }

  const db = getDb();
  try {
    await runReconciliationEvidenceCli(args, { db });
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('[reconciliation-evidence] failed', err);
    process.exit(1);
  });
}
