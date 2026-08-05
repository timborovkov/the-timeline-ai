import { type Db } from '@timeline/db';
import { childLogger, integrations as integrationsLib, queue } from '@timeline/shared';
import { Worker, type Job } from 'bullmq';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:webhook-delivery');

interface WebhookDeliveryWorkerDeps {
  db: Db;
}

export interface WebhookDeliveryProcessResult {
  deliveryId: string;
  processed: number;
  ignored: number;
  failed: number;
  skipped?: boolean;
}

function normalizeWebhookResult(
  result: Awaited<ReturnType<NonNullable<integrationsLib.IntegrationProvider['handleWebhook']>>>,
): {
  events: integrationsLib.IntegrationEvent[];
  syncTasks: integrationsLib.TargetedSyncTask[];
  syncTaskDisposition?: 'handled';
} {
  if (Array.isArray(result)) return { events: result, syncTasks: [] };
  return {
    events: result.events,
    syncTasks: result.syncTasks,
    ...(result.syncTaskDisposition ? { syncTaskDisposition: result.syncTaskDisposition } : {}),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function catchUpTask(
  integration: integrationsLib.IntegrationRow,
): integrationsLib.TargetedSyncTask {
  return {
    integrationId: integration.id,
    teamId: integration.teamId,
    triggeredBy: 'webhook',
    resourceType: '__integration__',
    externalId: integration.id,
    reason: 'webhook_catch_up',
  };
}

function isTerminalDeliveryStatus(status: string): boolean {
  return status === 'processed' || status === 'ignored' || status === 'dead_lettered';
}

export async function processWebhookDeliveryJob(
  deps: WebhookDeliveryWorkerDeps,
  data: queue.WebhookDeliveryJobData,
): Promise<WebhookDeliveryProcessResult> {
  const work = await integrationsLib.loadWebhookDeliveryWork(deps.db, data.deliveryId);
  if (!work) {
    return { deliveryId: data.deliveryId, processed: 0, ignored: 0, failed: 0, skipped: true };
  }

  if (work.targets.length === 0) {
    if (isTerminalDeliveryStatus(work.delivery.status)) {
      return {
        deliveryId: work.delivery.id,
        processed: 0,
        ignored: 0,
        failed: 0,
        skipped: true,
      };
    }
    await integrationsLib.markWebhookDeliveryStatus(deps.db, work.delivery.id, 'ignored');
    return { deliveryId: work.delivery.id, processed: 0, ignored: 0, failed: 0 };
  }

  await integrationsLib.markWebhookDeliveryStatus(deps.db, work.delivery.id, 'processing');

  let processed = 0;
  let ignored = 0;
  const failures: string[] = [];
  if (!integrationsLib.isNativeProviderId(work.delivery.provider)) {
    await integrationsLib.markWebhookDeliveryStatus(
      deps.db,
      work.delivery.id,
      'ignored',
      'provider_not_native',
    );
    return { deliveryId: work.delivery.id, processed: 0, ignored: 0, failed: 0 };
  }
  const provider = integrationsLib.getProvider(work.delivery.provider);

  for (const { target, integration } of work.targets) {
    await integrationsLib.markWebhookDeliveryTargetProcessing(deps.db, target.id);
    if (!integration) {
      ignored += 1;
      await integrationsLib.markWebhookDeliveryTargetIgnored(
        deps.db,
        target.id,
        'integration_missing',
      );
      continue;
    }
    if (!integration.enabled) {
      ignored += 1;
      await integrationsLib.markWebhookDeliveryTargetIgnored(
        deps.db,
        target.id,
        'integration_disabled',
      );
      continue;
    }
    if (integration.provider !== work.delivery.provider) {
      ignored += 1;
      await integrationsLib.markWebhookDeliveryTargetIgnored(
        deps.db,
        target.id,
        'integration_provider_mismatch',
      );
      continue;
    }
    if (!provider.handleWebhook) {
      ignored += 1;
      await integrationsLib.markWebhookDeliveryTargetIgnored(
        deps.db,
        target.id,
        'provider_webhook_normalizer_missing',
      );
      continue;
    }

    try {
      const normalized = normalizeWebhookResult(
        await provider.handleWebhook({
          integration,
          payload: work.delivery.payload,
        }),
      );
      const { events } = normalized;
      const policy = integrationsLib.providerSyncPolicy(work.delivery.provider);
      const syncTasks =
        normalized.syncTasks.length > 0
          ? normalized.syncTasks.flatMap((task) =>
              task.resourceType === '__integration__' || policy.supportsTargetedSync
                ? [task]
                : [catchUpTask(integration)],
            )
          : normalized.syncTaskDisposition === 'handled'
            ? []
            : [catchUpTask(integration)];
      if (events.length > 0) {
        await integrationsLib.writeIntegrationEvents({
          db: deps.db,
          integration,
          events,
        });
      }
      for (const task of syncTasks) {
        if (task.resourceType === '__integration__') {
          await queue.enqueueIntegrationSyncJob({
            kind: 'incremental',
            integrationId: integration.id,
            teamId: integration.teamId,
            triggeredBy: task.triggeredBy,
          });
        } else {
          await queue.enqueueIntegrationSyncJob({
            kind: 'targeted',
            integrationId: task.integrationId,
            teamId: task.teamId,
            triggeredBy: task.triggeredBy,
            resourceType: task.resourceType,
            externalId: task.externalId,
            ...(task.surface ? { surface: task.surface } : {}),
            ...(task.reason ? { reason: task.reason } : {}),
          });
        }
      }
      await integrationsLib.markWebhookDeliveryTargetProcessed(deps.db, target.id, {
        eventDedupKeys: events.map((event) => event.dedupKey),
      });
      processed += 1;
    } catch (err) {
      const message = errorMessage(err).slice(0, 500);
      failures.push(`${target.integrationId}: ${message}`);
      await integrationsLib.markWebhookDeliveryTargetFailed(deps.db, target.id, message);
    }
  }

  if (failures.length > 0) {
    const message = failures.join('; ').slice(0, 500);
    await integrationsLib.markWebhookDeliveryStatus(deps.db, work.delivery.id, 'failed', message);
    throw new Error(`webhook_delivery_failed: ${message}`);
  }

  await integrationsLib.markWebhookDeliveryStatus(
    deps.db,
    work.delivery.id,
    processed > 0 ? 'processed' : 'ignored',
  );
  return {
    deliveryId: work.delivery.id,
    processed,
    ignored,
    failed: 0,
  };
}

export async function deadLetterWebhookDeliveryJobIfExhausted(
  deps: WebhookDeliveryWorkerDeps,
  job: Job<queue.WebhookDeliveryJobData> | undefined,
  err: Error,
): Promise<void> {
  if (!job) return;
  const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
  if (job.attemptsMade < attempts) return;

  const work = await integrationsLib.loadWebhookDeliveryWork(deps.db, job.data.deliveryId);
  await integrationsLib.markWebhookDeliveryDeadLettered(deps.db, job.data.deliveryId, err.message);

  const attentionTargets = new Map<
    string,
    {
      teamId: string;
      integrationId: string;
      providerConnectionId: string | null;
      provider: string;
    }
  >();
  for (const item of work?.targets ?? []) {
    if (!item.integration) continue;
    attentionTargets.set(item.integration.id, {
      teamId: item.integration.teamId,
      integrationId: item.integration.id,
      providerConnectionId: item.integration.providerConnectionId,
      provider: item.integration.provider,
    });
  }

  await Promise.all(
    [...attentionTargets.values()].map((target) =>
      integrationsLib.adminRecordConnectionAttention(deps.db, target.teamId, {
        integrationId: target.integrationId,
        providerConnectionId: target.providerConnectionId,
        category: 'webhook_degraded',
        summary: `${target.provider} webhook delivery could not be processed after repeated retries. Reconciliation remains active while webhook delivery is repaired.`,
      }),
    ),
  );
}

export function startWebhookDeliveryWorker(
  deps: WebhookDeliveryWorkerDeps,
): Worker<queue.WebhookDeliveryJobData> {
  const worker = new Worker<queue.WebhookDeliveryJobData>(
    queue.QUEUE_NAMES.webhookDelivery,
    async (job: Job<queue.WebhookDeliveryJobData>) => {
      const startedAt = Date.now();
      const result = await processWebhookDeliveryJob(deps, job.data);
      log.info(
        { jobId: job.id, ...result, durationMs: Date.now() - startedAt },
        'webhook delivery job complete',
      );
      return result;
    },
    { connection: queue.getRedisConnection(), concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'webhook delivery job failed');
    captureWorkerJobFailure(err, job);
    void deadLetterWebhookDeliveryJobIfExhausted(deps, job, err).catch((deadLetterErr: unknown) => {
      log.error({ jobId: job?.id, err: deadLetterErr }, 'webhook delivery dead-letter failed');
    });
  });

  return worker;
}
