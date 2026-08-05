import { closeDb, getDb, migrateDatabase } from '@timeline/db';
import { waitForMigrations } from '@timeline/db/wait-for-migrations';
import { childLogger, getEnv, queue } from '@timeline/shared';
import { shutdownPostHogNodeClients } from '@timeline/shared/analytics/posthog-node';

import { captureWorkerException, flushWorkerSentry, initWorkerSentry } from '#src/monitoring.js';
import { startDocumentExtractWorker } from '#src/workers/documentExtract.js';

const log = childLogger('worker:document-extract-service');

initWorkerSentry();

/**
 * Credential-thin extract service entrypoint (ADR 0013).
 *
 * Boots only the document-extract BullMQ consumer. Pair with
 * `WORKER_MODE=document-extract` and a stripped Railway env (Daytona,
 * OpenRouter, DB, Redis, S3 — no SECRETS_ENCRYPTION_KEY / Auth / chat
 * provider tokens).
 */
async function main(): Promise<void> {
  const env = getEnv();
  if (env.WORKER_MODE !== 'document-extract') {
    throw new Error(
      'extract-main requires WORKER_MODE=document-extract (refusing to start a full worker from this entrypoint)',
    );
  }

  await migrateDatabase({ withAdvisoryLock: true });
  await waitForMigrations();

  const db = getDb();
  const documentExtractWorker = startDocumentExtractWorker({ db });
  log.info('document-extract service started');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'received shutdown signal');
    try {
      await documentExtractWorker.close();
      await queue.closeDocumentExtractQueue();
      await queue.closeEmbedQueue();
      await queue.closeRedisConnection();
    } catch (err: unknown) {
      log.error({ err }, 'shutdown error');
      captureWorkerException(err, { signal, component: 'document_extract_service_shutdown' });
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
  captureWorkerException(err, { component: 'document_extract_service_startup' });
  void shutdownPostHogNodeClients()
    .catch(() => undefined)
    .finally(() => flushWorkerSentry())
    .finally(() => {
      process.exit(1);
    });
});
