import { type Db, mcpServers } from '@timeline/db';
import { childLogger, mcp, queue } from '@timeline/shared';
import { Worker, type Job } from 'bullmq';
import { and, eq, isNull, lte, or } from 'drizzle-orm';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:mcp-health');

interface HealthDeps {
  db: Db;
  manager?: Pick<ReturnType<typeof mcp.getMcpManager>, 'discoverTools' | 'invalidate'>;
}

interface HealthResult {
  checked: number;
  healthy: number;
  failed: number;
}

const PING_TIMEOUT_MS = 10_000;

export async function pingMcpServer(
  db: Db,
  serverId: string,
  manager: Pick<
    ReturnType<typeof mcp.getMcpManager>,
    'discoverTools' | 'invalidate'
  > = mcp.getMcpManager(),
): Promise<{ ok: boolean; error?: string }> {
  const rows = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  if (row.nextHealthCheckAt && row.nextHealthCheckAt.getTime() > Date.now()) {
    return { ok: !row.lastError, ...(row.lastError ? { error: row.lastError } : {}) };
  }
  const urlError = mcp.validateMcpUrl(row.url);
  if (urlError) {
    await db
      .update(mcpServers)
      .set({
        lastError: urlError,
        updatedAt: new Date(),
        healthFailures: row.healthFailures + 1,
        nextHealthCheckAt: new Date(Date.now() + 24 * 3600_000),
      })
      .where(eq(mcpServers.id, serverId));
    return { ok: false, error: urlError };
  }
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  const timeoutError = new Error('mcp_health_timeout');
  try {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
    }, PING_TIMEOUT_MS);
    await manager.discoverTools(db, row, {
      signal: controller.signal,
      timeoutMs: PING_TIMEOUT_MS,
    });
    await db
      .update(mcpServers)
      .set({
        lastConnectedAt: new Date(),
        nextHealthCheckAt: new Date(Date.now() + 24 * 3600_000),
        healthFailures: 0,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, serverId));
    return { ok: true };
  } catch (err) {
    const error =
      controller.signal.reason === timeoutError
        ? timeoutError.message
        : err instanceof Error
          ? err.message
          : String(err);
    await db
      .update(mcpServers)
      .set({
        lastError: error,
        updatedAt: new Date(),
        healthFailures: row.healthFailures + 1,
        nextHealthCheckAt: new Date(
          Math.max(
            Date.now() + ([1, 2, 4, 8, 24][Math.min(row.healthFailures, 4)] ?? 24) * 3600_000,
            err instanceof Error && 'retryAt' in err && err.retryAt instanceof Date
              ? err.retryAt.getTime()
              : 0,
          ),
        ),
      })
      .where(eq(mcpServers.id, serverId));
    return { ok: false, error };
  } finally {
    // Always clear the timer so a fast ping doesn't leave it pending for
    // the full 10s — adds up to thousands of dangling Timeout handles
    // across a healthy fleet on a 5-minute schedule.
    if (timer) clearTimeout(timer);
  }
}

export async function processMcpHealthTick(deps: HealthDeps): Promise<HealthResult> {
  const rows = await deps.db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.enabled, true),
        or(isNull(mcpServers.nextHealthCheckAt), lte(mcpServers.nextHealthCheckAt, new Date())),
      ),
    );
  let healthy = 0;
  let failed = 0;
  const manager = deps.manager ?? mcp.getMcpManager();
  for (const r of rows) {
    const res = await pingMcpServer(deps.db, r.id, manager);
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
    captureWorkerJobFailure(err, job);
  });
  return worker;
}
