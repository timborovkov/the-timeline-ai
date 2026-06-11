/**
 * Approval dedupe script. Scans a team's active approval queue and supersedes
 * stale duplicate pending items using the same conservative reconciliation
 * predicate the app runs for new suggestions.
 *
 * Usage:
 *   pnpm --filter @timeline/worker dedupe-approvals -- --team=<teamId> [--limit=N] [--apply]
 *
 * Defaults to dry-run. Pass --apply to write superseded approval state.
 * Requires DATABASE_URL.
 */
import { closeDb, getDb } from '@timeline/db';
import { withTeam } from '@timeline/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';

function parseArgs(): { teamId: string; limit: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = 2000;
  let dryRun = true;

  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error('Invalid --limit. Use a positive integer.');
        process.exit(2);
      }
      limit = parsed;
    } else if (arg === '--apply') {
      dryRun = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!teamId || !UUID_RE.test(teamId)) {
    console.error('Usage: dedupe-approvals --team=<uuid> [--limit=N] [--apply]');
    process.exit(2);
  }

  return { teamId, limit, dryRun };
}

async function main(): Promise<void> {
  const { teamId, limit, dryRun } = parseArgs();
  console.log(
    `[dedupe-approvals] team=${teamId} limit=${limit} mode=${dryRun ? 'dry-run' : 'apply'}`,
  );

  const db = getDb();
  const scope = withTeam(db, teamId, PSEUDO_USER, { skipMembershipCheck: true });
  const result = await scope.suggestions.reconcileDuplicatePendingApprovals({ dryRun, limit });

  console.log(
    `[dedupe-approvals] scanned=${result.scanned} superseded=${result.superseded}${
      dryRun ? ' (dry-run, no rows changed)' : ''
    }`,
  );
  for (const pair of result.pairs.slice(0, 50)) {
    console.log(
      `[dedupe-approvals] ${pair.supersededItemId} -> ${pair.survivorItemId} (${pair.reason})`,
    );
  }
  if (result.pairs.length > 50) {
    console.log(`[dedupe-approvals] ... ${result.pairs.length - 50} more`);
  }

  await closeDb();
}

main().catch((err: unknown) => {
  console.error('[dedupe-approvals] failed', err);
  process.exit(1);
});
