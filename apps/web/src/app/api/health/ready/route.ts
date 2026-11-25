import { getEnv } from '@timeline/shared/env';

import {
  authorizeOperatorProbe,
  boundedProbe,
  operatorProbeHeaders,
  probeUnavailable,
} from '@/lib/operator-probe';
import { requireRedisQueue } from '@/lib/queue';

export const dynamic = 'force-dynamic';

/** Operator-only queue availability. Processing lag is checked independently. */
export async function GET(req: Request): Promise<Response> {
  const env = getEnv();
  const denied = authorizeOperatorProbe(req, env.CRON_SECRET);
  if (denied) return denied;
  try {
    const queues = await boundedProbe(async () => {
      const queue = await requireRedisQueue();
      const required = [
        queue.getExtractQueue(),
        queue.getEmbedQueue(),
        queue.getIntegrationSyncQueue(),
        queue.getWebhookDeliveryQueue(),
        queue.getTranscribeQueue(),
        queue.getSuggestionQueue(),
        queue.getReconciliationQueue(),
        queue.getDailyDigestQueue(),
        queue.getScheduledUpdatesQueue(),
        ...(env.DOCUMENT_EXTRACT_ENABLED ? [queue.getDocumentExtractQueue()] : []),
      ];
      return Promise.all(
        required.map(async (item) => {
          const workers = await item.getWorkers();
          return { queue: item.name, workers: workers.length, ready: workers.length > 0 };
        }),
      );
    });
    const ok = queues.every((queue) => queue.ready);
    return Response.json({ ok, queues }, { status: ok ? 200 : 503, headers: operatorProbeHeaders });
  } catch {
    return probeUnavailable();
  }
}
