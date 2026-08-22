import { type Db } from '@timeline/db';
import { isBillingAdmissionError, runWorkerBilling } from '@timeline/shared/billing';
import { UnrecoverableError } from 'bullmq';

/** Sentinel team ids used by tick / fan-out jobs that are not a real workspace. */
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
): Promise<T> {
  if (!isRealTeamId(teamId)) return fn();
  try {
    return await runWorkerBilling(db, teamId, operationClass, fn);
  } catch (err) {
    if (isBillingAdmissionError(err)) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}
