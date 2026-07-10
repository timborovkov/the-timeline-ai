import { createBulkFailedJobRecoveryRoute } from '@/app/api/team/job-recovery/bulk-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBulkFailedJobRecoveryRoute({
  action: 'job.retry',
  fallbackError: 'retry_failed',
  run: (scope, input) => scope.jobRecovery.retryFailedRecoverableJobs(input),
});
