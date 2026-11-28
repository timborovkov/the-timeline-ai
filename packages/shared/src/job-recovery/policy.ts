export const JOB_RECOVERY_KINDS = [
  'transcription',
  'extraction',
  'embedding',
  'document_processing',
  'meeting_finalization',
  'integration_sync',
] as const;

export type JobRecoveryKind = (typeof JOB_RECOVERY_KINDS)[number];

export function isJobRecoveryKind(value: unknown): value is JobRecoveryKind {
  return typeof value === 'string' && (JOB_RECOVERY_KINDS as readonly string[]).includes(value);
}

// The recovery UI and automatic sweeper use the same age boundary for stuck work.
export const RECOVERY_STALE_AFTER_MS = {
  documentPending: 5 * 60 * 1000,
  // Age starts at upload allocation, so extraction includes upload time and OCR latency.
  documentExtracting: 60 * 60 * 1000,
  meetingProcessing: 30 * 60 * 1000,
} as const;
