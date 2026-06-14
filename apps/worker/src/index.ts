import { closeDb, getDb } from '@timeline/db';
import { waitForMigrations } from '@timeline/db/wait-for-migrations';
import { childLogger, queue } from '@timeline/shared';
import { shutdownPostHogNodeClients } from '@timeline/shared/analytics/posthog-node';

import { captureWorkerException, flushWorkerSentry, initWorkerSentry } from '#src/monitoring.js';
import { startCalendarRecurrenceWorker } from '#src/workers/calendarRecurrence.js';
import { startDailyDigestWorker } from '#src/workers/dailyDigest.js';
import { startDocumentExtractWorker } from '#src/workers/documentExtract.js';
import { startEmbedWorker } from '#src/workers/embed.js';
import { startExtractWorker } from '#src/workers/extract.js';
import { startIntegrationSyncWorker } from '#src/workers/integrationSync.js';
import { startJanitorWorker } from '#src/workers/janitor.js';
import { startMcpHealthWorker } from '#src/workers/mcpHealth.js';
import { startMeetingFinalizeWorker } from '#src/workers/meetingFinalize.js';
import { startMeetingSchedulerWorker } from '#src/workers/meetingScheduler.js';
import { startOverdueWorker } from '#src/workers/overdue.js';
import { startSuggestionWorker } from '#src/workers/suggestions.js';
import { startTeamExportWorker } from '#src/workers/teamExport.js';
import { startTranscribeWorker } from '#src/workers/transcribe.js';

const log = childLogger('worker');

initWorkerSentry();

async function main(): Promise<void> {
  // On Railway, the web service runs migrations in preDeploy and again from
  // its start wrapper. Worker services deploy in parallel and can race that.
  // Block here until the DB has at least as many migrations applied as the
  // journal bundled with this image expects, so we don't crash-loop on every
  // deploy that ships schema changes.
  await waitForMigrations();

  const db = getDb();
  const transcribeWorker = startTranscribeWorker({ db });
  const extractWorker = startExtractWorker({ db });
  const suggestionWorker = startSuggestionWorker({ db });
  const embedWorker = startEmbedWorker({ db });
  const overdueWorker = startOverdueWorker({ db });
  const calendarRecurrenceWorker = startCalendarRecurrenceWorker({ db });
  const documentExtractWorker = startDocumentExtractWorker({ db });
  const meetingFinalizeWorker = startMeetingFinalizeWorker({ db });
  const meetingSchedulerWorker = startMeetingSchedulerWorker({ db });
  const janitorWorker = startJanitorWorker({ db });
  const integrationSyncWorker = startIntegrationSyncWorker({ db });
  const mcpHealthWorker = startMcpHealthWorker({ db });
  const teamExportWorker = startTeamExportWorker({ db });
  const dailyDigestWorker = startDailyDigestWorker({ db });
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
    'transcribe + extract + suggestions + embed + overdue + calendar-recurrence + document-extract + meeting-finalize + meeting-scheduler + janitor + integration-sync + mcp-health + team-export + daily-digest workers started',
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
        documentExtractWorker.close(),
        meetingFinalizeWorker.close(),
        meetingSchedulerWorker.close(),
        janitorWorker.close(),
        integrationSyncWorker.close(),
        mcpHealthWorker.close(),
        teamExportWorker.close(),
        dailyDigestWorker.close(),
      ]);
      await queue.closeTranscribeQueue();
      await queue.closeExtractQueue();
      await queue.closeSuggestionQueue();
      await queue.closeEmbedQueue();
      await queue.closeOverdueScanQueue();
      await queue.closeCalendarRecurrenceQueue();
      await queue.closeDocumentExtractQueue();
      await queue.closeMeetingFinalizeQueue();
      await queue.closeMeetingSchedulerQueue();
      await queue.closeJanitorQueue();
      await queue.closeIntegrationSyncQueue();
      await queue.closeMcpHealthQueue();
      await queue.closeTeamExportQueue();
      await queue.closeDailyDigestQueue();
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
