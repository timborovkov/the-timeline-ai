import type { Db } from '@timeline/db';
import { isInactiveWorkspaceError, runGuardedJob } from '@timeline/shared/platform-admin/runtime';
import type { Processor } from 'bullmq';

/** Enforce current suspension and impersonation authorization at job execution. */
export function guardWorkerProcessor<T, R, N extends string>(
  db: Db | undefined,
  processor: Processor<T, R, N>,
): (
  ...args: Parameters<Processor<T, R, N>>
) => Promise<R | { skipped: true; reason: 'workspace_inactive' }> {
  return async (job, token, signal) => {
    try {
      return await runGuardedJob(job.data, () => processor(job, token, signal), db);
    } catch (error) {
      // A global tick must not silently abandon other workspaces. Its loop
      // owns per-workspace skips; this boundary handles only attributed jobs.
      const data: unknown = job.data;
      if (
        !data ||
        typeof data !== 'object' ||
        !('teamId' in data) ||
        typeof data.teamId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(data.teamId) ||
        !isInactiveWorkspaceError(error)
      )
        throw error;
      return { skipped: true, reason: 'workspace_inactive' };
    }
  };
}
