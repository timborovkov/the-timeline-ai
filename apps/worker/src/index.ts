import { closeDb, getDb, migrateDatabase } from '@timeline/db';
import { waitForMigrations } from '@timeline/db/wait-for-migrations';
import { childLogger, getEnv, queue } from '@timeline/shared';
import { shutdownPostHogNodeClients } from '@timeline/shared/analytics/posthog-node';
import { closeAllRedisConnections } from '@timeline/shared/redis';

import {
  assertProductionFullWorkerSkipsDocumentExtract,
  shouldStartDocumentExtractOnFullWorker,
} from '#src/document-ingestion/full-worker-extract-gate.js';
import { captureWorkerException, flushWorkerSentry, initWorkerSentry } from '#src/monitoring.js';
import { startWorkerGroup } from '#src/worker-lifecycle.js';
import { startCalendarRecurrenceWorker } from '#src/workers/calendarRecurrence.js';
import { startChatDeliveryWorker } from '#src/workers/chatDelivery.js';
import { startConversationAgentWorker } from '#src/workers/conversationAgent.js';
import { startDailyDigestWorker } from '#src/workers/dailyDigest.js';
import { startDocumentExtractWorker } from '#src/workers/documentExtract.js';
import { startEmailInboundWorker } from '#src/workers/emailInbound.js';
import { startEmbedWorker } from '#src/workers/embed.js';
import { startExtractWorker } from '#src/workers/extract.js';
import { startIntegrationSyncWorker } from '#src/workers/integrationSync.js';
import { startJanitorWorker } from '#src/workers/janitor.js';
import { startMcpHealthWorker } from '#src/workers/mcpHealth.js';
import { startMeetingFinalizeWorker } from '#src/workers/meetingFinalize.js';
import { startMeetingSchedulerWorker } from '#src/workers/meetingScheduler.js';
import { startObjectSummaryWorker } from '#src/workers/objectSummary.js';
import { startOverdueWorker } from '#src/workers/overdue.js';
import { startReconciliationWorker } from '#src/workers/reconciliation.js';
import { startSuggestionWorker } from '#src/workers/suggestions.js';
import { startTaskCategoryWorker } from '#src/workers/taskCategory.js';
import { startTeamExportWorker } from '#src/workers/teamExport.js';
import { startTimelineMomentPresentationWorker } from '#src/workers/timelineMomentPresentation.js';
import { startTranscribeWorker } from '#src/workers/transcribe.js';
import { startWebhookDeliveryWorker } from '#src/workers/webhookDelivery.js';

const log = childLogger('worker');

initWorkerSentry();

