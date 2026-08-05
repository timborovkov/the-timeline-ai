import { closeDb, getDb, migrateDatabase } from '@timeline/db';
import { waitForMigrations } from '@timeline/db/wait-for-migrations';
import { childLogger, getEnv, queue } from '@timeline/shared';
import { shutdownPostHogNodeClients } from '@timeline/shared/analytics/posthog-node';

import { captureWorkerException, flushWorkerSentry, initWorkerSentry } from '#src/monitoring.js';
import { startCalendarRecurrenceWorker } from '#src/workers/calendarRecurrence.js';
import { startConversationAgentWorker } from '#src/workers/conversationAgent.js';
import { startDailyDigestWorker } from '#src/workers/dailyDigest.js';
import { startDocumentExtractWorker } from '#src/workers/documentExtract.js';
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

  const db = getDb();
  // Cutover safety: a full worker must not consume document-extract without
  // Daytona (or the explicit in-process escape hatch). Default enabled +
  // missing DAYTONA_API_KEY would otherwise pull PDFs into the credentialed
  // process via vision fallback.
  const documentExtractCanRun =
    Boolean(env.DAYTONA_API_KEY) || env.DOCUMENT_EXTRACT_ALLOW_INPROCESS;
  const documentExtractEnabled = env.DOCUMENT_EXTRACT_ENABLED && documentExtractCanRun;
  if (env.DOCUMENT_EXTRACT_ENABLED && !documentExtractCanRun) {
    log.warn(
      'DOCUMENT_EXTRACT_ENABLED=true but DAYTONA_API_KEY unset and DOCUMENT_EXTRACT_ALLOW_INPROCESS=false; skipping document-extract consumer (use the extract service or set credentials)',
    );
  }
  const transcribeWorker = startTranscribeWorker({ db });
  const extractWorker = startExtractWorker({ db });
  const suggestionWorker = startSuggestionWorker({ db });
  const embedWorker = startEmbedWorker({ db });
  const overdueWorker = startOverdueWorker({ db });
  const calendarRecurrenceWorker = startCalendarRecurrenceWorker({ db });
  const conversationAgentWorker = startConversationAgentWorker({ db });
  const documentExtractWorker = documentExtractEnabled ? startDocumentExtractWorker({ db }) : null;
  const meetingFinalizeWorker = startMeetingFinalizeWorker({ db });
  const meetingSchedulerWorker = startMeetingSchedulerWorker({ db });
  const objectSummaryWorker = startObjectSummaryWorker({ db });
  const taskCategoryWorker = startTaskCategoryWorker({ db });
  const janitorWorker = startJanitorWorker({ db });
  const webhookDeliveryWorker = startWebhookDeliveryWorker({ db });
  const integrationSyncWorker = startIntegrationSyncWorker({ db });
  const mcpHealthWorker = startMcpHealthWorker({ db });
  const teamExportWorker = startTeamExportWorker({ db });
  const timelineMomentPresentationWorker = startTimelineMomentPresentationWorker({ db });
  const dailyDigestWorker = startDailyDigestWorker({ db });
  const reconciliationWorker = startReconciliationWorker({ db });
  // Register the hourly repeatables. BullMQ keys by jobId so a
  // duplicate call on the next deploy is a no-op.
  await queue.scheduleOverdueScan();
  await queue.scheduleCalendarRecurrenceMaterialization();
  await queue.scheduleJanitorSweep();
  // Phase 11: 5-minute integration sync tick fans out incremental syncs
  // to every enabled integration. Same idempotency story — BullMQ dedups
  // by jobId.
  await queue.scheduleIntegrationIncrementalSync();
  await queue.scheduleMcpHealthPing();
  await queue.scheduleObjectCleanupSuggestions();
  await queue.scheduleMeetingSchedulerTick();
  await queue.scheduleDailyDigest();
  log.info(
    {
      taskCategoryWorkerEnabled: taskCategoryWorker !== null,
      documentExtractEnabled,
    },
    'transcribe + extract + suggestions + embed + overdue + calendar-recurrence + conversation-agent + document-extract + meeting-finalize + meeting-scheduler + object-summary + janitor + webhook-delivery + integration-sync + mcp-health + team-export + timeline-moment-presentation + daily-digest + reconciliation workers started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'received shutdown signal');
    try {
      await Promise.all([
        transcribeWorker.close(),
        extractWorker.close(),
        suggestionWorker.close(),
        embedWorker.close(),
        overdueWorker.close(),
        calendarRecurrenceWorker.close(),
        conversationAgentWorker.close(),
        documentExtractWorker?.close(),
        meetingFinalizeWorker.close(),
        meetingSchedulerWorker.close(),
        objectSummaryWorker.close(),
        taskCategoryWorker?.close(),
        janitorWorker.close(),
        webhookDeliveryWorker.close(),
        integrationSyncWorker.close(),
        mcpHealthWorker.close(),
        teamExportWorker.close(),
        timelineMomentPresentationWorker.close(),
        dailyDigestWorker.close(),
        reconciliationWorker.close(),
      ]);
      await queue.closeTranscribeQueue();
      await queue.closeExtractQueue();
      await queue.closeSuggestionQueue();
      await queue.closeEmbedQueue();
      await queue.closeOverdueScanQueue();
      await queue.closeCalendarRecurrenceQueue();
      await queue.closeConversationAgentQueue();
      if (documentExtractEnabled) {
        await queue.closeDocumentExtractQueue();
      }
      await queue.closeMeetingFinalizeQueue();
      await queue.closeMeetingSchedulerQueue();
      await queue.closeObjectSummaryQueue();
      await queue.closeTaskCategoryQueue();
      await queue.closeJanitorQueue();
      await queue.closeWebhookDeliveryQueue();
      await queue.closeIntegrationSyncQueue();
      await queue.closeMcpHealthQueue();
      await queue.closeTeamExportQueue();
      await queue.closeTimelineMomentPresentationQueue();
      await queue.closeDailyDigestQueue();
      await queue.closeReconciliationQueue();
      await queue.closeRedisConnection();
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
