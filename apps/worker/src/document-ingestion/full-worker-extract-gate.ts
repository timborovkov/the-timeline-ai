/**
 * Full-worker document-extract cutover gate (ADR 0013).
 *
 * Kept out of shared `getEnv()` so production web (same defaults:
 * WORKER_MODE=full, DOCUMENT_EXTRACT_ENABLED=true) can boot. Only the
 * full worker entrypoint enforces this.
 */
export function assertProductionFullWorkerSkipsDocumentExtract(env: {
  NODE_ENV: string;
  DOCUMENT_EXTRACT_ENABLED: boolean;
}): void {
  if (env.NODE_ENV === 'production' && env.DOCUMENT_EXTRACT_ENABLED) {
    throw new Error(
      'DOCUMENT_EXTRACT_ENABLED must be false on production full workers; use WORKER_MODE=document-extract (ADR 0013)',
    );
  }
}

/**
 * Whether a full worker should start the document-extract consumer.
 * Production always false (assertProductionFullWorkerSkipsDocumentExtract
 * should have already rejected ENABLED=true). Non-production requires
 * Daytona or the in-process escape hatch.
 */
export function shouldStartDocumentExtractOnFullWorker(env: {
  NODE_ENV: string;
  DOCUMENT_EXTRACT_ENABLED: boolean;
  DAYTONA_API_KEY?: string | undefined;
  DOCUMENT_EXTRACT_ALLOW_INPROCESS: boolean;
}): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (!env.DOCUMENT_EXTRACT_ENABLED) return false;
  return Boolean(env.DAYTONA_API_KEY) || env.DOCUMENT_EXTRACT_ALLOW_INPROCESS;
}
