import { closeDb, getDb, waitForMigrations } from '@timeline/db';
import { queue } from '@timeline/shared';

import { startEmbedWorker } from './workers/embed.js';
import { startExtractWorker } from './workers/extract.js';
import { startTranscribeWorker } from './workers/transcribe.js';

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
  console.log('[worker] transcribe + extract + embed workers started');

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    try {
      await Promise.all([transcribeWorker.close(), extractWorker.close(), embedWorker.close()]);
      await queue.closeTranscribeQueue();
      await queue.closeExtractQueue();
      await queue.closeEmbedQueue();
      await queue.closeRedisConnection();
    } catch (err: unknown) {
      console.error('[worker] shutdown error', err);
    } finally {
      await closeDb().catch(() => undefined);
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
