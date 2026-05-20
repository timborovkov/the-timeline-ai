import { closeDb, getDb } from '@timeline/db';
import { queue } from '@timeline/shared';

import { startEmbedWorker } from './workers/embed.js';
import { startExtractWorker } from './workers/extract.js';
import { startTranscribeWorker } from './workers/transcribe.js';

function main(): void {
  const db = getDb();
  const transcribeWorker = startTranscribeWorker({ db });
  const extractWorker = startExtractWorker({ db });
  const embedWorker = startEmbedWorker({ db });
  console.log('[worker] transcribe + extract + embed workers started');

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    try {
      await Promise.all([
        transcribeWorker.close(),
        extractWorker.close(),
        embedWorker.close(),
      ]);
      await queue.closeTranscribeQueue();
      await queue.closeExtractQueue();
      await queue.closeEmbedQueue();
      await queue.closeRedisConnection();
      await closeDb();
    } catch (err: unknown) {
      console.error('[worker] shutdown error', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

try {
  main();
} catch (err: unknown) {
  console.error('[worker] fatal', err);
  process.exit(1);
}
