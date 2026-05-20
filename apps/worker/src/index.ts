import { closeDb, getDb } from '@timeline/db';
import { queue } from '@timeline/shared';

import { startTranscribeWorker } from './workers/transcribe.js';

function main(): void {
  const db = getDb();
  const worker = startTranscribeWorker({ db });
  console.log('[worker] transcribe worker started');

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    try {
      await worker.close();
      await queue.closeTranscribeQueue();
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
