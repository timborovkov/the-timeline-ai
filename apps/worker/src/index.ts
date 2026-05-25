import { closeDb, getDb, waitForMigrations } from '@timeline/db';
import { childLogger, queue } from '@timeline/shared';

import { startEmbedWorker } from './workers/embed.js';
import { startExtractWorker } from './workers/extract.js';
import { startOverdueWorker } from './workers/overdue.js';
import { startTranscribeWorker } from './workers/transcribe.js';

const log = childLogger('worker');

async function main(): Promise<void> {
  // On Railway, the web service runs migrations as a preDeployCommand before
  // its release shifts. Worker services deploy in parallel and can race that.
  // Block here until the DB has at least as many migrations applied as the
  // journal bundled with this image expects, so we don't crash-loop on every
  // deploy that ships schema changes.
  await waitForMigrations();

  const db = getDb();
  const transcribeWorker = startTranscribeWorker({ db });
  const extractWorker = startExtractWorker({ db });
  const embedWorker = startEmbedWorker({ db });
  const overdueWorker = startOverdueWorker({ db });
  // Register the hourly overdue-scan repeatable. BullMQ keys by jobId so a
  // duplicate call on the next deploy is a no-op.
  await queue.scheduleOverdueScan();
  log.info('transcribe + extract + embed + overdue workers started');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'received shutdown signal');
    try {
      await Promise.all([
        transcribeWorker.close(),
        extractWorker.close(),
        embedWorker.close(),
        overdueWorker.close(),
      ]);
      await queue.closeTranscribeQueue();
      await queue.closeExtractQueue();
      await queue.closeEmbedQueue();
      await queue.closeOverdueScanQueue();
      await queue.closeRedisConnection();
    } catch (err: unknown) {
      log.error({ err }, 'shutdown error');
    } finally {
      await closeDb().catch(() => undefined);
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'fatal');
  process.exit(1);
});
