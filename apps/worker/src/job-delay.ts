export interface DelayableJob {
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export function delayWorkerJob(job: DelayableJob, delayMs: number, token?: string): Promise<void> {
  return job.moveToDelayed(Date.now() + delayMs, token);
}
