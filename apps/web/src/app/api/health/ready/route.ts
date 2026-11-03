import { timingSafeEqual } from 'node:crypto';

import { getEnv } from '@timeline/shared/env';

import { requireRedisQueue } from '@/lib/queue';

export const dynamic = 'force-dynamic';

/** Operator-only queue readiness; the public liveness endpoint stays minimal. */
export async function GET(req: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  const headers = { 'Cache-Control': 'no-store' };
  if (!secret) return Response.json({ ok: false }, { status: 503, headers });
  const supplied = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const inspect = async () => {
      const queue = await requireRedisQueue();
      const queues = [
        queue.getExtractQueue(),
        queue.getEmbedQueue(),
        queue.getIntegrationSyncQueue(),
        queue.getWebhookDeliveryQueue(),
      ];
      return Promise.all(
        queues.map(async (item) => {
          const [counts, workers, jobs] = await Promise.all([
            item.getJobCounts('waiting', 'active', 'failed'),
            item.getWorkers(),
            item.getJobs(['waiting'], 0, 0, true),
          ]);
          const oldestWaitingMs = jobs[0] ? Math.max(0, Date.now() - jobs[0].timestamp) : 0;
          return {
            queue: item.name,
            workers: workers.length,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            failed: counts.failed ?? 0,
            oldestWaitingMs,
            ready: workers.length > 0 && oldestWaitingMs < 30 * 60_000,
          };
        }),
      );
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('queue_readiness_timeout'));
      }, 5000);
    });
    const queues = await Promise.race([inspect(), timeout]);
    const ok = queues.every((queue) => queue.ready);
    return Response.json({ ok, queues }, { status: ok ? 200 : 503, headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
