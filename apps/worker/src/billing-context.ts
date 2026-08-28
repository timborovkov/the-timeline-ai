import { type Db } from '@timeline/db';
import { isBillingAdmissionError, runWorkerBilling } from '@timeline/shared/billing';
import { DelayedError, UnrecoverableError } from 'bullmq';

export function workerBillingJobOptions(
  job: {
    id?: string;
    moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
  },
  token?: string,
): {
  jobId?: string;
  delayJob: (delayMs: number) => Promise<void>;
} {
  return {
    ...(job.id ? { jobId: job.id } : {}),
    delayJob: (delayMs: number) => job.moveToDelayed(Date.now() + delayMs, token),
  };
}

function isRealTeamId(teamId: string | undefined): teamId is string {
  return typeof teamId === 'string' && teamId.length > 0 && !teamId.startsWith('__');
}

/**
 * Attach billing ALS so LLM wrappers meter native AI usage. Worker unit tests
 * call process*ForTests without this wrapper and stay unmetered.
 */
export async function withWorkerAiBilling<T>(
  db: Db,
  teamId: string | undefined,
  operationClass: string,
  fn: () => Promise<T>,
  options?: {
    jobId?: string;
    delayJob?: (delayMs: number) => Promise<void>;
  },
): Promise<T> {
  if (!isRealTeamId(teamId)) return fn();
  try {
    return await runWorkerBilling(db, teamId, operationClass, fn, {
      ...(options?.jobId ? { operationId: `${operationClass}:${options.jobId}` } : {}),
    });
  } catch (err) {
    if (isBillingAdmissionError(err) && err.code === 'costly_worker_busy') {
      if (options?.delayJob) {
        await options.delayJob(15_000);
        throw new DelayedError();
      }
    }
    if (isBillingAdmissionError(err)) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}