async function main(): Promise<void> {
  const env = getEnv();
  if (env.WORKER_MODE === 'document-extract') {
    throw new Error(
      'WORKER_MODE=document-extract must use apps/worker/dist/extract-main.js (refusing full worker boot)',
    );
  }

  // Railway can deploy/restart the worker independently from web, so the
  // worker must be able to advance migrations too. The shared advisory lock
  // keeps concurrent web/worker migrators serialized and no-op once current.
  await migrateDatabase({ withAdvisoryLock: true });
  // Keep the explicit readiness check so a mismatched image or skipped
  // migrator still fails before queues start consuming jobs.
  await waitForMigrations();

  // Worker-only gate (not in shared getEnv — production web shares those defaults).
  assertProductionFullWorkerSkipsDocumentExtract(env);

  const db = getDb();
  // Non-production: need Daytona (or in-process escape hatch) before starting.
  const documentExtractEnabled = shouldStartDocumentExtractOnFullWorker(env);
  if (env.DOCUMENT_EXTRACT_ENABLED && !documentExtractEnabled) {
    log.warn(
      {
        nodeEnv: env.NODE_ENV,
        hasDaytona: Boolean(env.DAYTONA_API_KEY),
        allowInprocess: env.DOCUMENT_EXTRACT_ALLOW_INPROCESS,
      },
      'skipping document-extract consumer on full worker (use WORKER_MODE=document-extract in production, or set DAYTONA_API_KEY / DOCUMENT_EXTRACT_ALLOW_INPROCESS locally)',
    );
  }
  const workers = await startWorkerGroup([
    {
      name: queue.QUEUE_NAMES.emailInbound,
      start: () => startEmailInboundWorker({ db }),
      closeQueue: queue.closeEmailInboundQueue,
    },
    {
      name: queue.QUEUE_NAMES.transcribe,
      start: () => startTranscribeWorker({ db }),
      closeQueue: queue.closeTranscribeQueue,
    },
    {
      name: queue.QUEUE_NAMES.extract,
      start: () => startExtractWorker({ db }),
      closeQueue: queue.closeExtractQueue,
    },
    {
      name: queue.QUEUE_NAMES.suggestions,
      start: () => startSuggestionWorker({ db }),
      closeQueue: queue.closeSuggestionQueue,
      schedule: queue.scheduleObjectCleanupSuggestions,
    },
    {
      name: queue.QUEUE_NAMES.embed,
      start: () => startEmbedWorker({ db }),
      closeQueue: queue.closeEmbedQueue,
    },
    {
      name: queue.QUEUE_NAMES.overdueScan,
      start: () => startOverdueWorker({ db }),
      closeQueue: queue.closeOverdueScanQueue,
      schedule: queue.scheduleOverdueScan,
    },
    {
      name: queue.QUEUE_NAMES.calendarRecurrence,
      start: () => startCalendarRecurrenceWorker({ db }),
      closeQueue: queue.closeCalendarRecurrenceQueue,
      schedule: queue.scheduleCalendarRecurrenceMaterialization,
    },
    {
      name: queue.QUEUE_NAMES.chatDelivery,
      start: () => startChatDeliveryWorker(),
      closeQueue: queue.closeChatDeliveryQueue,
    },
    {
      name: queue.QUEUE_NAMES.conversationAgent,
      start: () => startConversationAgentWorker({ db }),
      closeQueue: queue.closeConversationAgentQueue,
    },
    ...(documentExtractEnabled
      ? [
          {
            name: queue.QUEUE_NAMES.documentExtract,
            start: () => startDocumentExtractWorker({ db }),
            closeQueue: queue.closeDocumentExtractQueue,
          },
        ]
      : []),
    {
      name: queue.QUEUE_NAMES.meetingFinalize,
      start: () => startMeetingFinalizeWorker({ db }),
      closeQueue: queue.closeMeetingFinalizeQueue,
    },
    {
      name: queue.QUEUE_NAMES.meetingScheduler,
      start: () => startMeetingSchedulerWorker({ db }),
      closeQueue: queue.closeMeetingSchedulerQueue,
      schedule: queue.scheduleMeetingSchedulerTick,
    },
    {
      name: queue.QUEUE_NAMES.objectSummary,
      start: () => startObjectSummaryWorker({ db }),
      closeQueue: queue.closeObjectSummaryQueue,
    },
    {
      name: queue.QUEUE_NAMES.taskCategory,
      start: () => startTaskCategoryWorker({ db }),
      closeQueue: queue.closeTaskCategoryQueue,
    },
    {
      name: queue.QUEUE_NAMES.janitor,
      start: () => startJanitorWorker({ db }),
      closeQueue: queue.closeJanitorQueue,
      schedule: queue.scheduleJanitorSweep,
    },
    {
      name: queue.QUEUE_NAMES.webhookDelivery,
      start: () => startWebhookDeliveryWorker({ db }),
      closeQueue: queue.closeWebhookDeliveryQueue,
    },
    {
      name: queue.QUEUE_NAMES.integrationSync,
      start: () => startIntegrationSyncWorker({ db }),
      closeQueue: queue.closeIntegrationSyncQueue,
      schedule: queue.scheduleIntegrationIncrementalSync,
    },
    {
      name: queue.QUEUE_NAMES.mcpHealth,
      start: () => startMcpHealthWorker({ db }),
      closeQueue: queue.closeMcpHealthQueue,
      schedule: queue.scheduleMcpHealthPing,
    },
    {
      name: queue.QUEUE_NAMES.teamExport,
      start: () => startTeamExportWorker({ db }),
      closeQueue: queue.closeTeamExportQueue,
    },
    {
      name: queue.QUEUE_NAMES.timelineMomentPresentation,
      start: () => startTimelineMomentPresentationWorker({ db }),
      closeQueue: queue.closeTimelineMomentPresentationQueue,
    },
    {
      name: queue.QUEUE_NAMES.dailyDigest,
      start: () => startDailyDigestWorker({ db }),
      closeQueue: queue.closeDailyDigestQueue,
      schedule: queue.scheduleDailyDigest,
    },
    {
      name: queue.QUEUE_NAMES.reconciliation,
      start: () => startReconciliationWorker({ db }),
      closeQueue: queue.closeReconciliationQueue,
    },
  ]);
  log.info(
    {
      runtime: typeof process.versions.bun === 'string' ? 'bun' : 'node',
      bunVersion: process.versions.bun,
      taskCategoryWorkerEnabled: workers.activeNames.includes(queue.QUEUE_NAMES.taskCategory),
      workers: workers.activeNames,
      documentExtractEnabled,
    },
    'workers started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'received shutdown signal');
    try {
      await workers.close();
      await closeAllRedisConnections();
    } catch (err: unknown) {
      log.error({ err }, 'shutdown error');
      captureWorkerException(err, { signal, component: 'worker_shutdown' });
    } finally {
      await shutdownPostHogNodeClients().catch(() => undefined);
      await flushWorkerSentry().catch(() => false);
      await closeDb().catch(() => undefined);
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'fatal');
  captureWorkerException(err, { component: 'worker_startup' });
  void shutdownPostHogNodeClients()
    .catch(() => undefined)
    .finally(() => flushWorkerSentry())
    .finally(() => {
      process.exit(1);
    });
});
