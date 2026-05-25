/**
 * Phase 11 — Integration resync admin script.
 *
 * Re-runs sync for one or all enabled integrations in a team. Use
 * `--from-zero` to wipe the per-resource cursor first (full backfill);
 * default is incremental resume from the saved cursor.
 *
 * Usage:
 *   pnpm --filter @timeline/worker integration-resync -- \
 *     --team=<uuid> [--integration=<uuid>] [--from-zero] [--dry-run]
 */
import {
  closeDb,
  getDb,
  integrationSyncState,
  integrations as integrationsTable,
} from '@timeline/db';
import { queue } from '@timeline/shared';
import { and, eq } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Args {
  teamId: string;
  integrationId?: string;
  fromZero: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  let teamId = '';
  let integrationId: string | undefined;
  let fromZero = false;
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--integration=')) integrationId = arg.slice('--integration='.length);
    else if (arg === '--from-zero') fromZero = true;
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!UUID_RE.test(teamId)) throw new Error('--team=<uuid> is required');
  const out: Args = { teamId, fromZero, dryRun };
  if (integrationId) out.integrationId = integrationId;
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDb();
  try {
    const where = args.integrationId
      ? and(eq(integrationsTable.teamId, args.teamId), eq(integrationsTable.id, args.integrationId))
      : eq(integrationsTable.teamId, args.teamId);
    const rows = await db.select().from(integrationsTable).where(where);
    if (rows.length === 0) {
      console.log('No integrations matched.');
      return;
    }
    for (const r of rows) {
      console.log(
        `integration ${r.id} (${r.provider}) — ${args.fromZero ? 'backfill' : 'incremental'}${args.dryRun ? ' [dry-run]' : ''}`,
      );
      if (args.dryRun) continue;
      if (args.fromZero) {
        await db.delete(integrationSyncState).where(eq(integrationSyncState.integrationId, r.id));
      }
      await queue.enqueueIntegrationSyncJob({
        kind: args.fromZero ? 'backfill' : 'incremental',
        integrationId: r.id,
        teamId: r.teamId,
        triggeredBy: 'cli',
      });
    }
    console.log(`Enqueued ${String(rows.length)} sync job(s).`);
  } finally {
    await queue.closeIntegrationSyncQueue().catch(() => undefined);
    await queue.closeRedisConnection().catch(() => undefined);
    await closeDb().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
