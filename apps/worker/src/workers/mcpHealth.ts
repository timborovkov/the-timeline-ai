import { type Db, mcpServers } from '@timeline/db';
import { childLogger, mcp, queue } from '@timeline/shared';
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';

const log = childLogger('worker:mcp-health');

interface HealthDeps {
  db: Db;
}

interface HealthResult {
  checked: number;
  healthy: number;
  failed: number;
}

const PING_TIMEOUT_MS = 10_000;

async function pingServer(db: Db, serverId: string): Promise<{ ok: boolean; error?: string }> {
  // Reuse the existing manager's discoverTools handshake — it already does
  // the initialize + tools/list round trip and updates lastConnectedAt /
  // lastError as a side effect. We invalidate first so the cache won't
  // mask a freshly-broken server.
  const mgr = mcp.getMcpManager();
  mgr.invalidate(serverId);
  const rows = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  try {
    await Promise.race([
      mgr.discoverTools(db, row),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('mcp_health_timeout'));
        }, PING_TIMEOUT_MS);
      }),
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function processMcpHealthTick(deps: HealthDeps): Promise<HealthResult> {
  const rows = await deps.db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true));
  let healthy = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await pingServer(deps.db, r.id);
    if (res.ok) healthy++;
    else failed++;
  }
  return { checked: rows.length, healthy, failed };
}

export function startMcpHealthWorker(deps: { db: Db }): Worker<queue.McpHealthJobData> {
  const worker = new Worker<queue.McpHealthJobData>(
    queue.QUEUE_NAMES.mcpHealth,
    async (job: Job<queue.McpHealthJobData>) => {
      const startedAt = Date.now();
      const result = await processMcpHealthTick({ db: deps.db });
      const durationMs = Date.now() - startedAt;
      log.info({ jobId: job.id, ...result, durationMs }, 'mcp health tick');
      return { ...result, durationMs };
    },
    {
      connection: queue.getRedisConnection(),
      // Singleton — concurrent ticks would just duplicate pings; discovery
      // is naturally idempotent (re-querying tools/list is harmless).
      concurrency: 1,
    },
  );
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'mcp health tick failed');
  });
  return worker;
}
