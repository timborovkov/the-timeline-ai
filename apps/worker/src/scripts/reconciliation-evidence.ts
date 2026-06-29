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
 *   --all           backfill already-covered raw events too
 */
import { closeDb, getDb } from '@timeline/db';
import {
  auditReconciliationEvidenceCoverage,
  backfillReconciliationEvidence,
  isReconciliationEvidenceSource,
  type ReconciliationEvidenceSource,
} from '@timeline/shared/reconciliation/backfill';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Mode = 'audit' | 'backfill';

interface Args {
  teamId: string;
  mode: Mode;
  source?: ReconciliationEvidenceSource;
  limit?: number;
  pageSize?: number;
  dryRun: boolean;
  all: boolean;
}

function parseArgs(): Args {
  let teamId: string | undefined;
  let mode: Mode = 'audit';
  let source: ReconciliationEvidenceSource | undefined;
  let limit: number | undefined;
  let pageSize: number | undefined;
  let dryRun = false;
  let all = false;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--team=')) {
      teamId = arg.slice('--team='.length);
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value === 'audit' || value === 'backfill') mode = value;
      else failUsage(`Unknown mode: ${value}`);
    } else if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length);
      if (!isReconciliationEvidenceSource(value)) failUsage(`Unknown source: ${value}`);
      source = value;
    } else if (arg.startsWith('--limit=')) {
      limit = parsePositiveInt(arg, '--limit=');
    } else if (arg.startsWith('--page-size=')) {
      pageSize = parsePositiveInt(arg, '--page-size=');
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--all') {
      all = true;
    } else {
      failUsage(`Unknown argument: ${arg}`);
    }
  }

  if (!teamId || !UUID_RE.test(teamId)) failUsage('Missing or invalid --team=<uuid>');

  const parsed: Args = { teamId, mode, dryRun, all };
  if (source) parsed.source = source;
  if (limit !== undefined) parsed.limit = limit;
  if (pageSize !== undefined) parsed.pageSize = pageSize;
  return parsed;
}

function parsePositiveInt(arg: string, prefix: string): number {
  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  if (!Number.isFinite(parsed) || parsed < 0) failUsage(`Expected ${prefix}<non-negative integer>`);
  return parsed;
}

function failUsage(reason: string): never {
  console.error(`[reconciliation-evidence] ${reason}`);
  console.error(
    'Usage: reconciliation-evidence --team=<uuid> [--mode=audit|backfill] [--source=<event_source>] [--limit=N] [--page-size=N] [--dry-run] [--all]',
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDb();

  try {
    if (args.mode === 'audit') {
      const input: Parameters<typeof auditReconciliationEvidenceCoverage>[0] = {
        db,
        teamId: args.teamId,
      };
      if (args.source) input.source = args.source;
      if (args.limit !== undefined) input.limit = args.limit;
      if (args.pageSize !== undefined) input.pageSize = args.pageSize;

      const report = await auditReconciliationEvidenceCoverage(input);
      console.log(JSON.stringify({ mode: args.mode, report }, null, 2));
      return;
    }

    const input: Parameters<typeof backfillReconciliationEvidence>[0] = {
      db,
      teamId: args.teamId,
      dryRun: args.dryRun,
      missingOnly: !args.all,
    };
    if (args.source) input.source = args.source;
    if (args.limit !== undefined) input.limit = args.limit;
    if (args.pageSize !== undefined) input.pageSize = args.pageSize;

    const result = await backfillReconciliationEvidence(input);
    console.log(JSON.stringify({ mode: args.mode, result }, null, 2));
  } finally {
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error('[reconciliation-evidence] failed', err);
  process.exit(1);
});
