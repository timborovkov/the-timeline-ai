import { runGuardedJob } from '@timeline/shared/platform-admin/runtime';

import type { Db } from '@timeline/db';
import type { Processor } from 'bullmq';

/** Enforce current suspension and impersonation authorization at job execution. */
export function guardWorkerProcessor<T, R, N extends string>(
  db: Db | undefined,
  processor: Processor<T, R, N>,
): Processor<T, R, N> {
  return (job, token, signal) => runGuardedJob(job.data, () => processor(job, token, signal), db);
}
